"""Semantic locator objects resolve fresh through the selected engine."""

from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from .session import Session


class Screen:
    def __init__(self, session: "Session", selector: list[dict[str, Any]] | None = None):
        self._session = session
        self._selector = selector or []

    def _query(self, kind: str, value: str, **options: Any) -> "Locator":
        return Locator(self._session, [*self._selector, {"kind": kind, "value": value, **options}])

    def get_by_role(self, role: str, *, name: str | None = None, exact: bool = True) -> "Locator":
        return self._query("role", role, exact=exact, **({} if name is None else {"name": name}))

    def get_by_text(self, text: str, *, exact: bool = True) -> "Locator":
        return self._query("text", text, exact=exact)

    def get_by_label(self, text: str, *, exact: bool = True) -> "Locator":
        return self._query("label", text, exact=exact)

    def get_by_placeholder(self, text: str, *, exact: bool = True) -> "Locator":
        return self._query("placeholder", text, exact=exact)

    def get_by_display_value(self, text: str, *, exact: bool = True) -> "Locator":
        return self._query("displayValue", text, exact=exact)

    def get_by_test_id(self, test_id: str) -> "Locator":
        return self._query("testId", test_id)


class Locator(Screen):
    def _action(self, action: str, **params: Any) -> None:
        self._session._void("locator.action", {"selector": self._selector, "action": action, **params})

    def click(self) -> None:
        self._action("tap")

    def double_click(self) -> None:
        self._action("doubleTap")

    def right_click(self) -> None:
        self._action("secondaryTap")

    def fill(self, value: str) -> None:
        self._action("fill", value=value)

    def clear(self) -> None:
        self._action("clear")

    def focus(self) -> None:
        self._action("focus")

    def press(self, key: str) -> None:
        self._action("press", value=key)

    def check(self) -> None:
        self._action("check")

    def uncheck(self) -> None:
        self._action("uncheck")

    def select_option(self, value: str) -> None:
        self._action("selectOption", value=value)

    def scroll_into_view(self) -> None:
        self._action("scrollIntoView")

    def hover(self) -> None:
        self._action("hover")

    def text_content(self) -> str | None:
        return self._session._call(
            "locator.read",
            {"selector": self._selector, "property": "textContent"},
            lambda v: v is None or isinstance(v, str),
        )

    def input_value(self) -> str:
        return self._session._call(
            "locator.read", {"selector": self._selector, "property": "inputValue"}, lambda v: isinstance(v, str)
        )

    def count(self) -> int:
        return self._session._call(
            "locator.read", {"selector": self._selector, "property": "count"}, lambda v: type(v) is int and v >= 0
        )

    def expect(self, *, timeout_ms: int = 5000, message: str | None = None) -> "LocatorAssertions":
        return LocatorAssertions(self, timeout_ms=timeout_ms, message=message)


class LocatorAssertions:
    def __init__(self, locator: Locator, *, timeout_ms: int, message: str | None, negate: bool = False):
        self._locator, self._timeout, self._message, self._negate = locator, timeout_ms, message, negate

    @property
    def not_(self) -> "LocatorAssertions":
        return LocatorAssertions(
            self._locator, timeout_ms=self._timeout, message=self._message, negate=not self._negate
        )

    def _assert(self, matcher: str, **params: Any) -> None:
        self._locator._session._void(
            "locator.assert",
            {
                "selector": self._locator._selector,
                "matcher": matcher,
                "timeoutMs": self._timeout,
                "negate": self._negate,
                **({} if self._message is None else {"message": self._message}),
                **params,
            },
        )

    def to_be_visible(self) -> None:
        self._assert("toBeVisible")

    def to_be_hidden(self) -> None:
        self._assert("toBeHidden")

    def to_be_enabled(self) -> None:
        self._assert("toBeEnabled")

    def to_be_disabled(self) -> None:
        self._assert("toBeDisabled")

    def to_be_checked(self) -> None:
        self._assert("toBeChecked")

    def to_have_text(self, expected: str) -> None:
        self._assert("toHaveText", expected=expected)

    def to_contain_text(self, expected: str) -> None:
        self._assert("toContainText", expected=expected)

    def to_have_value(self, expected: str) -> None:
        self._assert("toHaveValue", expected=expected)

    def to_have_count(self, expected: int) -> None:
        self._assert("toHaveCount", expected=expected)
