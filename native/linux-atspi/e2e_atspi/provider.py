"""Real GNOME AT-SPI implementation; imported only on supported Linux hosts."""
import time
import json
from typing import Any
from .contracts import AccessibilityProvider, DriverError

MAX_NODES = 10000
MAX_DEPTH = 48
MAX_TEXT = 65536
# Reserve space for the envelope and containers below the 1 MiB wire limit.
MAX_SNAPSHOT_BYTES = 900000

ROLES = {
    "application": "application", "frame": "window", "dialog": "dialog", "alert": "alert",
    "push button": "button", "push button menu": "button", "toggle button": "button",
    "check box": "checkbox", "check menu item": "menuitemcheckbox", "radio button": "radio",
    "radio menu item": "menuitemradio", "text": "textbox", "entry": "textbox",
    "password text": "textbox", "label": "text", "static": "text", "paragraph": "text",
    "combo box": "combobox", "list": "listbox", "list box": "listbox", "list item": "option",
    "menu": "menu", "menu bar": "menubar", "menu item": "menuitem", "separator": "separator",
    "page tab": "tab", "page tab list": "tablist", "table": "grid", "table cell": "gridcell",
    "table column header": "columnheader", "table row header": "rowheader", "tree": "tree",
    "tree item": "treeitem", "slider": "slider", "spin button": "spinbutton",
    "progress bar": "progressbar", "link": "link", "image": "img", "scroll pane": "region",
}


