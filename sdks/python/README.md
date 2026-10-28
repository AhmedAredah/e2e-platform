# E2E Platform Python SDK

Author pytest tests using the shared E2E Platform runner, process supervision,
HTTP client and capability-negotiated desktop/browser engines. Install the Python
wheel and the matching local npm kit; no registry publication is implied.

```sh
python -m pip install /path/to/e2e_platform-0.2.0rc8-py3-none-any.whl
node /path/to/release-packages/install.mjs /path/to/project
```

For a new project, run `python -m e2e_platform init` to generate a runnable CLI
example and configuration. Existing files are never overwritten. For manual
integration, create `tests/python.e2e.ts`:

```ts
import { registerPythonTests } from '@e2e-platform/python';
await registerPythonTests({ interpreter: '/absolute/path/to/venv/bin/python', tests: ['python_tests'] });
```

Use the normal `e2e.config.ts` to choose the process, desktop, Qt, browser or
terminal target. Then run `python -m e2e_platform run --no-model` from the project.

```python
from e2e_platform import Session

def test_submit(e2e: Session):
    e2e.app.open()
    e2e.screen.get_by_role("textbox", name="Name").fill("Ada")
    e2e.screen.get_by_role("button", name="Submit").click()
    e2e.screen.get_by_test_id("result").expect().to_have_text("Hello, Ada")
```

The `e2e`, `app`, `screen`, `processes` and `http` pytest fixtures are provided.
Normal pytest fixtures and parametrization execute inside each owned test child.
Each case gets a fresh Python process: module/session fixtures therefore do not
share state across cases. The shared runner owns scheduling, retries, artifacts
and cleanup. Autoloaded pytest plugins and project addopts are disabled. Pass
explicit plugins to `registerPythonTests`; do not enable another worker/retry
scheduler. Plain `pytest` has no engine session; use the supervised runner.

Python assertion and fixture failures record a source basename/line without
copying captured application values. Skips and ordinary pytest expected failures
are reported as skipped; unexpected passes are strict failures. A failed shared
operation remains a failure even under xfail or if Python code catches it.

`Session.run_async(operation, ...)` offloads a synchronous SDK call for async test
bodies; explicitly enable an asyncio pytest plugin. Cancelling an in-flight call
invalidates the session, and the parent deadline/cleanup owns its final outcome.
No operation is automatically replayed.

The API provides semantic locators/assertions, app lifecycle, process execution,
binary process streams, owned service processes, HTTP, terminal and optional
native window operations. Every operation still requires its engine capability.
This SDK does not add OS keyboard injection, screenshots to OS sidecars, arbitrary
custom-control introspection or universal framework certification. See the root
Python guide and support matrix for actual qualified profiles.

Protocol frames are bounded to 1 MiB, nesting to 64 and requests to 10,000.
Integer and Decimal equality preserve exact decimal values. HTTP JSON parsing
rejects duplicate keys and nonfinite numbers and returns Decimal for fractions.
Transport failures and malformed acknowledgements invalidate the session.
Application/config/test code is trusted code with host authority, not sandboxed.
