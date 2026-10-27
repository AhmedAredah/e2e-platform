#!/usr/bin/env python3
"""Run actual Windows UIA acceptance checks; never substitute a fake provider."""
from __future__ import annotations

import argparse
import ctypes
import json
import os
from pathlib import Path
import queue
import secrets
import socket
import subprocess
import sys
import threading
import time


def nodes(root):
    yield root
    for child in root.get("children", []):
        yield from nodes(child)


class RpcError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class Session:
    def __init__(self, driver: Path, app: Path, broken=False):
        self.token = secrets.token_hex(32)
        env = dict(os.environ, E2E_NATIVE_TOKEN=self.token, E2E_NATIVE_PORT="0")
        self.process = subprocess.Popen([str(driver), "--", str(app), *( ["--planted-bug"] if broken else [])],
                                        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.socket = None
        self.stream = None
        self.application_pids = []
        self.counter = 0
        output = queue.Queue()
        threading.Thread(target=lambda: output.put(self.process.stdout.readline()), daemon=True).start()
        try:
            line = output.get(timeout=30)
            if not line.startswith("E2E_NATIVE_READY "):
                raise AssertionError("Driver did not announce readiness")
            port = json.loads(line.removeprefix("E2E_NATIVE_READY "))["port"]
            self.socket = socket.create_connection(("127.0.0.1", port), timeout=15)
            self.stream = self.socket.makefile("rwb")
            initialized = self.call("initialize", {"protocolVersion": 1, "token": self.token})
            assert initialized.get("actionability") is True
            assert initialized["keyboard"] is False and initialized["screenshots"] is False
            self.wait_for(lambda snapshot: self.find(snapshot, "submit"))
            snapshot = self.snapshot()
            self.application_pids = [int(self.find(snapshot, key)["name"]) for key in ("process-id", "child-process-id")]
        except BaseException:
            self.close()
            raise

    def call(self, method, params):
        self.counter += 1
        self.stream.write(json.dumps({"jsonrpc": "2.0", "id": self.counter, "method": method, "params": params}).encode() + b"\n")
        self.stream.flush()
        raw = self.stream.readline(1024 * 1024 + 1)
        assert raw.endswith(b"\n") and len(raw) <= 1024 * 1024, "Missing or oversized RPC response"
        result = json.loads(raw)
        assert result["id"] == self.counter
        if "error" in result:
            raise RpcError(result["error"]["data"]["code"])
        return result["result"]

    def snapshot(self):
        snapshot = self.call("snapshot", {})
        assert not snapshot.get("truncated"), "UIA tree unexpectedly truncated"
        assert "fixture-secret-must-not-appear" not in json.dumps(snapshot), "Password disclosed"
        return snapshot

    @staticmethod
    def find(snapshot, test_id):
        matches = [node for node in nodes(snapshot["root"]) if node.get("testId") == test_id]
        if not matches:
            return None
        assert len(matches) == 1, "Ambiguous test ID"
        return matches[0]

    def wait_for(self, predicate):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                snapshot = self.snapshot()
                if predicate(snapshot):
                    return snapshot
            except RpcError as error:
                if error.code != "NODE_STALE":
                    raise
            time.sleep(0.05)
        raise AssertionError("Accessible state did not reach expected condition")

    def perform(self, test_id, kind, **payload):
        node = self.find(self.snapshot(), test_id)
        assert node, f"Missing accessible control: {test_id}"
        return self.call("perform", {"ref": node["ref"], "action": {"kind": kind, **payload}})

    def close(self):
        if self.stream:
            try:
                self.call("shutdown", {})
            except (OSError, RpcError, AssertionError, ValueError):
                pass
            self.stream.close()
        if self.socket:
            self.socket.close()
        try:
            code = self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
            raise AssertionError("Driver did not terminate")
        for pid in self.application_pids:
            assert not process_alive(pid), "Owned application or descendant survived cleanup"
        assert code == 0, "Driver exited with a failure"


def process_alive(pid):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel.WaitForSingleObject.restype = ctypes.c_ulong
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x00100000, 0, pid)
    if not handle:
        error = ctypes.get_last_error()
        if error == 87:  # ERROR_INVALID_PARAMETER: the PID no longer exists.
            return False
        raise ctypes.WinError(error)
    try:
        state = kernel.WaitForSingleObject(handle, 0)
        if state not in (0, 258):
            raise ctypes.WinError(ctypes.get_last_error())
        return state == 258
    finally:
        kernel.CloseHandle(handle)


def expect_error(session, test_id, action, expected, **payload):
    try:
        session.perform(test_id, action, **payload)
    except RpcError as error:
        assert error.code == expected, (error.code, expected)
    else:
        raise AssertionError("Unsupported action reported success")


