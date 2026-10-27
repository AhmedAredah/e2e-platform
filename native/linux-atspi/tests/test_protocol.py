"""Protocol and lifecycle tests do not require a desktop or GI installation."""
import json
import io
import os
from pathlib import Path
import socket
import signal
import select
import subprocess
import sys
import tempfile
import time
import threading
import unittest
from unittest.mock import Mock, patch
import live_smoke

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from e2e_atspi.application import DriverApplication, OwnedApplication, _failure_location
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
    def test_startup_diagnostics_never_include_exception_data(self):
        class SecretException(Exception):
            pass
        for error, category in ((AttributeError("secret-accessible-name"), "AttributeError"),
                                (SecretException("secret-application-output"), "Exception")):
            try:
                raise error
            except Exception as failure:
                self.assertEqual(_failure_location(failure), category + "@external")

    def test_startup_diagnostics_locate_driver_source_without_values(self):
        # Compile a failing expression at the real driver's source path. Only the
        # approved filename and line are emitted; expression text stays private.
        source = str(Path(__file__).resolve().parents[1] / "e2e_atspi" / "provider.py")
        try:
            exec(compile("raise AttributeError('secret-control-name')", source, "exec"))
        except AttributeError as failure:
            self.assertEqual(_failure_location(failure), "AttributeError@provider.py:1")

    def test_readiness_failure_is_sanitized_and_reaps_application(self):
        provider = FakeProvider()
        provider.error = AttributeError("secret-accessible-name")
        owned = Mock()
        owned.process.poll.return_value = None
        output = io.StringIO()
        with patch.dict(os.environ, {"E2E_NATIVE_TOKEN": TOKEN}), \
             patch("e2e_atspi.application.OwnedApplication", return_value=owned), \
             patch.object(DriverApplication, "create_provider", return_value=provider), \
             patch("e2e_atspi.application.time.monotonic", side_effect=[0, 11]), \
             patch("sys.stderr", output):
            self.assertEqual(DriverApplication().run(["fixture"]), 2)
        self.assertIn("stage=accessibility-readiness", output.getvalue())
        self.assertIn("last-snapshot=AttributeError@application.py:", output.getvalue())
        self.assertNotIn("secret-accessible-name", output.getvalue())
        self.assertNotIn(TOKEN, output.getvalue())
        owned.close.assert_called_once_with()

    def test_live_selection_resolves_option_instead_of_same_named_label(self):
        client = live_smoke.Client.__new__(live_smoke.Client)
        option = {"name": "Beta", "role": "option", "states": {"selected": True},
                  "children": [{"name": "Beta", "role": "text"}]}
        with patch.object(client, "snapshot", return_value={"root": {"children": [option]}}):
            with self.assertRaises(AssertionError):
                client.node("Beta")
            self.assertIs(client.node("Beta", role="option"), option)

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

    def test_fill_rejects_unpaired_unicode_surrogate_before_dispatch(self):
        self.authenticate()
        self.assertIn("error", self.perform({"kind": "fill", "value": "\ud800"}))
        self.assertFalse(self.provider.actions)

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

    def test_unknown_mutation_failure_poisoning_prevents_second_dispatch(self):
        self.authenticate()
        self.provider.error = RuntimeError("SENSITIVE PASSWORD")
        response = self.perform({"kind": "tap"})
        self.assertEqual(response["error"]["data"]["code"], "ACTION_MAY_HAVE_COMMITTED")
        self.assertNotIn("SENSITIVE", json.dumps(response))
        self.assertTrue(self.session.stopped)
        with self.assertRaises(ValueError):
            self.perform({"kind": "tap"})
        self.assertEqual(len(self.provider.actions), 1)

    def test_classified_uncertain_mutation_closes_session(self):
        self.authenticate()
        self.provider.error = DriverError("ACTION_MAY_HAVE_COMMITTED", "mutation result unknown")
        self.assertEqual(self.perform({"kind": "tap"})["error"]["data"]["code"], "ACTION_MAY_HAVE_COMMITTED")
        self.assertTrue(self.session.stopped)

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

    def test_live_client_failed_connection_reaps_started_driver(self):
        children = []
        popen = subprocess.Popen
        def launch(*args, **kwargs):
            child = popen(*args, **kwargs)
            children.append(child)
            return child
        with tempfile.TemporaryDirectory() as temporary:
            driver = Path(temporary) / "ready_driver.py"
            driver.write_text('import time\nprint(\'E2E_NATIVE_READY {"port":1}\', flush=True)\ntime.sleep(60)\n')
            with patch.object(live_smoke, "DRIVER", driver), patch.object(live_smoke.subprocess, "Popen", side_effect=launch), patch.object(live_smoke.socket, "create_connection", side_effect=OSError("connect failed")):
                with self.assertRaisesRegex(OSError, "connect failed"):
                    live_smoke.Client()
            self.assertEqual(len(children), 1)
            self.assertIsNotNone(children[0].poll())

    def test_parent_death_setup_rejects_already_reparented_child(self):
        package = str(Path(__file__).resolve().parents[1])
        code = "import sys;sys.path.insert(0,sys.argv[1]);from e2e_atspi.application import _parent_death_signal;_parent_death_signal(0)"
        result = subprocess.run([sys.executable, "-c", code, package], timeout=5, capture_output=True)
        self.assertEqual(result.returncode, 127)

    def test_hangup_reaps_owned_process_group(self):
        package = str(Path(__file__).resolve().parents[1])
        host = """
import sys
sys.path.insert(0, sys.argv[1])
from e2e_atspi.application import DriverApplication
from e2e_atspi.contracts import AccessibilityProvider
class Provider(AccessibilityProvider):
    def snapshot(self): return {"root": {"children": [{"children": [{}]}]}}
    def perform(self, node_id, action): pass
class Host(DriverApplication):
    def create_provider(self, process_id): return Provider()
raise SystemExit(Host().run(sys.argv[2:]))
"""
        child = "import os,sys,time;open(sys.argv[1],'w').write(str(os.getpid()));time.sleep(60)"
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "target.pid"
            driver = subprocess.Popen([sys.executable, "-c", host, package, sys.executable, "-c", child, str(marker)], env={**os.environ, "E2E_NATIVE_TOKEN": TOKEN}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertTrue(select.select([driver.stdout], [], [], 5)[0])
                self.assertTrue(driver.stdout.readline().startswith("E2E_NATIVE_READY "))
                deadline = time.monotonic() + 3
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                target_pid = int(marker.read_text())
                driver.send_signal(signal.SIGHUP)
                self.assertEqual(driver.wait(timeout=5), 0)
                with self.assertRaises(ProcessLookupError):
                    os.kill(target_pid, 0)
            finally:
                if driver.poll() is None:
                    driver.terminate()
                    driver.wait(timeout=5)
                driver.stdout.close()
                driver.stderr.close()


if __name__ == "__main__":
    unittest.main()
