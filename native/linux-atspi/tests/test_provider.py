"""Provider-contract tests against a faithful in-memory AT-SPI interface double."""
from pathlib import Path
import sys
import json
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from e2e_atspi.contracts import DriverError
from e2e_atspi.provider import AtspiProvider


class StateSet:
    def __init__(self, flags): self.flags = flags
    def contains(self, flag): return flag in self.flags


class FakeObject:
    def __init__(self, name, role, children=(), *, secure=False, pid=10):
        self.name, self.role, self.children, self.pid = name, role, list(children), pid
        self.flags = {"ENABLED", "SHOWING", "VISIBLE", "FOCUSABLE", "EDITABLE"}
        self.value = "fixture-secret" if secure else ""
        self.attributes = {"e2e-secure": "true"} if secure else {}
        self.edits = 0
        self.actions = 0
        self.reads = 0
        self.rejected = False
    def clear_cache(self): pass
    def get_state_set(self): return StateSet(self.flags)
    def get_process_id(self): return self.pid
    def get_role_name(self): return self.role
    def get_attributes(self): return self.attributes
    def get_name(self): return self.name
    def get_accessible_id(self): return self.name.lower()
    def get_component_iface(self): return None
    def get_value_iface(self): return None
    def get_text_iface(self): return self
    def get_character_count(self): return len(self.value)
    # Accessible.get_text is a deprecated interface accessor, not Text.get_text.
    # GI returns this same object for get_text_iface(), exposing the collision.
    def get_text(self): return self
    def get_child_count(self): return len(self.children)
    def get_child_at_index(self, index): return self.children[index]
    def get_editable_text_iface(self): return self if self.role in ("entry", "password text") else None
    def set_text_contents(self, value):
        self.edits += 1
        self.value = value
        return not self.rejected
    def get_action_iface(self): return self if self.role in ("check box", "push button") else None
    def get_n_actions(self): return 1
    def get_action_name(self, index): return "click"
    def do_action(self, index):
        self.actions += 1
        if self.role == "check box":
            self.flags.symmetric_difference_update({"CHECKED"})
        return not self.rejected
    def get_selection_iface(self): return self if self.role == "list" else None
    def select_child(self, index):
        self.children[index].flags.add("SELECTED")
        return not self.rejected


class StateTypes:
    def __getattr__(self, name): return name


class TextInterface:
    @staticmethod
    def get_character_count(obj): return len(obj.value)

    @staticmethod
    def get_text(obj, start, end):
        obj.reads += 1
        return obj.value[start:end]


