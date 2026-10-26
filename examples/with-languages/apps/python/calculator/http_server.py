"""Loopback-only demo transport; not a production HTTP server."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from urllib.parse import parse_qs, urlsplit
from .operations import Calculator


class CalculatorServer(HTTPServer):
    def __init__(self, calculator: Calculator):
        self.calculator = calculator
        super().__init__(("127.0.0.1", 0), CalculatorHandler)


class CalculatorHandler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(2)

    def log_message(self, _format, *_args):
        pass

    def do_GET(self):
        target = urlsplit(self.path)
        status, result = 200, {"ok": True}
        if target.path == "/sum":
            try:
                query = parse_qs(target.query, strict_parsing=True)
                if set(query) != {"a", "b"} or any(len(values) != 1 for values in query.values()):
                    raise ValueError("exactly one a and b required")
                result = self.server.calculator.calculate(query["a"][0], query["b"][0])
            except (ValueError, KeyError, OverflowError):
                status, result = 400, {"error": "invalid operands"}
        elif target.path != "/health":
            status, result = 404, {"error": "not found"}
        body = json.dumps(result, allow_nan=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
