"""Exercise the real Qt reference application's capture and graceful shutdown."""
import argparse
import json
import os
from pathlib import Path
import queue
import secrets
import socket
import subprocess
import threading
import time


class FixtureSession:
    """Own one fixture process, bounded diagnostics and authenticated connection."""

    def __init__(self, executable, directory, debugger=False):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.token = secrets.token_hex(32)
        command = [str(executable), "--bad-calculation"]
        if debugger:
            command = ["lldb", "--batch", "-o", "run", "-k", "thread backtrace all", "--", *command]
        self.process = subprocess.Popen(
            command, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env={**os.environ, "E2E_NATIVE_TOKEN": self.token,
                                         "E2E_NATIVE_PORT": "0"})
        self.ready = queue.Queue(maxsize=1)
        self.output = {"stdout": bytearray(), "stderr": bytearray()}
        self.threads = [threading.Thread(target=self._drain, args=(name, pipe), daemon=True)
                        for name, pipe in (("stdout", self.process.stdout), ("stderr", self.process.stderr))]
        for thread in self.threads:
            thread.start()
        self.connection = None
        self.stream = None
        self.sequence = 0

    def _drain(self, name, pipe):
        """Drain both pipes continuously; retain at most one MiB per stream."""
        pending = bytearray()
        announced = False
        while chunk := pipe.read1(4096):
            self.output[name].extend(chunk[:max(0, 1024 * 1024 - len(self.output[name]))])
            if name == "stdout" and not announced and len(pending) < 65536:
                pending.extend(chunk)
                while b"\n" in pending:
                    line, _, remaining = pending.partition(b"\n")
                    pending = bytearray(remaining)
                    if line.startswith(b"E2E_NATIVE_READY ") and not announced:
                        self.ready.put_nowait(line[17:])
                        announced = True

    def connect(self):
        """Use a bounded readiness announcement and the real loopback protocol."""
        port = json.loads(self.ready.get(timeout=10))["port"]
        self.connection = socket.create_connection(("127.0.0.1", port), timeout=5)
        self.stream = self.connection.makefile("rb")
        self.rpc("initialize", {"protocolVersion": 1, "token": self.token})

    def rpc(self, method, params=None):
        """Require an exact response ID and reject protocol errors."""
        self.sequence += 1
        self.connection.sendall(json.dumps({"jsonrpc": "2.0", "id": self.sequence,
                                           "method": method, "params": params or {}}).encode() + b"\n")
        line = self.stream.readline(32 * 1024 * 1024 + 1)
        if not line.endswith(b"\n") or len(line) > 32 * 1024 * 1024:
            raise RuntimeError("missing or oversized RPC response")
        result = json.loads(line)
        if result.get("id") != self.sequence or "error" in result:
            raise RuntimeError(f"unexpected response to {method}: {result.get('error')}")
        return result["result"]

    def close_connection(self):
        """Close the controller's socket without terminating the application."""
        if self.stream:
            self.stream.close()
            self.stream = None
        if self.connection:
            self.connection.close()
            self.connection = None

    def finish(self):
        """Retain the real exit status; forced cleanup can never pass."""
        self.close_connection()
        forced = self.process.poll() is None
        if forced:
            self.process.kill()
        self.process.wait(timeout=5)
        for thread in self.threads:
            thread.join(timeout=5)
        for name, output in self.output.items():
            (self.directory / f"{name}.txt").write_bytes(output)
        return {"returnCode": self.process.returncode, "forcedCleanup": forced}


def find_node(node, test_id):
    """Find a reference control by its application-owned identity."""
    if node.get("testId") == test_id:
        return node
    for child in node.get("children", []):
        result = find_node(child, test_id)
        if result:
            return result
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--executable", type=Path, required=True)
    parser.add_argument("--cycles", type=int, default=60)
    parser.add_argument("--lldb", action="store_true")
    parser.add_argument("--output", type=Path, default=Path(".e2e/cpp/qt-shutdown"))
    args = parser.parse_args()
    if not 1 <= args.cycles <= 200:
        parser.error("cycles must be between 1 and 200")
    records = []
    for index in range(args.cycles):
        session = FixtureSession(args.executable.resolve(), args.output / f"cycle-{index:03d}", args.lldb)
        record = {"cycle": index, "closeDelayMs": [0, 5, 50][index % 3]}
        try:
            session.connect()
            tree = session.rpc("snapshot")["root"]
            button = find_node(tree, "calculate")
            if button is None:
                raise RuntimeError("reference Calculate control is missing")
            session.rpc("perform", {"ref": button["ref"], "action": {"kind": "tap"}})
            deadline = time.monotonic() + 5
            while True:
                tree = session.rpc("snapshot")["root"]
                status = find_node(tree, "status")
                if status and status.get("text") == "Calculated":
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError("reference calculation did not complete")
                time.sleep(0.02)
            session.rpc("snapshot", {"pixels": True})
            session.rpc("screenshot")
            session.rpc("shutdown")
            time.sleep(record["closeDelayMs"] / 1000)
            session.close_connection()
            session.process.wait(timeout=5)
        except Exception as error:
            record["error"] = f"{type(error).__name__}: {error}"
        finally:
            record.update(session.finish())
        if args.lldb and b"stop reason = signal" in session.output["stdout"]:
            record["error"] = "debugger observed a fatal signal; inspect retained stack"
        records.append(record)
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / "qualification.json").write_text(json.dumps({
            "sourceCommit": os.environ.get("GITHUB_SHA"), "cyclesRequired": args.cycles,
            "platform": os.environ.get("QT_QPA_PLATFORM"), "results": records}, indent=2) + "\n")
        print(json.dumps(record), flush=True)
        if record.get("error") or record["forcedCleanup"] or record["returnCode"] != 0:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