class Api:
    ScrollType = type("ScrollTypes", (), {"ANYWHERE": 6})
    Value = type("ValueInterface", (), {"get_current_value": staticmethod(lambda obj: obj.numeric)})
    StateType = StateTypes()
    Text = TextInterface
    def __init__(self, app): self.desktop = FakeObject("Desktop", "desktop", [app])
    def init(self): return 0
    def set_timeout(self, first, second): pass
    def get_desktop(self, number): return self.desktop
    def exit(self): pass


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.entry = FakeObject("Name", "entry")
        self.password = FakeObject("Password", "password text", secure=True)
        self.check = FakeObject("Remember", "check box")
        self.list = FakeObject("Choice", "list", [FakeObject("Alpha", "list item"), FakeObject("Beta", "list item")])
        self.app = FakeObject("App", "application", [self.entry, self.password, self.check, self.list])
        self.provider = AtspiProvider(10, atspi=Api(self.app))
        self.provider.snapshot()

    def perform(self, obj, **action): self.provider.perform(self.provider._ids[obj], action)

    def test_text_read_uses_interface_despite_accessible_method_collision(self):
        self.entry.value = "Ada"
        self.assertIs(self.entry.get_text(), self.entry)
        with self.assertRaises(TypeError):
            self.entry.get_text(0, 3)
        node = self.provider.snapshot()["root"]["children"][0]["children"][0]
        self.assertEqual(node["value"], "Ada")

    def test_password_never_read(self):
        snap = self.provider.snapshot()
        password = snap["root"]["children"][0]["children"][1]
        self.assertTrue(password["states"]["secure"])
        self.assertFalse({"text", "value", "attributes", "children"} & password.keys())
        self.assertEqual(self.password.reads, 0)

    def test_secure_metadata_is_not_disclosed(self):
        self.password.name = "fixture-secret"
        node = self.provider.snapshot()["root"]["children"][0]["children"][1]
        self.assertEqual(node["name"], "Secure control")
        self.assertNotIn("testId", node)

    def test_sensitive_metadata_keeps_only_prefill_label(self):
        self.perform(self.entry, kind="fill", value="secret", sensitive=True)
        self.entry.name = "secret"
        node = self.provider.snapshot()["root"]["children"][0]["children"][0]
        self.assertEqual(node["name"], "Name")
        self.assertEqual(node["testId"], "name")

    def test_foreign_selection_candidate_rejected(self):
        self.list.children[1].pid = 20
        with self.assertRaises(DriverError) as result:
            self.perform(self.list, kind="selectOption", value={"index": 1})
        self.assertEqual(result.exception.code, "NODE_STALE")
        self.assertNotIn("SELECTED", self.list.children[1].flags)

    def test_disabled_selection_candidate_rejected(self):
        self.list.children[1].flags.remove("ENABLED")
        with self.assertRaises(DriverError):
            self.perform(self.list, kind="selectOption", value={"index": 1})
        self.assertNotIn("SELECTED", self.list.children[1].flags)

    def test_foreign_option_name_is_never_read(self):
        candidate = self.list.children[1]
        candidate.pid = 20
        candidate.get_name = lambda: self.fail("foreign option metadata was read")
        with self.assertRaises(DriverError) as result:
            self.perform(self.list, kind="selectOption", value={"label": "Beta"})
        self.assertEqual(result.exception.code, "NODE_STALE")

    def test_secure_option_name_is_never_read(self):
        candidate = self.list.children[1]
        candidate.attributes["e2e-secure"] = "true"
        candidate.get_name = lambda: self.fail("secure option metadata was read")
        with self.assertRaises(DriverError) as result:
            self.perform(self.list, kind="selectOption", value={"label": "Beta"})
        self.assertEqual(result.exception.code, "NOT_ACTIONABLE")

    def test_selected_radio_uncheck_is_rejected_before_dispatch(self):
        self.check.role = "radio button"
        self.check.flags.add("CHECKED")
        with self.assertRaises(DriverError) as result:
            self.perform(self.check, kind="uncheck")
        self.assertEqual(result.exception.code, "UNSUPPORTED_CAPABILITY")
        self.assertEqual(self.check.actions, 0)
        self.perform(self.check, kind="check")
        self.assertEqual(self.check.actions, 0)

    def test_fill_and_clear(self):
        self.perform(self.entry, kind="fill", value="Ada")
        self.assertEqual(self.entry.value, "Ada")
        self.perform(self.entry, kind="clear")
        self.assertEqual(self.entry.value, "")

    def test_sensitive_fill_taints_node(self):
        self.perform(self.entry, kind="fill", value="secret", sensitive=True)
        node = self.provider.snapshot()["root"]["children"][0]["children"][0]
        self.assertTrue(node["states"]["secure"])
        self.assertNotIn("value", node)

    def test_check_is_idempotent(self):
        self.perform(self.check, kind="check")
        self.perform(self.check, kind="check")
        self.assertEqual(self.check.actions, 1)
        self.perform(self.check, kind="uncheck")
        self.assertNotIn("CHECKED", self.check.flags)

    def test_disabled_action_rejected(self):
        self.check.flags.remove("ENABLED")
        with self.assertRaises(DriverError) as result: self.perform(self.check, kind="check")
        self.assertEqual(result.exception.code, "NOT_ACTIONABLE")
        self.assertEqual(self.check.actions, 0)

    def test_defunct_object_rejected(self):
        self.entry.flags.add("DEFUNCT")
        with self.assertRaises(DriverError) as result: self.perform(self.entry, kind="fill", value="x")
        self.assertEqual(result.exception.code, "NODE_STALE")

    def test_foreign_pid_rejected(self):
        self.entry.pid = 11
        with self.assertRaises(DriverError): self.provider.snapshot()

    def test_stable_id_across_snapshots(self):
        before = self.provider._ids[self.entry]
        self.provider.snapshot()
        self.assertEqual(before, self.provider._ids[self.entry])

    def test_replacement_has_new_identity(self):
        before = self.provider._ids[self.entry]
        self.entry.flags.add("DEFUNCT")
        self.app.children[0] = FakeObject("Name", "entry")
        self.provider.snapshot()
        self.assertNotEqual(before, self.provider._ids[self.app.children[0]])
        with self.assertRaises(DriverError): self.provider.perform(before, {"kind": "clear"})

    def test_selection_by_label_and_index(self):
        self.perform(self.list, kind="selectOption", value={"label": "Beta"})
        self.assertIn("SELECTED", self.list.children[1].flags)
        self.perform(self.list, kind="selectOption", value={"index": 0})
        self.assertIn("SELECTED", self.list.children[0].flags)

    def test_selection_html_value_is_explicitly_unsupported(self):
        with self.assertRaises(DriverError) as result: self.perform(self.list, kind="selectOption", value={"value": "Beta"})
        self.assertEqual(result.exception.code, "UNSUPPORTED_CAPABILITY")

    def test_selection_ambiguous_label_rejected(self):
        self.list.children.append(FakeObject("Beta", "list item"))
        with self.assertRaises(DriverError): self.perform(self.list, kind="selectOption", value="Beta")

    def test_unavailable_application_is_error_not_empty_tree(self):
        self.app.pid = 11
        with self.assertRaises(DriverError): self.provider.snapshot()

    def test_unsupported_tap_does_not_succeed(self):
        with self.assertRaises(DriverError) as result: self.perform(self.entry, kind="tap")
        self.assertEqual(result.exception.code, "UNSUPPORTED_CAPABILITY")

    def test_action_rejection_propagates(self):
        self.entry.rejected = True
        with self.assertRaises(DriverError): self.perform(self.entry, kind="fill", value="hello")

    def test_mutation_applies_then_raises_is_not_retryable(self):
        def mutate(value):
            self.entry.value = value
            raise RuntimeError("app supplied secret error")
        self.entry.set_text_contents = mutate
        with self.assertRaises(DriverError) as result:
            self.perform(self.entry, kind="fill", value="secret", sensitive=True)
        self.assertEqual(result.exception.code, "ACTION_MAY_HAVE_COMMITTED")
        self.assertNotIn("secret", str(result.exception))
        self.assertEqual(self.entry.value, "secret")
        snapshot = self.provider.snapshot()
        self.assertNotIn('"secret"', json.dumps(snapshot))

    def test_unconfirmed_toggle_is_not_retried(self):
        def delayed_toggle(index):
            self.check.actions += 1
            return True
        self.check.do_action = delayed_toggle
        with patch("e2e_atspi.provider.time.sleep"), self.assertRaises(DriverError) as result:
            self.perform(self.check, kind="check")
        self.assertEqual(result.exception.code, "ACTION_MAY_HAVE_COMMITTED")
        self.assertEqual(self.check.actions, 1)

    def test_snapshot_failure_invalidates_previous_action_authorization(self):
        self.app.pid = 99
        with self.assertRaises(DriverError):
            self.provider.snapshot()
        with self.assertRaises(DriverError) as result:
            self.perform(self.entry, kind="fill", value="must not be written")
        self.assertEqual(result.exception.code, "NODE_STALE")
        self.assertEqual(self.entry.edits, 0)

    def test_individual_field_omissions_mark_incomplete(self):
        for field in ("name", "value"):
            with self.subTest(field=field):
                setattr(self.entry, field, "x" * 65537)
                self.assertTrue(self.provider.snapshot()["truncated"])
                setattr(self.entry, field, "Name" if field == "name" else "")

    def test_aggregate_unicode_text_budget_stops_retaining_nodes(self):
        self.app.children = [FakeObject(f"Text {index}", "entry") for index in range(100)]
        for node in self.app.children:
            node.value = "界" * 60000
        snapshot = self.provider.snapshot()
        self.assertTrue(snapshot["truncated"])
        self.assertLess(len(json.dumps(snapshot, ensure_ascii=True).encode()), 1024 * 1024)
        # Each individual value fits; aggregate bounds must stop before reading all 100.
        self.assertLess(sum(node.reads for node in self.app.children), 5)
        self.assertLess(len(self.provider._last_metadata), 5)

    def test_aggregate_name_budget_includes_secure_nodes(self):
        self.app.children = [FakeObject("界" * 60000, "entry") for _ in range(100)]
        for node in self.app.children:
            identity = self.provider._id(node)
            self.provider._secure_ids.add(identity)
            self.provider._safe_metadata[identity] = (node.name, None)
        snapshot = self.provider.snapshot()
        self.assertTrue(snapshot["truncated"])
        self.assertLess(len(json.dumps(snapshot, ensure_ascii=True).encode()), 1024 * 1024)
        self.assertLess(len(snapshot["root"]["children"][0]["children"]), 5)

    def test_cycle_marks_incomplete(self):
        self.app.children.append(self.app)
        self.assertTrue(self.provider.snapshot()["truncated"])


