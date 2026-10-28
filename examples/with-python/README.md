# Python consumer reference applications

`tests/test_boundaries.py` exercises real Python CLI and HTTP applications with
independent output checks. `tests/test_desktop.py` exercises accessible text,
checkbox and button controls. `apps/qt_widgets.py` and `qt_quick.py` are
real Qt reference applications using OS accessibility. Their `--wrong` mode must
remain wrong: it proves the test detects incorrect application behavior.

Run `node scripts/python/verify.mjs --python /path/to/python` from the repository
after `pnpm build:native`. Desktop verification requires the actual OS sidecar,
an interpreter with PySide6 or PyQt6 and a live accessibility session; see `PYTHON.md`.
The verifier copies these fixtures into a fresh consumer project and installs
the wheel and npm packages before running tests. Generated evidence belongs in
the ignored `.e2e/python/` directory.

`apps/http_frameworks.py` defines extensible WSGI/ASGI reference service classes
for Flask, Django and FastAPI. `tests/test_frameworks.py` sends real network
requests with explicit cookies, verifies login/logout and fresh process state,
and rejects independent wrong results. Install the pinned fixture requirements
separately; no framework dependency is added to the Python SDK.
