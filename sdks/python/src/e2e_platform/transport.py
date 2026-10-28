"""Synchronous transport extension point; the parent owns process deadlines."""

from abc import ABC, abstractmethod
from threading import RLock
from typing import Any, BinaryIO
from .codec import MAX_FRAME, dumps, loads
from .errors import ProtocolError, RemoteError


class Transport(ABC):
    """Implement request and invalidation while preserving at-most-once dispatch."""

    @abstractmethod
    def request(self, method: str, params: dict[str, Any]) -> Any:
        """Send once; fail rather than replay an uncertain operation."""

    @abstractmethod
    def invalidate(self) -> None:
        """Prevent later use after a protocol or serialization failure."""


class StdioTransport(Transport):
    """Private child pipes, ordered IDs, one operation at a time and sticky failure."""

    def __init__(self, reader: BinaryIO, writer: BinaryIO):
        self._reader = reader
        self._writer = writer
        self._lock = RLock()
        self._failed = False
        self._next_id = 0

    @property
    def failed(self) -> bool:
        return self._failed

    def invalidate(self) -> None:
        # Cancellation must not wait for a worker holding the pipe-read lock.
        self._failed = True

    def request(self, method: str, params: dict[str, Any]) -> Any:
        with self._lock:
            if self._failed:
                raise ProtocolError("Authoring session is unusable")
            try:
                self._next_id += 1
                if self._next_id > 10_000:
                    raise ProtocolError("Authoring request limit exceeded")
                packet = dumps({"protocol": 2, "id": self._next_id, "method": method, "params": params})
                pending = memoryview(packet.encode("utf-8") + b"\n")
                while pending:
                    written = self._writer.write(pending)
                    if written is None or written <= 0:
                        raise ProtocolError("Authoring pipe write failed")
                    pending = pending[written:]
                self._writer.flush()
                raw = self._reader.readline(MAX_FRAME + 2)
                if not raw.endswith(b"\n") or len(raw) > MAX_FRAME + 1 or raw == b"\n":
                    raise ProtocolError("Incomplete or oversized authoring response")
                result = loads(raw[:-1])
                if not isinstance(result, dict) or set(result) not in (
                    {"protocol", "id", "result"},
                    {"protocol", "id", "error"},
                ):
                    raise ProtocolError("Invalid authoring response envelope")
                if (
                    type(result["protocol"]) is not int
                    or result["protocol"] != 2
                    or type(result["id"]) is not int
                    or result["id"] != self._next_id
                ):
                    raise ProtocolError("Mismatched authoring response")
                if "error" in result:
                    raise RemoteError("Shared runner operation failed; inspect its per-case report")
                if self._failed:
                    raise ProtocolError("Authoring session was cancelled during the operation")
                return result["result"]
            except BaseException:
                self._failed = True
                raise
