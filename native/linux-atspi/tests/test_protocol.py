"""Protocol and lifecycle tests do not require a desktop or GI installation."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from e2e_atspi.application import OwnedApplication
from e2e_atspi.contracts import AccessibilityProvider, DriverError
from e2e_atspi.protocol import MAX_FRAME, ProtocolSession

TOKEN = "a" * 64


class FakeProvider(AccessibilityProvider):
    def __init__(self):
        self.actions = []
        self.error = None

    def snapshot(self):
        if self.error:
            raise self.error
        return {"root": {"ref": {"id": "root", "revision": ""}}, "viewport": {"width": 1, "height": 1}}

    def perform(self, node_id, action):
        self.actions.append((node_id, action))
        if self.error:
            raise self.error


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.provider = FakeProvider()
        self.session = ProtocolSession(TOKEN, self.provider)
        self.serial = 0

    def request(self, method, params):
        self.serial += 1
        return self.session.dispatch(json.dumps({"jsonrpc": "2.0", "id": self.serial, "method": method, "params": params}).encode())

    def authenticate(self):
        return self.request("initialize", {"protocolVersion": 1, "token": TOKEN})

    def perform(self, action):
        return self.request("perform", {"ref": {"id": "n1", "revision": "r1"}, "action": action})

    def test_declares_only_actual_capabilities(self):
        result = self.authenticate()["result"]
        self.assertEqual(result["protocolVersion"], 1)
        self.assertFalse(result["keyboard"])
        self.assertFalse(result["screenshots"])
        self.assertNotIn("hover", result["actions"])

    def test_authentication_required(self):
        with self.assertRaises(Exception):
            self.request("snapshot", {})
        self.assertFalse(self.session.authenticated)

    def test_wrong_token_rejected(self):
        with self.assertRaises(ValueError):
            self.request("initialize", {"protocolVersion": 1, "token": "b" * 64})

    def test_protocol_version_rejected(self):
        with self.assertRaises(ValueError):
            self.request("initialize", {"protocolVersion": True, "token": TOKEN})

    def test_duplicate_keys_rejected(self):
        with self.assertRaises(ValueError):
            self.session.dispatch(b'{"id":1,"id":2}')

    def test_nonfinite_json_rejected(self):
        with self.assertRaises(ValueError):
            self.session.dispatch(b'{"id":NaN}')

    def test_utf8_rejected(self):
        with self.assertRaises(UnicodeDecodeError):
            self.session.dispatch(b'\xff')

    def test_notification_rejected(self):
        with self.assertRaises(Exception):
            self.session.dispatch(b'{"jsonrpc":"2.0","method":"snapshot","params":{}}')

    def test_replay_id_rejected(self):
        self.authenticate()
        with self.assertRaises(ValueError):
            self.session.dispatch(b'{"jsonrpc":"2.0","id":1,"method":"snapshot","params":{}}')

    def test_boolean_id_rejected(self):
        with self.assertRaises(ValueError):
            self.session.dispatch(b'{"jsonrpc":"2.0","id":true,"method":"snapshot","params":{}}')

    def test_unknown_field_rejected(self):
        self.authenticate()
        self.assertEqual(self.request("snapshot", {"pixels": False, "script": "anything"})["error"]["data"]["code"], "ENGINE_FAILURE")

    def test_unknown_method_rejected(self):
        self.authenticate()
        self.assertEqual(self.request("evaluate", {})["error"]["data"]["code"], "UNSUPPORTED_CAPABILITY")

    def test_snapshot_never_adds_pixels(self):
        self.authenticate()
        self.assertNotIn("screenshot", self.request("snapshot", {"pixels": True})["result"])

    def test_fill_validates_and_dispatches_once(self):
        self.authenticate()
        self.assertIsNone(self.perform({"kind": "fill", "value": "hello", "sensitive": True})["result"])
        self.assertEqual(len(self.provider.actions), 1)

    def test_fill_rejects_unknown_fields(self):
        self.authenticate()
        self.assertIn("error", self.perform({"kind": "fill", "value": "hello", "modifiers": []}))
        self.assertFalse(self.provider.actions)

    def test_fill_rejects_oversize_text(self):
        self.authenticate()
        self.assertIn("error", self.perform({"kind": "fill", "value": "x" * 65537}))
        self.assertFalse(self.provider.actions)

    def test_fill_rejects_nul(self):
        self.authenticate()
        self.assertIn("error", self.perform({"kind": "fill", "value": "x\0y"}))

    def test_fill_rejects_missing_value(self):
        self.authenticate()
        self.assertIn("error", self.perform({"kind": "fill"}))

    def test_check_rejects_unused_value(self):
        self.authenticate()
        self.assertIn("error", self.perform({"kind": "check", "value": "ignored"}))

    def test_select_valid_index(self):
        self.authenticate()
        self.assertIsNone(self.perform({"kind": "selectOption", "value": {"index": 1}})["result"])

    def test_select_rejects_boolean_index(self):
        self.authenticate()
        self.assertIn("error", self.perform({"kind": "selectOption", "value": {"index": True}}))

    def test_select_rejects_multiple_choices(self):
        self.authenticate()
        self.assertIn("error", self.perform({"kind": "selectOption", "value": ["a", "b"]}))

    def test_backend_error_code_preserved(self):
        self.authenticate()
        self.provider.error = DriverError("NODE_STALE", "object is stale")
        self.assertEqual(self.perform({"kind": "tap"})["error"]["data"]["code"], "NODE_STALE")

    def test_unexpected_exception_cannot_disclose_app_content(self):
        self.authenticate()
        self.provider.error = RuntimeError("SENSITIVE PASSWORD")
        self.assertNotIn("SENSITIVE", json.dumps(self.request("snapshot", {})))

    def test_shutdown_stops(self):
        self.authenticate()
        self.assertIsNone(self.request("shutdown", {})["result"])
        self.assertTrue(self.session.stopped)

    def test_frame_limit(self):
        class Connection:
            def settimeout(self, timeout): pass
            def recv(self, count): return b"x" * MAX_FRAME
        with self.assertRaises(ValueError):
            self.session.serve(Connection())

    def test_fragmented_loopback_frames_roundtrip(self):
        failures = []
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            def run_server():
                try:
                    connection, _ = listener.accept()
                    with connection:
                        self.session.serve(connection)
                except Exception as error:
                    failures.append(error)
            server = threading.Thread(target=run_server, daemon=True)
            server.start()
            with socket.create_connection(listener.getsockname(), timeout=2) as client:
                initialize = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"token": TOKEN, "protocolVersion": 1}}).encode() + b"\n"
                client.sendall(initialize[:17])
                client.sendall(initialize[17:])
                with client.makefile("rb") as stream:
                    self.assertEqual(json.loads(stream.readline())["result"]["protocolVersion"], 1)
                    client.sendall(b'{"jsonrpc":"2.0","id":2,"method":"shutdown","params":{}}\n')
                    self.assertIsNone(json.loads(stream.readline())["result"])
            server.join(timeout=2)
            self.assertFalse(server.is_alive())
            self.assertFalse(failures)

    def test_child_exit_ends_session(self):
        class Connection:
            def settimeout(self, timeout): pass
        with self.assertRaises(ValueError):
            self.session.serve(Connection(), lambda: False)

    def test_secret_is_not_in_target_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "environment.json"
            previous = os.environ.get("E2E_NATIVE_TOKEN")
            os.environ["E2E_NATIVE_TOKEN"] = TOKEN
            try:
                app = OwnedApplication([sys.executable, "-c", "import os,json,sys;open(sys.argv[1],'w').write(json.dumps(dict(os.environ)))", str(output)])
                app.process.wait(timeout=5)
                app.close()
                self.assertNotIn("E2E_NATIVE_TOKEN", json.loads(output.read_text()))
            finally:
                if previous is None:
                    os.environ.pop("E2E_NATIVE_TOKEN", None)
                else:
                    os.environ["E2E_NATIVE_TOKEN"] = previous

    def test_stubborn_child_and_grandchild_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "pid"
            grandchild = "import signal,time,os,sys;signal.signal(signal.SIGTERM,signal.SIG_IGN);open(sys.argv[1],'w').write(str(os.getpid()));time.sleep(60)"
            child = "import signal,subprocess,sys,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]);time.sleep(60)"
            app = OwnedApplication([sys.executable, "-c", child, grandchild, str(marker)])
            try:
                deadline = time.monotonic() + 3
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(marker.exists())
                grandchild_pid = int(marker.read_text())
                start = time.monotonic()
                app.close()
                app.close()  # Idempotent: never signal a potentially reused process group.
                self.assertLess(time.monotonic() - start, 0.5)
                state = Path(f"/proc/{grandchild_pid}/stat")
                deadline = time.monotonic() + 1
                while state.exists() and state.read_text().split()[2] != "Z" and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(not state.exists() or state.read_text().split()[2] == "Z")
            finally:
                app.close()

    def test_owned_process_cleanup(self):
        app = OwnedApplication([sys.executable, "-c", "import time;time.sleep(60)"])
        app.close()
        self.assertIsNotNone(app.process.poll())


if __name__ == "__main__":
    unittest.main()
