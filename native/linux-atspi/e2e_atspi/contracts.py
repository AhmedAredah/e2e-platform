"""Backend extension contracts, independent of GObject and transport."""
from abc import ABC, abstractmethod
from typing import Any

ACTIONS = ("tap", "fill", "clear", "focus", "check", "uncheck", "selectOption", "scrollIntoView")


class DriverError(Exception):
    """A safe, stable engine failure; messages never contain application data."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class AccessibilityProvider(ABC):
    """One owned application's semantic tree and declared control operations."""

    supports_actionability = False

    def preflight(self, node_id: str, action: dict[str, Any]) -> None:
        """Read-only validation, only advertised by implementations that supply it."""
        raise DriverError("UNSUPPORTED_CAPABILITY", "actionability is unavailable")

    @abstractmethod
    def snapshot(self) -> dict[str, Any]:
        """Return a bounded, source-redacted protocol-v1 semantic snapshot."""

    @abstractmethod
    def perform(self, node_id: str, action: dict[str, Any]) -> None:
        """Perform one operation, or raise; never silently ignore a request."""

    def close(self) -> None:
        """Release provider resources without taking ownership of other apps."""
