"""Provider-contract tests against a faithful in-memory AT-SPI interface double."""
from pathlib import Path
import sys
import json
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from e2e_atspi.contracts import DriverError
from e2e_atspi.provider import AtspiProvider


class StateSet:
    def __init__(self, flags): self.flags = flags
    def contains(self, flag): return flag in self.flags


class FakeObject:
    def __init__(self, name, role, children=(), *, secure=False, pid=10):
        self.name, self.role, self.children, self.pid = name, role, list(children), pid
        self.flags = {"ENABLED", "SHOWING", "EDITABLE"}
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
    def get_text_iface(self): return self
    def get_character_count(self): return len(self.value)
    def get_text(self, start, end):
        self.reads += 1
        return self.value[start:end]
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


class Api:
    StateType = StateTypes()
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
