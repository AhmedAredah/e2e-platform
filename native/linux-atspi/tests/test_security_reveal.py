"""Security classification belongs to an object's lifetime, not its current display mode."""
import unittest
import test_provider as fixtures


class SecurityRevealTests(unittest.TestCase):
    setUp = fixtures.ProviderTests.setUp

    def test_password_reveal_never_reads_value_metadata_or_descendants(self):
        identity = self.provider._ids[self.password]
        self.password.role = "entry"
        self.password.attributes = {}
        self.password.get_name = lambda: self.fail("revealed password name read")
        self.password.get_accessible_id = lambda: self.fail("revealed password ID read")
        self.password.get_child_count = lambda: self.fail("revealed password descendants read")
        node = self.provider.snapshot()["root"]["children"][0]["children"][1]
        self.assertEqual(node["ref"]["id"], identity)
        self.assertTrue(node["states"]["secure"])
        self.assertEqual(node["inputPurpose"], "password")
        self.assertFalse({"value", "text", "attributes", "children"} & node.keys())
        self.assertEqual(self.password.reads, 0)

    def test_marker_removal_cannot_clear_generic_sensitivity(self):
        self.entry.attributes["e2e-secure"] = "true"
        self.provider.snapshot()
        self.entry.attributes = {}
        self.entry.value = "private fixture value"
        reads = self.entry.reads
        node = self.provider.snapshot()["root"]["children"][0]["children"][0]
        self.assertTrue(node["states"]["secure"])
        self.assertEqual(node["inputPurpose"], "generic-secret")
        self.assertEqual(self.entry.reads, reads)

    def test_replacement_gets_new_identity_without_inheriting_sensitivity(self):
        previous = self.provider._ids[self.password]
        self.password.flags.add("DEFUNCT")
        self.app.children[1] = fixtures.FakeObject("Replacement", "entry")
        node = self.provider.snapshot()["root"]["children"][0]["children"][1]
        self.assertNotEqual(node["ref"]["id"], previous)
        self.assertFalse(node["states"]["secure"])
        self.assertNotIn(previous, self.provider._secure_ids)
        self.assertNotIn(previous, self.provider._password_ids)

    def test_selection_does_not_read_revealed_password_option(self):
        self.password.role = "list item"
        self.password.attributes = {}
        self.password.get_name = lambda: self.fail("revealed option name read")
        self.list.children.insert(0, self.password)
        self.provider.preflight(self.provider._ids[self.list], {"kind": "selectOption", "value": "Beta"})
