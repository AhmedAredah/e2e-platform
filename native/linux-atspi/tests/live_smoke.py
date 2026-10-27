#!/usr/bin/env python3
"""Actual GTK/AT-SPI acceptance, including a planted defect. Never silently skips."""
import json
import os
from pathlib import Path
import secrets
import selectors
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
DRIVER = ROOT / "native/linux-atspi/driver.py"
FIXTURE = ROOT / "examples/with-desktop/python/gtk_controls.py"


def walk(node):
    yield node
    for child in node.get("children", []):
        yield from walk(child)


class Client:
    def __init__(self, wrong=False):
        self.token = secrets.token_hex(32)
        self.socket = None
        self.stream = None
        self.child = subprocess.Popen([sys.executable, str(DRIVER), "--", sys.executable, str(FIXTURE), *(["--wrong"] if wrong else [])],
                                      env={**os.environ, "E2E_NATIVE_TOKEN": self.token}, stdout=subprocess.PIPE, text=True)
        selector = selectors.DefaultSelector()
        try:
            selector.register(self.child.stdout, selectors.EVENT_READ)
            if not selector.select(timeout=15):
                raise RuntimeError("driver readiness timed out")
            line = self.child.stdout.readline()
            if not line.startswith("E2E_NATIVE_READY "):
                raise RuntimeError("driver did not become ready")
            self.socket = socket.create_connection(("127.0.0.1", json.loads(line.split(" ", 1)[1])["port"]), timeout=5)
            self.stream = self.socket.makefile("rwb")
            self.request_id = 0
            self.call("initialize", {"token": self.token, "protocolVersion": 1})
        except Exception:
            self._cleanup(terminate=True)
            raise
        finally:
            selector.close()

    def call(self, method, params):
        self.request_id += 1
        self.stream.write(json.dumps({"jsonrpc": "2.0", "id": self.request_id, "method": method, "params": params}).encode() + b"\n")
        self.stream.flush()
        line = self.stream.readline(1024 * 1024 + 1)
        if not line.endswith(b"\n") or len(line) > 1024 * 1024:
            raise RuntimeError("missing or oversized native response")
        result = json.loads(line)
        if result.get("id") != self.request_id or result.get("jsonrpc") != "2.0":
            raise RuntimeError("invalid native response")
        if "error" in result:
            raise RuntimeError(result["error"]["data"]["code"])
        return result["result"]

    def snapshot(self):
        result = self.call("snapshot", {})
        if result.get("truncated"):
            raise AssertionError("fixture tree unexpectedly truncated")
        return result

    def node(self, name, *, role=None):
        nodes = [node for node in walk(self.snapshot()["root"])
                 if node.get("name") == name and (role is None or node.get("role") == role)]
        if len(nodes) != 1:
            raise AssertionError(f"expected exactly one {name} control")
        return nodes[0]

    def perform(self, name, **action):
        self.call("perform", {"ref": self.node(name)["ref"], "action": action})

    def close(self):
        try:
            self.call("shutdown", {})
        finally:
            code = self._cleanup()
        if code:
            raise AssertionError(f"driver cleanup exit {code}")

    def _cleanup(self, terminate=False):
        if self.stream is not None:
            self.stream.close()
        if self.socket is not None:
            self.socket.close()
        if terminate and self.child.poll() is None:
            self.child.terminate()
        try:
            return self.child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.child.terminate()
            try:
                return self.child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.child.kill()
                return self.child.wait(timeout=2)
        finally:
            if self.child.stdout is not None:
                self.child.stdout.close()


def scenario(wrong=False):
    client = Client(wrong)
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                snapshot = client.snapshot()
                if any(node.get("name") == "Name" for node in walk(snapshot["root"])):
                    break
            except RuntimeError:
                pass
            if time.monotonic() > deadline:
                raise AssertionError("GTK did not expose its accessible tree")
            time.sleep(0.1)
        assert "fixture-secret-never-serialize" not in json.dumps(snapshot)
        password = client.node("Secure control")
        assert password["states"]["secure"]
        assert not {"value", "text", "attributes", "children"} & password.keys()
        client.perform("Name", kind="focus")
        client.perform("Name", kind="fill", value="Ada", sensitive=False)
        assert client.node("Name")["value"] == "Ada"
        client.perform("Remember", kind="check")
        client.perform("Remember", kind="check")
        assert client.node("Remember")["states"]["checked"]
        client.perform("Remember", kind="uncheck")
        assert not client.node("Remember")["states"]["checked"]
        client.perform("Choice", kind="selectOption", value={"index": 1})
        # GTK exposes both the list row and its label with the same name.
        # Selection belongs to the option, so resolve by role as well as name.
        assert client.node("Beta", role="option")["states"]["selected"]
        client.perform("Submit", kind="tap")
        expected = "Hello Ada"
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            result = client.node("Result").get("text")
            if result == expected:
                break
            time.sleep(0.05)
        if wrong:
            assert result != expected, "planted wrong-output defect escaped detection"
        else:
            assert result == expected, "accessible button did not produce the expected result"
        client.perform("Name", kind="clear")
        assert client.node("Name")["value"] == ""
    finally:
        client.close()


if __name__ == "__main__":
    scenario()
    scenario(wrong=True)
    print(json.dumps({"backend": "linux-atspi", "toolkit": "GTK3", "positive": "passed", "plantedDefect": "detected", "cleanup": "passed"}))
