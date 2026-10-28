"""Bounded strict JSON with exact integers and decimal assertion operands."""

import json
import math
from decimal import Decimal
from typing import Any
from .errors import ProtocolError

MAX_FRAME = 1024 * 1024
MAX_DEPTH = 64


def _pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in items:
        if key in result:
            raise ProtocolError("Duplicate JSON field")
        result[key] = value
    return result


def _constant(_value: str) -> None:
    raise ProtocolError("Nonfinite JSON number")


def _validate(value: Any, depth: int = 0) -> None:
    if depth > MAX_DEPTH:
        raise ProtocolError("JSON nesting limit exceeded")
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ProtocolError("JSON keys must be strings")
            key.encode("utf-8", errors="strict")
            _validate(item, depth + 1)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _validate(item, depth + 1)
    elif isinstance(value, str):
        value.encode("utf-8", errors="strict")
    elif type(value) is float:
        if not math.isfinite(value):
            raise ProtocolError("Nonfinite JSON number")
    elif isinstance(value, Decimal):
        if not value.is_finite() or len(str(value)) > 4096:
            raise ProtocolError("Invalid decimal operand")
    elif type(value) is int:
        if len(str(value)) > 4096:
            raise ProtocolError("JSON number limit exceeded")
    elif value is not None and type(value) is not bool:
        raise ProtocolError("Value is not JSON serializable")


def dumps(value: Any) -> str:
    """Encode Decimal as its decimal token, never through binary64."""
    try:
        _validate(value)

        def encode(item: Any) -> str:
            if isinstance(item, Decimal):
                return str(item)
            if isinstance(item, dict):
                return "{" + ",".join(json.dumps(k, ensure_ascii=True) + ":" + encode(v) for k, v in item.items()) + "}"
            if isinstance(item, (list, tuple)):
                return "[" + ",".join(encode(v) for v in item) + "]"
            return json.dumps(item, ensure_ascii=True, allow_nan=False, separators=(",", ":"))

        text = encode(value)
        if len(text.encode("utf-8")) > MAX_FRAME:
            raise ProtocolError("JSON frame limit exceeded")
        return text
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ProtocolError("Invalid JSON value") from None


def loads(data: bytes | str) -> Any:
    """Reject duplicates, invalid UTF-8, nonfinite numbers and excessive depth."""
    try:
        raw = data.encode("utf-8") if isinstance(data, str) else data
        if len(raw) > MAX_FRAME:
            raise ProtocolError("JSON frame limit exceeded")
        value = json.loads(
            raw.decode("utf-8", errors="strict"),
            object_pairs_hook=_pairs,
            parse_float=Decimal,
            parse_constant=_constant,
        )
        _validate(value)
        return value
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ProtocolError("Invalid JSON response") from None
