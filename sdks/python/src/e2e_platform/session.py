"""Public Python objects share the existing runner's lifecycle and policy."""

import asyncio
from typing import Any, Callable, TypeVar
from .codec import dumps
from .errors import ProtocolError
from .http import HttpClient
from .locators import Screen
from .process import Processes
from .transport import Transport

T = TypeVar("T")


class Application:
    def __init__(self, session: "Session"):
        self._session = session

    def open(self, path: str | None = None) -> None:
        self._session._void("app.open", {} if path is None else {"path": path})

    def restart(self) -> None:
        self._session._void("app.restart", {})

    def clear_state(self) -> None:
        self._session._void("app.clearState", {})

    def back(self) -> None:
        self._session._void("app.back", {})

    def screenshot(self, label: str | None = None) -> Any:
        return self._session._call("app.screenshot", {} if label is None else {"label": label})

    @property
    def base_url(self) -> str | None:
        return self._session._call("app.baseUrl", {}, lambda v: v is None or isinstance(v, str))


class NativeWindows:
    def __init__(self, session: "Session"):
        self._session = session

    def windows(self) -> list[dict[str, Any]]:
        return self._session._call(
            "native.windows", {}, lambda v: isinstance(v, list) and all(isinstance(x, dict) for x in v)
        )

    def activate(self, identity: str) -> None:
        self._session._void("native.activateWindow", {"id": identity})


class Terminal:
    def __init__(self, session: "Session"):
        self._session = session

    def write(self, text: str) -> None:
        self._session._void("terminal.write", {"text": text})

    def press(self, key: str) -> None:
        self._session._void("terminal.press", {"key": key})

    def resize(self, columns: int, rows: int) -> None:
        self._session._void("terminal.resize", {"columns": columns, "rows": rows})

    def snapshot(self) -> dict[str, Any]:
        return self._session._call(
            "terminal.snapshot", {}, lambda v: isinstance(v, dict) and isinstance(v.get("text"), str)
        )

    def wait_for(self, text: str, *, timeout_ms: int = 5000) -> dict[str, Any]:
        return self._session._call(
            "terminal.waitFor",
            {"text": text, "timeoutMs": timeout_ms},
            lambda v: isinstance(v, dict) and isinstance(v.get("text"), str),
        )


class Session:
    """Compose application boundaries without duplicating any driver implementation."""

    def __init__(self, transport: Transport):
        self.transport = transport
        self.app = Application(self)
        self.screen = Screen(self)
        self.processes = Processes(self)
        self.http = HttpClient(self)
        self.terminal = Terminal(self)
        self.native = NativeWindows(self)

    def _decode(self, operation: Callable[[], T]) -> T:
        try:
            return operation()
        except BaseException:
            self.transport.invalidate()
            raise

    def _call(self, method: str, params: dict[str, Any], validate: Callable[[Any], bool] = lambda _: True) -> Any:
        def call() -> Any:
            result = self.transport.request(method, params)
            if not validate(result):
                raise ProtocolError("Invalid typed operation response")
            return result

        return self._decode(call)

    def _void(self, method: str, params: dict[str, Any]) -> None:
        self._call(method, params, lambda value: value is None)

    def expect_equal(self, actual: Any, expected: Any, *, message: str | None = None) -> None:
        self._decode(
            lambda: self._void(
                "expect.equal",
                {
                    "actual": dumps(actual),
                    "expected": dumps(expected),
                    **({} if message is None else {"message": message}),
                },
            )
        )

    def expect_true(self, value: bool) -> None:
        self._void("expect.true", {"actual": value})

    async def run_async(self, operation: Callable[..., T], /, *args: Any, **kwargs: Any) -> T:
        """Offload a synchronous SDK operation without blocking the user's asyncio loop.

        Cancellation invalidates this session: the parent must end the attempt;
        an in-flight mutation cannot be assumed cancelled or replayed.
        """
        try:
            return await asyncio.to_thread(operation, *args, **kwargs)
        except asyncio.CancelledError:
            self.transport.invalidate()
            raise
