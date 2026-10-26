"""Strict, authenticated single-session native bridge protocol."""
import hmac
import json
import socket
import time
from collections.abc import Callable
from typing import Any
from .contracts import ACTIONS, AccessibilityProvider, DriverError

MAX_FRAME = 1024 * 1024
MAX_TEXT = 65536


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def _constant(_: str) -> None:
    raise ValueError("non-finite value")


def _shape(value: Any, keys: set[str], required: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or not required <= value.keys() or value.keys() - keys:
        raise DriverError("ENGINE_FAILURE", "invalid request shape")
    return value


def _text(value: Any, limit: int = MAX_TEXT) -> str:
    if not isinstance(value, str) or len(value) > limit or "\0" in value:
        raise DriverError("ENGINE_FAILURE", "invalid text field")
    return value


class ProtocolSession:
    """Authenticate once; serialize requests; reject replayed or malformed IDs."""

    def __init__(self, token: str, provider: AccessibilityProvider):
        self._token = token
        self._provider = provider
        self.authenticated = False
        self.stopped = False
        self._last_id = 0

    def dispatch(self, raw: bytes) -> dict[str, Any]:
        """Validate a complete LF-free frame before dispatching a backend method."""
        message = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=_object,
                             parse_constant=_constant)
        message = _shape(message, {"jsonrpc", "id", "method", "params"},
                         {"jsonrpc", "id", "method", "params"})
        request_id = message["id"]
        if message["jsonrpc"] != "2.0" or type(request_id) is not int or not 0 < request_id <= 2**53 - 1 or request_id <= self._last_id:
            raise ValueError("invalid request envelope")
        method = _text(message["method"], 64)
        params = message["params"]
        self._last_id = request_id
        if not self.authenticated:
            _shape(params, {"protocolVersion", "token"}, {"protocolVersion", "token"})
            token = _text(params["token"], 256)
            if method != "initialize" or type(params["protocolVersion"]) is not int or params["protocolVersion"] != 1 or not hmac.compare_digest(token, self._token):
                raise ValueError("authentication failed")
            self.authenticated = True
            result: Any = {"protocolVersion": 1, "name": "e2e-platform-atspi", "version": "0.1.0",
                           "actions": list(ACTIONS), "keyboard": False, "screenshots": False}
        else:
            try:
                result = self._invoke(method, params)
            except DriverError as error:
                return {"jsonrpc": "2.0", "id": request_id, "error": {
                    "code": -32000, "message": str(error), "data": {"code": error.code}}}
            except Exception:
                # Native provider failures can include application contents. Never forward them.
                return {"jsonrpc": "2.0", "id": request_id, "error": {
                    "code": -32000, "message": "accessibility operation failed", "data": {"code": "ENGINE_FAILURE"}}}
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    def _invoke(self, method: str, params: Any) -> Any:
        if method == "snapshot":
            params = _shape(params, {"pixels"}, set())
            if "pixels" in params and type(params["pixels"]) is not bool:
                raise DriverError("ENGINE_FAILURE", "invalid pixels flag")
            # No pixels are captured or returned, even when explicitly requested.
            return self._provider.snapshot()
        if method == "perform":
            params = _shape(params, {"ref", "action"}, {"ref", "action"})
            ref = _shape(params["ref"], {"id", "revision"}, {"id", "revision"})
            node_id = _text(ref["id"], 512)
            _text(ref["revision"], 512)
            action = _shape(params["action"], {"kind", "value", "sensitive"}, {"kind"})
            kind = action["kind"]
            if kind not in ACTIONS:
                raise DriverError("UNSUPPORTED_CAPABILITY", "action is unavailable")
            expected = {"kind", "value", "sensitive"} if kind == "fill" else {"kind", "value"} if kind == "selectOption" else {"kind"}
            _shape(action, expected, {"kind", "value"} if kind in ("fill", "selectOption") else {"kind"})
            if kind == "fill":
                _text(action["value"])
                if "sensitive" in action and type(action["sensitive"]) is not bool:
                    raise DriverError("ENGINE_FAILURE", "invalid sensitive flag")
            if kind == "selectOption":
                choice = action["value"]
                if isinstance(choice, str):
                    _text(choice)
                elif isinstance(choice, dict) and len(choice) == 1:
                    if "label" in choice or "value" in choice:
                        _text(next(iter(choice.values())))
                    elif "index" not in choice or type(choice["index"]) is not int or not 0 <= choice["index"] < 10000:
                        raise DriverError("ENGINE_FAILURE", "invalid option index")
                else:
                    raise DriverError("UNSUPPORTED_CAPABILITY", "only one option can be selected")
            self._provider.perform(node_id, action)
            return None
        if method == "shutdown":
            _shape(params, set(), set())
            self.stopped = True
            return None
        raise DriverError("UNSUPPORTED_CAPABILITY", "method is unavailable")

    def serve(self, connection: socket.socket, is_alive: Callable[[], bool] = lambda: True) -> None:
        """Handle one bounded connection; EOF or malformed framing ends ownership."""
        connection.settimeout(0.25)
        authentication_deadline = time.monotonic() + 15
        data = bytearray()
        while not self.stopped:
            if not is_alive():
                raise ValueError("owned application exited")
            if not self.authenticated and time.monotonic() >= authentication_deadline:
                raise ValueError("authentication timed out")
            try:
                chunk = connection.recv(65536)
            except socket.timeout:
                continue
            if not chunk:
                return
            data.extend(chunk)
            while b"\n" in data:
                end = data.index(10)
                if end == 0 or end + 1 > MAX_FRAME:
                    raise ValueError("invalid frame length")
                line = bytes(data[:end])
                del data[:end + 1]
                response = self.dispatch(line)
                encoded = json.dumps(response, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode() + b"\n"
                if len(encoded) > MAX_FRAME:
                    raise ValueError("response too large")
                connection.sendall(encoded)
                if self.stopped:
                    return
            if len(data) >= MAX_FRAME:
                raise ValueError("frame too large")
