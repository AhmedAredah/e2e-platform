"""Owned process and service objects; supervision stays in the shared runner."""

import base64
import codecs
import time
from dataclasses import dataclass
from typing import Any, TYPE_CHECKING
from .errors import E2EError

if TYPE_CHECKING:
    from .session import Session


def _result_shape(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"status", "exitCode", "signal", "stdout", "stderr", "truncated"}
        and value["status"] in ("exited", "signaled", "timed-out", "aborted", "stopped")
        and (value["exitCode"] is None or type(value["exitCode"]) is int and 0 <= value["exitCode"] <= 4294967295)
        and (value["signal"] is None or isinstance(value["signal"], str))
        and isinstance(value["stdout"], str)
        and isinstance(value["stderr"], str)
        and type(value["truncated"]) is bool
    )


@dataclass(frozen=True)
class ProcessResult:
    status: str
    exit_code: int | None
    signal: str | None
    stdout: bytes
    stderr: bytes
    truncated: bool

    @classmethod
    def from_wire(cls, value: dict[str, Any]) -> "ProcessResult":
        return cls(
            value["status"],
            value["exitCode"],
            value["signal"],
            base64.b64decode(value["stdout"], validate=True),
            base64.b64decode(value["stderr"], validate=True),
            value["truncated"],
        )


class Processes:
    def __init__(self, session: "Session"):
        self._session = session

    def run(
        self,
        executable: str,
        args: list[str] | None = None,
        *,
        stdin: bytes | str | None = None,
        cwd: str | None = None,
        env: dict[str, str | None] | None = None,
        inherit_env: bool = False,
        timeout_ms: int = 30_000,
        expected_exit_codes: list[int] | None = None,
    ) -> ProcessResult:
        params: dict[str, Any] = {
            "executable": executable,
            "args": args or [],
            "binary": True,
            "inheritEnv": inherit_env,
            "timeoutMs": timeout_ms,
        }
        if stdin is not None:
            params["stdinBase64"] = base64.b64encode(stdin.encode() if isinstance(stdin, str) else stdin).decode(
                "ascii"
            )
        if cwd is not None:
            params["cwd"] = cwd
        if env is not None:
            params["env"] = env
        if expected_exit_codes is not None:
            params["expectedExitCodes"] = expected_exit_codes
        return self._session._decode(
            lambda: ProcessResult.from_wire(self._session._call("process.run", params, _result_shape))
        )

    def start(
        self,
        executable: str,
        args: list[str] | None = None,
        *,
        cwd: str | None = None,
        env: dict[str, str | None] | None = None,
        inherit_env: bool = False,
        timeout_ms: int = 30_000,
    ) -> "OwnedProcess":
        params: dict[str, Any] = {
            "executable": executable,
            "args": args or [],
            "inheritEnv": inherit_env,
            "timeoutMs": timeout_ms,
        }
        if cwd is not None:
            params["cwd"] = cwd
        if env is not None:
            params["env"] = env
        value = self._session._call(
            "process.start",
            params,
            lambda v: isinstance(v, dict)
            and set(v) == {"handle", "pid"}
            and type(v["handle"]) is int
            and v["handle"] > 0
            and type(v["pid"]) is int
            and v["pid"] > 0,
        )
        return OwnedProcess(self._session, value["handle"], value["pid"])

    def start_service(
        self,
        executable: str,
        args: list[str] | None = None,
        *,
        ready_text: str,
        startup_timeout_ms: int = 5000,
        **options: Any,
    ) -> "ApplicationService":
        child = self.start(executable, args, **options)
        service = ApplicationService(self._session, child._handle, child.pid)
        service.ready_output = service.wait_for_output(ready_text, timeout_ms=startup_timeout_ms, complete_line=True)
        return service


class OwnedProcess:
    def __init__(self, session: "Session", handle: int, pid: int):
        self._session, self._handle, self.pid = session, handle, pid
        self._stopped: ProcessResult | None = None

    def __enter__(self) -> "OwnedProcess":
        return self

    def __exit__(self, *_error: Any) -> None:
        self.stop()

    def read(self) -> dict[str, Any]:
        def shape(v: Any) -> bool:
            return (
                isinstance(v, dict)
                and set(v) == {"stdout", "stderr", "truncated", "result"}
                and isinstance(v["stdout"], str)
                and isinstance(v["stderr"], str)
                and type(v["truncated"]) is bool
                and (v["result"] is None or _result_shape(v["result"]))
            )

        value = self._session._call("process.read", {"handle": self._handle}, shape)
        return self._session._decode(
            lambda: {
                "stdout": base64.b64decode(value["stdout"], validate=True),
                "stderr": base64.b64decode(value["stderr"], validate=True),
                "truncated": value["truncated"],
                "result": None if value["result"] is None else ProcessResult.from_wire(value["result"]),
            }
        )

    def write(self, data: bytes | str) -> None:
        encoded = base64.b64encode(data.encode() if isinstance(data, str) else data).decode("ascii")
        self._session._void("process.write", {"handle": self._handle, "data": encoded})

    def close_input(self) -> None:
        self._session._void("process.closeInput", {"handle": self._handle})

    def wait_for_output(self, text: str, *, timeout_ms: int = 5000, complete_line: bool = False) -> str:
        """Wait for a bounded UTF-8 readiness marker while the process remains alive."""

        def wait() -> str:
            if not text or type(timeout_ms) is not int or not 0 < timeout_ms <= 2147483647:
                raise E2EError("Invalid output readiness condition")
            deadline = time.monotonic() + timeout_ms / 1000
            while time.monotonic() < deadline:
                state = self.read()
                if state["truncated"] or state["result"] is not None:
                    self._session.expect_equal(
                        False, True, message="Process exited or exceeded output budget before readiness"
                    )
                    raise E2EError("Process exited or exceeded output budget before readiness")
                output = codecs.getincrementaldecoder("utf-8")(errors="strict").decode(state["stdout"], final=False)
                if text in output and (not complete_line or "\n" in output[output.index(text) + len(text) :]):
                    return output
                time.sleep(0.01)
            self._session.expect_equal(False, True, message="Process readiness deadline exceeded")
            raise E2EError("Process readiness deadline exceeded")

        return self._session._decode(wait)

    def stop(self) -> ProcessResult:
        if self._stopped is None:
            self._stopped = self._session._decode(
                lambda: ProcessResult.from_wire(
                    self._session._call("process.stop", {"handle": self._handle}, _result_shape)
                )
            )
        return self._stopped


class ApplicationService(OwnedProcess):
    """An explicitly ready service must stay alive until owned shutdown."""

    ready_output: str = ""

    def __enter__(self) -> "ApplicationService":
        return self

    def __exit__(self, *_error: Any) -> None:
        if self._stopped is None:
            self._session.expect_true(self.read()["result"] is None)
        result = self.stop()
        self._session.expect_true(result.status == "stopped" or result.status == "exited" and result.exit_code == 0)
