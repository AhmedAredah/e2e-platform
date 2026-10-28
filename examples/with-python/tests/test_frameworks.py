"""Real network requests, explicit cookies, session reset and independent outputs."""

import json
import os
from http.cookies import SimpleCookie


def test_framework_http(e2e):
    arguments = [os.environ["E2E_FRAMEWORK_APP"], os.environ["E2E_HTTP_FRAMEWORK"]]
    if os.environ.get("E2E_PLANTED_DEFECT") == "1":
        arguments.append("--wrong")
    interpreter = os.environ["E2E_FRAMEWORK_PYTHON"]
    cookie = None
    for _ in range(2):
        with e2e.processes.start_service(
            interpreter,
            arguments,
            ready_text="E2E_FRAMEWORK_READY ",
            startup_timeout_ms=20_000,
        ) as service:
            ready = next(
                line
                for line in service.ready_output.splitlines()
                if line.startswith("E2E_FRAMEWORK_READY ")
            )
            port = json.loads(ready.split(" ", 1)[1])["port"]
            base = f"http://127.0.0.1:{port}"
            # Reusing a cookie from the previous process must not restore its state.
            e2e.http.get(
                base + "/result", headers={} if cookie is None else {"cookie": cookie}
            ).expect_status(401)
            e2e.http.post_json(base + "/login", {"name": "Wrong"}).expect_status(400)
            response = e2e.http.post_json(
                base + "/login", {"name": "Ada"}
            ).expect_status(200)
            parsed = SimpleCookie(response.headers["set-cookie"])
            cookie = "session=" + parsed["session"].value
            result = e2e.http.get(
                base + "/result", headers={"cookie": cookie}
            ).expect_status(200)
            e2e.expect_equal(
                result.json(), {"result": 42}, message="[oracle:python-http-framework]"
            )
            e2e.http.post_json(
                base + "/logout", {}, headers={"cookie": cookie}
            ).expect_status(200)
            e2e.http.get(base + "/result", headers={"cookie": cookie}).expect_status(
                401
            )
            active = e2e.http.post_json(base + "/login", {"name": "Ada"}).expect_status(
                200
            )
            cookie = (
                "session=" + SimpleCookie(active.headers["set-cookie"])["session"].value
            )
