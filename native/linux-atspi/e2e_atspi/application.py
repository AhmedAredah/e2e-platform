"""Owned application lifetime and a loopback-only authenticated server."""
import ctypes
import os
import re
import signal
import socket
import subprocess
import sys
import time
from .contracts import AccessibilityProvider
from .protocol import ProtocolSession
from .provider import AtspiProvider


class OwnedApplication:
    """Own a process group and terminate it on every normal driver exit path."""

    def __init__(self, command: list[str]):
        if not command or not command[0]:
            raise ValueError("an application executable is required after --")
        environment = {key: value for key, value in os.environ.items() if key not in ("E2E_NATIVE_TOKEN", "E2E_NATIVE_PORT")}
        environment.setdefault("GTK_MODULES", "gail:atk-bridge")
        environment.setdefault("NO_AT_BRIDGE", "0")
        self._closed = False
        parent_pid = os.getpid()
        self.process = subprocess.Popen(command, env=environment, stdin=subprocess.DEVNULL,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        start_new_session=True, preexec_fn=lambda: _parent_death_signal(parent_pid))

    def close(self) -> None:
        """Stop the whole owned group; reap the primary child without waiting forever."""
        if self._closed:
            return
        self._closed = True
        try:
            os.killpg(self.process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            self.process.wait(timeout=0.05)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(self.process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        self.process.wait(timeout=2)


def _parent_death_signal(expected_parent: int) -> None:
    """Make the direct app exit if the driver is abruptly killed on Linux."""
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or os.getppid() != expected_parent:
        os._exit(127)


class DriverApplication:
    """Extensible application host: transport, provider and child ownership are separate."""

    def create_provider(self, process_id: int) -> AccessibilityProvider:
        return AtspiProvider(process_id)

    def run(self, command: list[str]) -> int:
        if sys.platform != "linux":
            print("Linux AT-SPI driver requires Linux", file=sys.stderr)
            return 2
        token = os.environ.get("E2E_NATIVE_TOKEN", "")
        if re.fullmatch(r"[a-fA-F0-9]{64}", token) is None:
            print("E2E_NATIVE_TOKEN must be a 32-byte hexadecimal token", file=sys.stderr)
            return 2
        application = None
        provider = None
        previous = {}
        try:
            for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                previous[signum] = signal.signal(signum, _interrupted)
            application = OwnedApplication(command)
            provider = self.create_provider(application.process.pid)
            deadline = time.monotonic() + 10
            while True:
                if application.process.poll() is not None:
                    raise RuntimeError("application exited before accessibility was ready")
                try:
                    initial = provider.snapshot()
                    if any(node.get("children") for node in initial["root"].get("children", [])):
                        break
                except Exception:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("application accessibility readiness timed out")
                time.sleep(0.1)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.bind(("127.0.0.1", 0))
                listener.listen(1)
                listener.settimeout(15)
                print('E2E_NATIVE_READY {"port":%d}' % listener.getsockname()[1], flush=True)
                connection, _ = listener.accept()
                with connection:
                    ProtocolSession(token, provider).serve(connection, lambda: application.process.poll() is None)
            if application.process.poll() not in (None, 0):
                return 1
            return 0
        except (KeyboardInterrupt, SystemExit):
            return 0
        except Exception:
            print("Linux accessibility driver failed; verify GI/AT-SPI dependencies, session bus, display, and application accessibility", file=sys.stderr)
            return 2
        finally:
            # Process supervision may send SIGTERM immediately after the shutdown
            # reply. Do not allow a second signal to interrupt group escalation.
            for signum in previous:
                signal.signal(signum, signal.SIG_IGN)
            if application is not None:
                application.close()
            if provider is not None:
                provider.close()
            for signum, handler in previous.items():
                signal.signal(signum, handler)


def _interrupted(_signum: int, _frame: object) -> None:
    raise KeyboardInterrupt


def main() -> int:
    """Use an explicit argv separator; never interpret commands with a shell."""
    if len(sys.argv) < 3 or sys.argv[1] != "--":
        print("usage: python3 driver.py -- /absolute/path/to/application [arguments...]", file=sys.stderr)
        return 2
    return DriverApplication().run(sys.argv[2:])
