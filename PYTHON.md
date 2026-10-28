# Python application and test guide

The Python SDK runs pytest test bodies through the shared E2E Platform runner.
It uses the same engines, locator polling, process ownership, retries and reports
as TypeScript and C++. It is a bounded prerelease API. Check
[release evidence](RELEASE_STATUS.md) before treating a particular OS/toolkit as qualified.

## Install from this repository

Use Python 3.11 or newer and the supported Node version in `INSTALL.md`. Choose an
explicit virtual-environment interpreter. Registry ownership/publication is not
established; do not install a similarly named public package as a substitute.

```sh
# In the repository, after pnpm install --frozen-lockfile:
pnpm pack:native
python -m pip install build==1.6.1
node scripts/python/package.mjs --python python

# In your own project, after npm init -y and creating/activating a venv:
node /path/to/e2e-platform/release-packages/install.mjs /absolute/path/to/project
python -m pip install /path/to/e2e-platform/release-packages/python/e2e_platform-0.2.0rc8-py3-none-any.whl
```

The nine npm packages and the Python wheel are separate distributions. The wheel
installs pytest; it does not bundle Node, native sidecars, Qt or a GUI toolkit.
The packaging command also emits a source distribution and checksums. Initial
dependencies require network access or prepared npm/pip caches. For offline
Python installation, prepare a wheelhouse including pytest and its dependencies
with `pip download`, then use `pip install --no-index --find-links /path/to/wheelhouse`.

For a new project, run `python -m e2e_platform init` to generate a runnable CLI
example and configuration. Existing files are never overwritten. For manual
integration, create `tests/python.e2e.ts`:

```ts
import { registerPythonTests } from '@e2e-platform/python';
await registerPythonTests({
  interpreter: '/absolute/path/to/project/.venv/bin/python',
  cwd: '/absolute/path/to/project',
  tests: ['python_tests'],
  timeoutMs: 30_000,
});
```

On Windows use the venv's `Scripts/python.exe`. `tests` accepts pytest file,
directory and node-ID selectors, not command-line options. Create `e2e.config.ts`:

```ts
export default {
  modelPolicy: 'forbid', workers: 1, retries: 0,
  tests: ['tests/*.e2e.ts'],
  targets: [{ name: 'python-cli', platform: 'process' }],
};
```

Create `python_tests/test_cli.py`:

```python
import sys
from e2e_platform import Session

def test_binary_output(e2e: Session):
    result = e2e.processes.run(
        sys.executable,
        ['-c', 'import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())'],
        stdin=bytes([0, 128, 255]),
    )
    e2e.expect_equal(list(result.stdout), [0, 128, 255])
```

Run `python -m e2e_platform run --no-model` from the consumer project. This resolves
the local installed Node runner and never downloads an executable. The usual
`npx --no-install e2e-platform run --no-model` command is equivalent. Read the
shared `.e2e/report.json` and HTML report for final outcomes and cleanup status.

## Desktop applications

Configure a real OS driver as described in [DESKTOP.md](DESKTOP.md), for example:

```ts
import { desktop } from '@e2e-platform/native';
export default {
  modelPolicy: 'forbid', workers: 1, retries: 0,
  tests: ['tests/*.e2e.ts'],
  targets: [{
    name: 'python-linux',
    engine: desktop({
      backend: 'linux-atspi', executable: '/usr/bin/python3',
      args: ['/absolute/path/to/e2e-platform/native/linux-atspi/driver.py'],
    }),
    app: {
      appPath: '/absolute/path/to/application/.venv/bin/python',
      launchArguments: ['/absolute/path/to/application/main.py'],
    },
  }],
};
```

The application interpreter, SDK interpreter and sidecar interpreter can differ.
An executable path is not a shell command. Build packaged applications first;
point `appPath` to the executable instead of Python for PyInstaller-style builds.
That packaging style requires its own acceptance run.

```python
def test_submit(e2e):
    e2e.app.open()
    name = e2e.screen.get_by_role('textbox', name='Name')
    name.fill('Ada café')
    name.expect().to_have_value('Ada café')
    e2e.screen.get_by_role('checkbox', name='Remember').check()
    e2e.screen.get_by_role('button', name='Submit').click()
    e2e.screen.get_by_role('textbox', name='Result').expect().to_have_value('Hello Ada café')
```

Use accessible names, roles or stable test IDs exposed by the actual toolkit.
`Locator` extends `Screen`, so queries can be scoped to a dialog or container.
`LocatorAssertions.not_` supports negation. Assertions poll in the shared runner;
unknown state cannot prove a positive or negative state assertion. Mutations are
not replayed after uncertain transport failures.

PySide/PyQt Widgets/Quick reference applications are in `examples/with-python/apps`.
They use OS accessibility directly; no C++ helper is injected into Python.
The C++ Qt cooperative helper remains a separate implementation. Python authoring
can control any application that a selected driver can actually inspect, but the
application's language alone does not qualify its controls.

## Owned services, HTTP and terminals

