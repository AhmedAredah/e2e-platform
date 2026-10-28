"""The loopback reference server must not depend on host DNS configuration."""

import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


class LoopbackServerTests(unittest.TestCase):
    def test_binding_does_not_perform_reverse_dns(self):
        spec = importlib.util.spec_from_file_location(
            "http_reference", Path(__file__).parents[1] / "apps/http_frameworks.py"
        )
        assert spec is not None and spec.loader is not None
        reference = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reference)
        with patch("socket.getfqdn", side_effect=AssertionError("Unexpected reverse DNS")):
            with reference.make_server(
                "127.0.0.1", 0, lambda _environment, _response: [],
                server_class=reference.LoopbackWsgiServer,
            ) as server:
                self.assertEqual(server.server_name, "127.0.0.1")
                self.assertGreater(server.server_port, 0)
                self.assertEqual(server.base_environ["SERVER_NAME"], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
