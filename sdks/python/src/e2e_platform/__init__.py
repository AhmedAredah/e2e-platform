"""Typed Python test authoring for the shared E2E Platform runner."""

from .errors import E2EError, ProtocolError, RemoteError
from .http import HttpClient, HttpResponse
from .locators import Locator, LocatorAssertions, Screen
from .process import ApplicationService, OwnedProcess, Processes, ProcessResult
from .session import Application, NativeWindows, Session, Terminal
from .transport import StdioTransport, Transport

__all__ = [
    "ApplicationService",
    "Application",
    "E2EError",
    "HttpClient",
    "HttpResponse",
    "Locator",
    "LocatorAssertions",
    "NativeWindows",
    "OwnedProcess",
    "Processes",
    "ProcessResult",
    "ProtocolError",
    "RemoteError",
    "Screen",
    "Session",
    "StdioTransport",
    "Terminal",
    "Transport",
]
