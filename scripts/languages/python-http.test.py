"""Regression checks for the Python loopback example's startup boundary."""
import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "examples/with-languages/apps/python"))
from calculator.http_server import CalculatorServer
from calculator.operations import Calculator, SumOperation


class LoopbackStartupTests(unittest.TestCase):
    def test_startup_and_requests_do_not_depend_on_hostname_resolution(self):
        """A slow or broken resolver must not prevent a numeric-loopback fixture."""
        with (
            patch("socket.getfqdn", side_effect=AssertionError("unexpected hostname lookup")),
            patch("socket.gethostbyaddr", side_effect=AssertionError("unexpected reverse lookup")),
        ):
            with CalculatorServer(Calculator(SumOperation())) as server:
                self.assertEqual(server.server_name, "127.0.0.1")
                self.assertEqual(server.server_address, ("127.0.0.1", server.server_port))
                self.assertGreater(server.server_port, 0)
                worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
                worker.start()
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
                try:
                    connection.request("GET", "/health")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read()), {"ok": True})
                    connection.request("GET", "/sum?a=0.1&b=0.2")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertAlmostEqual(json.loads(response.read())["sum"], 0.3)
                    connection.request("GET", "/sum?a=invalid&b=0.2")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 400)
                    response.read()
                finally:
                    connection.close()
                    server.shutdown()
                    worker.join(timeout=3)
                    self.assertFalse(worker.is_alive(), "HTTP server thread failed to stop")


if __name__ == "__main__":
    unittest.main()
