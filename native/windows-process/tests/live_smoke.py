"""Windows-only process ownership and binary transport qualification. No desktop session required."""
import argparse
import base64
import ctypes
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import unittest


class Harness:
    def __init__(self):
        self.process = subprocess.Popen([HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.events = queue.Queue()
        self.id = 0
        self.output = {"stdout": bytearray(), "stderr": bytearray()}
        self.seen = []
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        try:
            while True:
                line = self.process.stdout.readline(128 * 1024 + 2)
                if not line:
                    self.events.put(None)
                    return
                if len(line) > 128 * 1024 + 1 or not line.endswith(b"\n"):
                    raise AssertionError("unbounded or incomplete supervisor frame")
                self.events.put(json.loads(line))
        except BaseException as error:
            self.events.put(error)

    def send(self, kind, **fields):
        self.id += 1
        message = {"kind": kind, "id": self.id, **fields}
        self.process.stdin.write(json.dumps(message, ensure_ascii=False).encode("utf-8") + b"\n")
        self.process.stdin.flush()
        return self.id

    def launch(self, mode, arguments=(), parent_pid=None, extra_env=None):
        environment = dict(os.environ)
        environment.pop("FIXTURE_EXCLUDED", None)
        environment.update(extra_env or {})
        self.send("launch", version=1, executable=FIXTURE, args=[mode, *arguments], cwd=str(Path(FIXTURE).parent),
                  env=environment, parentPid=parent_pid or os.getpid(), drainTimeoutMs=5000)
        first = self.next()
        assert first["kind"] == "started" and first["id"] == 1, first
        return first["pid"]

    def next(self, timeout=15):
        event = self.events.get(timeout=timeout)
        if isinstance(event, BaseException):
            raise event
        if event is None:
            raise AssertionError("supervisor exited without expected terminal event")
        self.seen.append(event)
        if event["kind"] == "output":
            chunk = base64.b64decode(event["data"], validate=True)
            assert len(chunk) <= 16 * 1024
            target = self.output[event["stream"]]
            target.extend(chunk)
            assert len(target) <= 8 * 1024 * 1024
        return event

    def until(self, kind, request_id=None):
        deadline = time.monotonic() + 15
        while True:
            event = self.next(max(0.01, deadline - time.monotonic()))
            if event["kind"] == "error":
                raise AssertionError(event)
            if event["kind"] == kind and (request_id is None or event.get("id") == request_id):
                return event

    def child_pids(self):
        deadline = time.monotonic() + 15
        while b"\n" not in self.output["stdout"]:
            self.next(max(0.01, deadline - time.monotonic()))
        return json.loads(self.output["stdout"].splitlines()[0])

    def finish(self):
        result = self.until("exit")
        assert result["cleanup"] is True
        assert self.process.wait(timeout=10) == 0
        assert self.process.stderr.read() == b""
        return result

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=10)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            try:
                stream.close()
            except BrokenPipeError:
                pass


def assert_dead(pid):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel.WaitForSingleObject.restype = ctypes.c_uint32
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x00100000, False, pid)
    if not handle:
        assert ctypes.get_last_error() == 87, "cannot verify process exit"
        return
    try:
        assert kernel.WaitForSingleObject(handle, 5000) == 0, "owned process remains alive"
    finally:
        kernel.CloseHandle(handle)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.harness = Harness()

    def tearDown(self):
        self.harness.close()

    def test_binary_stdio_acknowledgement_and_exit_code(self):
        h = self.harness
        h.launch("echo")
        content = bytes(range(256)) * 256
        request = h.send("stdin", data=base64.b64encode(content).decode("ascii"))
        h.until("ack", request)
        h.send("eof")
        result = h.finish()
        self.assertEqual(result["exitCode"], 7)
        self.assertFalse(result["stopped"])
        self.assertEqual(h.output["stdout"], content)
        self.assertEqual(h.output["stderr"], bytes([0, 255, 10, 128]))
        self.assertTrue(any(event["kind"] == "rootExit" and event["exitCode"] == 7 for event in h.seen))

    def test_literal_arguments_working_directory_and_environment(self):
        h = self.harness
        arguments = ["", "space value", 'quoted"value', "trailing\\", '\\\"', "雪", "& echo should-not-run", "%PATH%", "$(echo nope)"]
        h.launch("arguments", arguments, extra_env={"FIXTURE_MARKER": "literal secret marker"})
        h.finish()
        result = json.loads(h.output["stdout"])
        self.assertEqual(result["arguments"], arguments)
        self.assertEqual(os.path.normcase(result["cwd"]), os.path.normcase(str(Path(FIXTURE).parent)))
        self.assertEqual(result["marker"], "literal secret marker")
        self.assertIsNone(result["excluded"])

    def test_root_exit_terminates_descendant_that_inherits_output(self):
        h = self.harness
        root_pid = h.launch("tree-exit")
        result = h.finish()
        pids = json.loads(h.output["stdout"].splitlines()[0])
        self.assertEqual(result["exitCode"], 23)
        assert_dead(root_pid)
        assert_dead(pids["childPid"])

    def test_stop_interrupts_blocked_stdin_and_cleans_tree(self):
        h = self.harness
        root_pid = h.launch("tree-wait")
        pids = h.child_pids()
        h.send("stdin", data=base64.b64encode(b"x" * 65536).decode("ascii"))
        h.send("stop")
        result = h.finish()
        self.assertTrue(result["stopped"])
        assert_dead(root_pid)
        assert_dead(pids["childPid"])

    def test_controller_eof_cleans_tree(self):
        h = self.harness
        root_pid = h.launch("tree-wait")
        pids = h.child_pids()
        h.process.stdin.close()
        self.assertTrue(h.finish()["stopped"])
        assert_dead(root_pid)
        assert_dead(pids["childPid"])

    def test_monitored_parent_exit_cleans_tree_with_controller_pipe_open(self):
        h = self.harness
        sentinel = subprocess.Popen([FIXTURE, "quiet"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            root_pid = h.launch("tree-wait", parent_pid=sentinel.pid)
            pids = h.child_pids()
            sentinel.kill()
            sentinel.wait(timeout=10)
            self.assertTrue(h.finish()["stopped"])
            assert_dead(root_pid)
            assert_dead(pids["childPid"])
        finally:
            if sentinel.poll() is None:
                sentinel.kill()
                sentinel.wait(timeout=10)

    def test_abrupt_helper_exit_closes_job(self):
        h = self.harness
        root_pid = h.launch("tree-wait")
        pids = h.child_pids()
        h.process.kill()
        h.process.wait(timeout=10)
        assert_dead(root_pid)
        assert_dead(pids["childPid"])

    def test_output_larger_than_pipe_capacity_is_drained(self):
        h = self.harness
        h.launch("output")
        h.finish()
        self.assertEqual(h.output["stdout"], bytes(range(256)) * (3 * 1024 * 1024 // 256))

    def test_stop_remains_responsive_when_controller_stops_reading(self):
        # Deliberately bypass Harness's output reader to fill the helper's bounded queue.
        raw = subprocess.Popen([HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            launch = {"kind": "launch", "id": 1, "version": 1, "executable": FIXTURE, "args": ["output"],
                      "cwd": str(Path(FIXTURE).parent), "env": dict(os.environ), "parentPid": os.getpid(), "drainTimeoutMs": 500}
            raw.stdin.write(json.dumps(launch).encode() + b"\n")
            raw.stdin.flush()
            started = json.loads(raw.stdout.readline(128 * 1024))
            self.assertEqual(started["kind"], "started")
            time.sleep(0.2)
            raw.stdin.write(b'{"kind":"eof","id":2}\n{"kind":"stop","id":3}\n')
            raw.stdin.flush()
            # It cannot report a clean output drain to a controller that does not consume output.
            self.assertNotEqual(raw.wait(timeout=10), 0)
            assert_dead(started["pid"])
        finally:
            if raw.poll() is None:
                raw.kill()
                raw.wait(timeout=10)
            for stream in (raw.stdin, raw.stdout, raw.stderr):
                stream.close()

    def test_invalid_request_is_content_free_and_fails_closed(self):
        h = self.harness
        root_pid = h.launch("tree-wait")
        pids = h.child_pids()
        h.send("stop", secret="never include this marker")
        while True:
            event = h.next()
            if event["kind"] == "error":
                self.assertEqual(event, {"kind": "error", "code": "INVALID_REQUEST", "message": "Invalid supervisor request."})
                break
        self.assertNotEqual(h.process.wait(timeout=10), 0)
        assert_dead(root_pid)
        assert_dead(pids["childPid"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--helper", required=True)
    parser.add_argument("--fixture", required=True)
    options, remaining = parser.parse_known_args()
    if os.name != "nt":
        raise SystemExit("Live process qualification requires Windows; no tests were run.")
    HELPER = str(Path(options.helper).resolve(strict=True))
    FIXTURE = str(Path(options.fixture).resolve(strict=True))
    os.environ["FIXTURE_EXCLUDED"] = "must not reach fixture"
    unittest.main(argv=[sys.argv[0], *remaining])
