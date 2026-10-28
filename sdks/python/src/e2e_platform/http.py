"""Bounded HTTP; redirects, cookies and service reset are explicit caller policy."""

from dataclasses import dataclass, field
from typing import Any, TYPE_CHECKING
from .codec import dumps, loads

if TYPE_CHECKING:
    from .session import Session


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: dict[str, str]
    body: str
    _session: "Session" = field(repr=False, compare=False)

    def expect_status(self, expected: int) -> "HttpResponse":
        self._session.expect_equal(self.status, expected, message="HTTP status")
        return self

    def json(self) -> Any:
        """Preserve Python integers and Decimal; reject duplicate keys and nonfinite values."""
        return self._session._decode(lambda: loads(self.body))


class HttpClient:
    def __init__(self, session: "Session"):
        self._session = session

    def request(
        self,
        url: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        body: str | None = None,
        timeout_ms: int = 30_000,
    ) -> HttpResponse:
        params: dict[str, Any] = {"url": url, "method": method, "headers": headers or {}, "timeoutMs": timeout_ms}
        if body is not None:
            params["body"] = body
        value = self._session._call(
            "http.request",
            params,
            lambda v: isinstance(v, dict)
            and set(v) == {"status", "headers", "body"}
            and type(v["status"]) is int
            and 100 <= v["status"] <= 599
            and isinstance(v["body"], str)
            and isinstance(v["headers"], dict)
            and all(isinstance(k, str) and isinstance(x, str) for k, x in v["headers"].items()),
        )
        return HttpResponse(value["status"], value["headers"], value["body"], self._session)

    def get(self, url: str, **options: Any) -> HttpResponse:
        return self.request(url, method="GET", **options)

    def post_json(
        self, url: str, value: Any, *, headers: dict[str, str] | None = None, timeout_ms: int = 30_000
    ) -> HttpResponse:
        body = self._session._decode(lambda: dumps(value))
        return self.request(
            url,
            method="POST",
            headers={"content-type": "application/json", **(headers or {})},
            body=body,
            timeout_ms=timeout_ms,
        )