class AtspiProvider(AccessibilityProvider):
    """Query only the launched PID, using AT-SPI semantic APIs, never global input."""

    def __init__(self, process_id: int, *, atspi: Any = None):
        if atspi is None:
            import gi
            gi.require_version("Atspi", "2.0")
            from gi.repository import Atspi
            atspi = Atspi
        self.api = atspi
        self.pid = process_id
        if self.api.init() not in (0, 1):
            raise DriverError("ENGINE_FAILURE", "AT-SPI initialization failed")
        self.api.set_timeout(800, 1200)
        self._objects: dict[str, Any] = {}
        self._ids: dict[Any, str] = {}
        self._next_id = 0
        self._last_seen: set[str] = set()
        self._secure_ids: set[str] = set()
        self._safe_metadata: dict[str, tuple[str, str | None]] = {}
        self._last_metadata: dict[str, tuple[str, str | None]] = {}

    def _state(self, obj: Any, name: str) -> bool:
        return bool(obj.get_state_set().contains(getattr(self.api.StateType, name)))

    def _id(self, obj: Any) -> str:
        if obj not in self._ids:
            if len(self._ids) >= 50000:
                raise DriverError("ENGINE_FAILURE", "accessible identity limit exceeded")
            self._next_id += 1
            identity = f"atspi-{self._next_id}"
            self._ids[obj] = identity
            self._objects[identity] = obj
        return self._ids[obj]

    def _alive(self, obj: Any) -> None:
        obj.clear_cache()
        if self._state(obj, "DEFUNCT") or obj.get_process_id() != self.pid:
            raise DriverError("NODE_STALE", "accessible no longer belongs to the application")

    def snapshot(self) -> dict[str, Any]:
        """Build a bounded tree; unavailable or incomplete sources never prove absence."""
        deadline = time.monotonic() + 8
        seen: set[str] = set()
        truncated = False
        remaining_bytes = MAX_SNAPSHOT_BYTES
        self._last_metadata.clear()
        root: dict[str, Any] = {"ref": {"id": "atspi-root", "revision": ""}, "role": "application", "children": []}
        viewport = {"width": 1, "height": 1}

        def visit(obj: Any, depth: int) -> dict[str, Any] | None:
            nonlocal truncated, remaining_bytes
            if remaining_bytes < 256 or len(seen) >= MAX_NODES or depth > MAX_DEPTH or time.monotonic() >= deadline:
                truncated = True
                return None
            self._alive(obj)
            identity = self._id(obj)
            if identity in seen:
                truncated = True
                return None
            seen.add(identity)
            role_name = obj.get_role_name()
            attributes = obj.get_attributes() or {}
            secure = role_name == "password text" or attributes.get("e2e-secure") == "true" or identity in self._secure_ids
            states = {"secure": secure, "disabled": not self._state(obj, "ENABLED"),
                      "focused": self._state(obj, "FOCUSED"), "hidden": role_name != "application" and not self._state(obj, "SHOWING"),
                      "selected": self._state(obj, "SELECTED")}
            if role_name in ("check box", "check menu item", "radio button", "radio menu item", "toggle button"):
                states["checked"] = self._state(obj, "CHECKED")
            if self._state(obj, "EXPANDABLE"):
                states["expanded"] = self._state(obj, "EXPANDED")
            if secure:
                name, accessible_id = self._safe_metadata.get(identity, ("Secure control", None))
            else:
                name = obj.get_name() or ""
                accessible_id = obj.get_accessible_id()
            node: dict[str, Any] = {"ref": {"id": identity, "revision": ""},
                                    "role": ROLES.get(role_name, "group"),
                                    "name": name if len(name) <= 65536 else "[omitted: name exceeds limit]", "states": states}
            if accessible_id and len(accessible_id) <= 1024:
                node["testId"] = accessible_id
            component = obj.get_component_iface()
            if component is not None and not states["hidden"]:
                rect = component.get_extents(self.api.CoordType.SCREEN)
                if rect and all(abs(x) <= 1000000 for x in (rect.x, rect.y, rect.width, rect.height)) and rect.width >= 0 and rect.height >= 0:
                    node["rect"] = {"x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height}
                    viewport["width"] = max(viewport["width"], min(32768, max(1, rect.x + rect.width)))
                    viewport["height"] = max(viewport["height"], min(32768, max(1, rect.y + rect.height)))
            if secure:
                node["inputPurpose"] = "password" if role_name == "password text" else "generic-secret"
            else:
                text = obj.get_text_iface()
                if text is not None:
                    count = text.get_character_count()
                    content = text.get_text(0, count) if 0 <= count <= MAX_TEXT else "[omitted: text exceeds limit]"
                    node["value" if node["role"] == "textbox" else "text"] = content or ""
            # Charge each node before retention, including worst-case escaped Unicode.
            # Children add their own metadata cost; the allowance covers array syntax.
            cost = len(json.dumps(node, ensure_ascii=True, separators=(",", ":"))) + 32
            if cost > remaining_bytes:
                truncated = True
                remaining_bytes = 0
                seen.discard(identity)
                return None
            remaining_bytes -= cost
            if secure:
                return node
            self._last_metadata[identity] = (node["name"], node.get("testId"))
            children = []
            child_count = obj.get_child_count()
            for index in range(min(child_count, MAX_NODES)):
                if remaining_bytes < 256 or time.monotonic() >= deadline or len(seen) >= MAX_NODES:
                    truncated = True
                    break
                child = obj.get_child_at_index(index)
                if child is None:
                    truncated = True
                    continue
                result = visit(child, depth + 1)
                if result is not None:
                    children.append(result)
            if child_count > MAX_NODES:
                truncated = True
            if children:
                node["children"] = children
            return node

        desktop = self.api.get_desktop(0)
        if desktop is None:
            raise DriverError("ENGINE_FAILURE", "AT-SPI desktop is unavailable")
        matched = False
        desktop_count = desktop.get_child_count()
        if desktop_count > MAX_NODES:
            truncated = True
        for index in range(min(desktop_count, MAX_NODES)):
            if time.monotonic() >= deadline:
                raise DriverError("OPERATION_TIMEOUT", "AT-SPI enumeration exceeded its budget")
            app = desktop.get_child_at_index(index)
            if app is not None and app.get_process_id() == self.pid:
                matched = True
                result = visit(app, 1)
                if result:
                    root["children"].append(result)
        if not matched:
            raise DriverError("ENGINE_FAILURE", "owned application has not exposed an AT-SPI tree")
        self._last_seen = seen
        # Retain live identities; drop defunct proxies without ever reusing the numeric IDs.
        for identity, obj in list(self._objects.items()):
            if identity not in seen and self._state(obj, "DEFUNCT"):
                self._objects.pop(identity)
                self._ids.pop(obj, None)
                self._secure_ids.discard(identity)
                self._safe_metadata.pop(identity, None)
                self._last_metadata.pop(identity, None)
        return {"root": root, "viewport": viewport, "truncated": truncated}

    def _invoke_action(self, obj: Any) -> None:
        interface = obj.get_action_iface()
        if interface is None:
            raise DriverError("UNSUPPORTED_CAPABILITY", "control has no accessible action")
        for index in range(min(interface.get_n_actions(), 32)):
            if interface.get_action_name(index).lower() in ("click", "press", "activate", "toggle", "jump", "select"):
                if not interface.do_action(index):
                    raise DriverError("NOT_ACTIONABLE", "accessible action was rejected")
                return
        raise DriverError("UNSUPPORTED_CAPABILITY", "control has no supported semantic action")

    def perform(self, node_id: str, action: dict[str, Any]) -> None:
        """Resolve current owned objects, then use their actual AT-SPI interfaces."""
        if node_id not in self._last_seen or node_id not in self._objects:
            raise DriverError("NODE_STALE", "reference was not present in the latest snapshot")
        obj = self._objects[node_id]
        self._alive(obj)
        if not self._state(obj, "ENABLED") or not self._state(obj, "SHOWING"):
            raise DriverError("NOT_ACTIONABLE", "control is disabled or hidden")
        kind = action["kind"]
        if kind == "tap":
            self._invoke_action(obj)
        elif kind in ("fill", "clear"):
            editable = obj.get_editable_text_iface()
            if editable is None or not self._state(obj, "EDITABLE"):
                raise DriverError("UNSUPPORTED_CAPABILITY", "control is not editable")
            if action.get("sensitive"):
                self._safe_metadata[node_id] = self._last_metadata.get(node_id, ("Secure control", None))
                self._secure_ids.add(node_id)
            if not editable.set_text_contents(action["value"] if kind == "fill" else ""):
                raise DriverError("NOT_ACTIONABLE", "control rejected text replacement")
        elif kind == "focus":
            component = obj.get_component_iface()
            if component is None or not component.grab_focus():
                raise DriverError("NOT_ACTIONABLE", "control rejected focus")
        elif kind in ("check", "uncheck"):
            if obj.get_role_name() not in ("check box", "check menu item", "radio button", "radio menu item", "toggle button"):
                raise DriverError("UNSUPPORTED_CAPABILITY", "control has no checked state")
            desired = kind == "check"
            if self._state(obj, "CHECKED") != desired:
                self._invoke_action(obj)
                obj.clear_cache()
                # State updates may be asynchronous. Never toggle a second time.
                for _ in range(20):
                    if self._state(obj, "CHECKED") == desired:
                        break
                    time.sleep(0.01)
                    obj.clear_cache()
                else:
                    raise DriverError("NOT_ACTIONABLE", "control did not reach the requested checked state")
        elif kind == "selectOption":
            self._select(obj, action["value"])
        else:
            raise DriverError("UNSUPPORTED_CAPABILITY", "action is unavailable")

    def _select(self, obj: Any, choice: Any) -> None:
        interface = obj.get_selection_iface()
        if interface is None:
            raise DriverError("UNSUPPORTED_CAPABILITY", "control has no selection interface")
        if isinstance(choice, dict) and "value" in choice:
            raise DriverError("UNSUPPORTED_CAPABILITY", "AT-SPI options support label or index, not HTML values")
        count = obj.get_child_count()
        if count > 10000:
            raise DriverError("UNSUPPORTED_CAPABILITY", "selection list exceeds bounds")
        if isinstance(choice, dict) and "index" in choice:
            indices = [choice["index"]] if choice["index"] < count else []
        else:
            label = choice if isinstance(choice, str) else choice["label"]
            indices = [index for index in range(count) if obj.get_child_at_index(index).get_name() == label]
        if len(indices) != 1:
            raise DriverError("NOT_ACTIONABLE", "option is absent or ambiguous")
        candidate = obj.get_child_at_index(indices[0])
        self._alive(candidate)
        if not self._state(candidate, "ENABLED"):
            raise DriverError("NOT_ACTIONABLE", "option is disabled")
        if not interface.select_child(indices[0]):
            raise DriverError("NOT_ACTIONABLE", "control rejected selection")

    def close(self) -> None:
        """Drop owned proxy references and release the client connection."""
        self._objects.clear()
        self._ids.clear()
        self._last_seen.clear()
        self._secure_ids.clear()
        self._safe_metadata.clear()
        self._last_metadata.clear()
        self.api.exit()