def verify(driver, app, broken):
    session = Session(driver, app, broken)
    checks = 0
    try:
        snapshot = session.snapshot()
        assert session.find(snapshot, "environment")["name"] == "clean"
        secure = session.find(snapshot, "password")
        assert secure["states"]["secure"] and not any(key in secure for key in ("value", "text", "attributes", "children"))
        checks += 2
        original = session.find(snapshot, "input")
        assert session.call("actionability", {"ref": original["ref"], "action": {"kind": "fill", "value": "must-not-be-written"}}) is None
        assert session.find(session.snapshot(), "input").get("value") == original.get("value"), "preflight mutated input"
        checks += 1
        session.perform("input", "fill", value="portable desktop")
        session.perform("submit", "tap")
        snapshot = session.wait_for(lambda tree: session.find(tree, "result")["name"] != "idle")
        actual = session.find(snapshot, "result")["name"]
        if broken:
            assert actual == "WRONG", "Fixture did not reach its planted wrong-output state"
            try:
                assert actual == "portable desktop", "Application output is wrong"
            except AssertionError:
                return checks + 1
            raise AssertionError("Planted wrong output escaped detection")
        assert actual == "portable desktop", "Application output is wrong"
        checks += 1
        session.perform("input", "clear")
        session.wait_for(lambda tree: session.find(tree, "input").get("value") == "")
        session.perform("input", "focus")
        session.wait_for(lambda tree: session.find(tree, "input")["states"]["focused"])
        checks += 2
        session.perform("enabled", "check")
        session.wait_for(lambda tree: session.find(tree, "enabled")["states"]["checked"])
        session.perform("enabled", "check")
        assert session.find(session.snapshot(), "enabled")["states"]["checked"], "check must be idempotent"
        session.perform("enabled", "uncheck")
        session.wait_for(lambda tree: not session.find(tree, "enabled")["states"]["checked"])
        checks += 3
        session.perform("toggle-choice", "tap")
        session.perform("choice", "selectOption", value={"label": "Beta"})
        session.wait_for(lambda tree: any(node.get("name") == "Beta" and node.get("states", {}).get("selected") for node in nodes(tree["root"])))
        session.perform("toggle-choice", "tap")
        checks += 1
        delayed = session.find(session.snapshot(), "delayed-choice")
        for label in ("Later", "Disabled option", "Duplicate"):
            try:
                session.call("actionability", {"ref": delayed["ref"], "action": {"kind": "selectOption", "value": label}})
            except RpcError as error:
                assert error.code == "NOT_ACTIONABLE"
            else:
                raise AssertionError("Absent, disabled or ambiguous option reported ready")
        session.perform("load-choice", "tap")
        deadline = time.monotonic() + 5
        while True:
            delayed = session.find(session.snapshot(), "delayed-choice")
            try:
                session.call("actionability", {"ref": delayed["ref"], "action": {"kind": "selectOption", "value": "Later"}})
                break
            except RpcError as error:
                assert error.code == "NOT_ACTIONABLE" and time.monotonic() < deadline
                time.sleep(0.05)
        snapshot = session.snapshot()
        assert not any(node.get("name") == "Later" and node.get("states", {}).get("selected") for node in nodes(snapshot["root"])), "preflight changed selection"
        session.perform("delayed-choice", "selectOption", value="Later")
        session.wait_for(lambda tree: any(node.get("name") == "Later" and node.get("states", {}).get("selected") for node in nodes(tree["root"])))
        checks += 4
        expect_error(session, "readonly", "fill", "NOT_ACTIONABLE", value="changed")
        expect_error(session, "disabled", "tap", "NOT_ACTIONABLE")
        checks += 2
        stale = session.find(session.snapshot(), "transient")["ref"]
        session.perform("remove", "tap")
        session.wait_for(lambda tree: session.find(tree, "transient") is None)
        try:
            session.call("perform", {"ref": stale, "action": {"kind": "tap"}})
        except RpcError as error:
            assert error.code == "NODE_STALE"
        else:
            raise AssertionError("Stale node accepted")
        checks += 1
        expect_error(session, "clipped", "tap", "NOT_ACTIONABLE")
        expect_error(session, "clipped", "scrollIntoView", "UNSUPPORTED_CAPABILITY")
        late = session.find(session.snapshot(), "late")
        assert late is not None, "clipped fixture control must remain discoverable"
        try:
            session.call("actionability", {"ref": late["ref"], "action": {"kind": "tap"}})
        except RpcError as error:
            assert error.code == "NOT_ACTIONABLE"
        else:
            raise AssertionError("Clipped control was actionable before scrolling")
        session.perform("late", "scrollIntoView")
        session.wait_for(lambda tree: not session.find(tree, "late")["states"]["hidden"])
        session.perform("late", "tap")
        session.perform("input", "scrollIntoView")
        session.wait_for(lambda tree: not session.find(tree, "input")["states"]["hidden"])
        session.wait_for(lambda tree: session.find(tree, "result")["name"] == "scrolled")
        checks += 2
        session.perform("input", "fill", value="sensitive-marker", sensitive=True)
        snapshot = session.snapshot()
        assert "sensitive-marker" not in json.dumps(snapshot)
        assert session.find(snapshot, "input")["states"]["secure"]
        checks += 1
        return checks
    finally:
        session.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--driver", required=True, type=Path)
    parser.add_argument("--app", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Live UIA verification requires Windows; this is not a simulated pass")
    positive = verify(args.driver.resolve(strict=True), args.app.resolve(strict=True), False)
    negative = verify(args.driver.resolve(strict=True), args.app.resolve(strict=True), True)
    print(json.dumps({"suite": "windows-uia-wpf-live", "positive_checks": positive,
                      "planted_defect_checks": negative, "cleanup": "passed", "platform": sys.platform}))


if __name__ == "__main__":
    main()