if __name__ == "__main__":
    unittest.main()


class ExtendedControlTests(unittest.TestCase):
    setUp = ProviderTests.setUp
    perform = ProviderTests.perform
    def test_offscreen_control_can_be_scrolled_without_activating(self):
        self.entry.flags.discard("SHOWING")
        calls = []
        class Component:
            def scroll_to(self, destination):
                calls.append(destination)
                return True
        self.entry.get_component_iface = lambda: Component()
        self.perform(self.entry, kind="scrollIntoView")
        self.assertEqual(calls, [6])
        self.assertEqual(self.entry.edits, 0)
        with self.assertRaises(DriverError) as result:
            self.perform(self.entry, kind="fill", value="x")
        self.assertEqual(result.exception.code, "NOT_ACTIONABLE")

    def test_unsupported_scroll_does_not_fall_back_to_input(self):
        with self.assertRaises(DriverError) as result:
            self.perform(self.entry, kind="scrollIntoView")
        self.assertEqual(result.exception.code, "UNSUPPORTED_CAPABILITY")
        self.assertEqual(self.entry.actions, 0)

    def test_failed_scroll_is_never_retryable(self):
        class Component:
            def scroll_to(self, destination): return False
        self.entry.get_component_iface = lambda: Component()
        with self.assertRaises(DriverError) as result:
            self.perform(self.entry, kind="scrollIntoView")
        self.assertEqual(result.exception.code, "ACTION_MAY_HAVE_COMMITTED")

    def test_visible_state_is_required_even_if_provider_says_showing(self):
        self.entry.flags.discard("VISIBLE")
        node = self.provider.snapshot()["root"]["children"][0]["children"][0]
        self.assertTrue(node["states"]["hidden"])
        with self.assertRaises(DriverError) as result:
            self.perform(self.entry, kind="fill", value="x")
        self.assertEqual(result.exception.code, "NOT_ACTIONABLE")

    def test_placeholder_does_not_leak_from_secure_control(self):
        self.entry.attributes["placeholder-text"] = "Your name"
        self.password.attributes["placeholder-text"] = "private secret"
        nodes = self.provider.snapshot()["root"]["children"][0]["children"]
        self.assertEqual(nodes[0]["attributes"]["placeholder"], "Your name")
        self.assertNotIn("attributes", nodes[1])

    def test_numeric_range_value_is_observable(self):
        slider = FakeObject("Volume", "slider")
        slider.numeric = 0.5
        slider.get_value_iface = lambda: slider
        self.app.children.append(slider)
        node = self.provider.snapshot()["root"]["children"][0]["children"][-1]
        self.assertEqual(node["value"], "0.5")

    def test_nonfocusable_control_is_rejected_before_focus(self):
        self.entry.flags.discard("FOCUSABLE")
        with self.assertRaises(DriverError) as result:
            self.perform(self.entry, kind="focus")
        self.assertEqual(result.exception.code, "NOT_ACTIONABLE")


class ActionabilityTests(unittest.TestCase):
    setUp = ProviderTests.setUp
    def test_preflight_is_read_only_and_rechecks_disabled_state(self):
        identity = self.provider._ids[self.entry]
        self.provider.preflight(identity, {"kind":"fill", "value":"private", "sensitive":True})
        self.assertEqual(self.entry.edits, 0)
        self.assertNotIn(identity, self.provider._secure_ids)
        self.entry.flags.discard("ENABLED")
        with self.assertRaises(DriverError) as result:
            self.provider.preflight(identity, {"kind":"fill", "value":"x"})
        self.assertEqual(result.exception.code, "NOT_ACTIONABLE")
        self.assertEqual(self.entry.edits, 0)

    def test_selection_preflight_does_not_select(self):
        self.provider.preflight(self.provider._ids[self.list], {"kind":"selectOption", "value":"Beta"})
        self.assertNotIn("SELECTED", self.list.children[1].flags)