`processes.start_service(executable, args, ready_text='READY ', ...)` returns an
`ApplicationService` extending `OwnedProcess`. It requires a complete readiness
line, bounded output and a live process. Its context manager rejects a service
that exits before owned shutdown. `ready_output` contains the captured UTF-8
announcement. Configure startup and lifetime deadlines separately with
`startup_timeout_ms` and `timeout_ms`. Readiness is an application contract;
it does not imply an HTTP health endpoint or completed database migration.

```python
with e2e.processes.start_service(
    '/path/to/venv/bin/python', ['-u', '-m', 'my_service'],
    ready_text='READY ', timeout_ms=30_000,
) as service:
    response = e2e.http.get('http://127.0.0.1:8080/health').expect_status(200)
    e2e.expect_equal(response.json(), {'ready': True})
```

`processes.run` returns byte stdout/stderr, termination status, exit code and an
explicit truncation flag. Nonzero exits fail unless listed in `expected_exit_codes`.
`OwnedProcess` provides `read`, `write`, `close_input`, `wait_for_output` and `stop`.
The runner still owns children if the Python test crashes. Environment inheritance
defaults off; provide `env`, `cwd` and `inherit_env` deliberately. Raw process
output is trusted application data and may contain secrets.

HTTP supports explicit methods, headers, text bodies and `post_json`. JSON rejects
duplicate keys and nonfinite numbers; integers and `Decimal` remain exact.
There is no implicit cookie jar, redirect following, authentication flow, database
reset, WebSocket or gRPC adapter. The real Flask, Django and FastAPI fixtures
exercise JSON requests, explicit cookie handling, login/logout, state reset after
restart and deliberate wrong results. These reference flows do not certify every
framework extension or a production authentication scheme.

An installed terminal engine exposes `e2e.terminal.write`, `press`, `resize`,
`snapshot` and `wait_for`; optional `node-pty` and host prerequisites are separate.
`e2e.native.windows()` and `.activate(id)` require the Qt engine's window capability.
Unsupported operations fail explicitly. OS sidecars currently lack global key
injection, screenshots, clipboard, IME, drag/drop, native video and visual diffs.
Tkinter, wxPython, Kivy, custom canvases and hybrid webviews need their own provider
and acceptance evidence; none is implied by the Python SDK.

## Pytest lifecycle and extension contracts

The fixtures `e2e`, `app`, `screen`, `processes` and `http` are available inside the
supervised runner. Normal parametrization and yield fixtures work. Each collected
case gets a fresh Python process, so module/session fixtures run once per case,
not once per suite. Collection may import test modules more than once; keep
application startup in fixtures or test bodies. Plain `pytest` does not start an
engine. Shared setup/session-cache APIs and arbitrary TypeScript engine fixtures
are not exposed by this SDK.

Pytest autoload and project `addopts` are disabled. Pass trusted plugin module
names explicitly via `plugins: ['pytest_asyncio.plugin']`; install the wheel's
`asyncio` extra for async tests. Use `@pytest.mark.asyncio` and
`@pytest_asyncio.fixture`, then `await e2e.run_async(e2e.app.open)` as needed.
Cancellation invalidates the connection; the parent deadline/cleanup settles the
in-flight operation. Do not enable another worker, repeat or retry scheduler.

Pytest setup, call and teardown failures fail the shared report. Skips and ordinary
xfails are skipped; unexpected passes fail. A failed shared operation stays failed
even if caught or marked xfail. Python failure locations record basename and line
without copying arbitrary captured values. Tests/config/plugins retain full host
authority; this is not a sandbox.

`Transport` is an abstract base class; `StdioTransport` implements the bounded
ordered protocol. `Session` composes application, locator, process and HTTP objects.
Extend these contracts for future transports or application services, and add
host allowlist validation plus positive/negative tests for new wire operations.
Do not bypass driver capability checks or put toolkit-specific code into core.

## Reproduce qualification

```sh
pnpm build:native
python -m pip install './sdks/python[asyncio]' pytest==9.2.0
python -m pytest sdks/python/tests -q
# Set E2E_TEST_PYTHON to that interpreter before running:
pnpm --filter @e2e-platform/python test
node scripts/python/verify.mjs --python /absolute/path/to/python
```

The verifier creates an external project, installs a newly built wheel and the
nine npm tarballs, runs positive and planted-negative CLI/HTTP cases, requires
correct report failures and complete cleanup, then records runtime versions and
wheel SHA-256. Desktop mode adds `--backend`, `--driver`, optional `--driver-arg`
and `--gui-python` with the selected binding installed (`--binding PySide6` or `--binding PyQt6`), in a real interactive accessibility
session. Outputs are under `.e2e/python/`. CI covers the configured Python/OS
matrix and real reference desktops. A configured job is not a recorded pass.

For framework HTTP acceptance, install `examples/with-python/framework-requirements.txt`
into a separate application environment, then run:

```sh
node scripts/python/verify.mjs --python /path/to/sdk-python --http-frameworks --app-python /path/to/application-python
```

The verifier records the actual Flask/Django/FastAPI/Uvicorn versions. Framework
packages remain optional fixture dependencies, outside the SDK wheel.
