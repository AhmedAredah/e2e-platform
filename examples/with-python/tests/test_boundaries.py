"""One independently checked CLI/HTTP flow, including an intentional wrong app."""

import json
import os
import sys
from decimal import Decimal


def test_python_cli(e2e):
    app = os.environ["E2E_PYTHON_APP"]
    wrong = ["--wrong-result"] if os.environ.get("E2E_PLANTED_DEFECT") == "1" else []
    result = e2e.processes.run(sys.executable, [app, "sum", "0.1", "0.2", *wrong])
    value = json.loads(result.stdout)["sum"]
    e2e.expect_equal(abs(value - 0.3) < 1e-12, True, message="[oracle:python-output]")
    invalid = e2e.processes.run(
        sys.executable, [app, "sum", "invalid", "2"], expected_exit_codes=[2]
    )
    e2e.expect_equal(invalid.exit_code, 2)


def test_python_http(e2e):
    app = os.environ["E2E_PYTHON_APP"]
    wrong = ["--wrong-result"] if os.environ.get("E2E_PLANTED_DEFECT") == "1" else []
    with e2e.processes.start_service(
        sys.executable, ["-u", app, "serve", *wrong], ready_text="E2E_LANGUAGE_READY "
    ) as child:
        announcement = next(
            line
            for line in child.ready_output.splitlines()
            if line.startswith("E2E_LANGUAGE_READY ")
        )
        port = json.loads(announcement.split(" ", 1)[1])["port"]
        response = e2e.http.get(
            f"http://127.0.0.1:{port}/sum?a=0.1&b=0.2"
        ).expect_status(200)
        e2e.expect_equal(
            abs(response.json()["sum"] - Decimal("0.3")) < Decimal("1e-12"),
            True,
            message="[oracle:python-output]",
        )
        for query in ("a=0.1&b=0.2&a=", "a=0.1&b=0.2&garbage=", "a=&b=0.2"):
            e2e.http.get(f"http://127.0.0.1:{port}/sum?{query}").expect_status(400)
