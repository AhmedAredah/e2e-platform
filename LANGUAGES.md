# Python, C# and Rust applications

The first cross-language milestone tests **real CLI and local HTTP applications**
with the same TypeScript runner, process supervisor, result validators and HTTP
client used for C++ applications. It includes a Python standard-library app, a
C#/.NET console app with an ASP.NET Core endpoint, and a Rust standard-library app.

| Surface | Python | C#/.NET | Rust |
| --- | --- | --- | --- |
| Direct CLI execution | Explicit interpreter and script | Built assembly through `dotnet` | Compiled executable |
| Local HTTP example | `http.server` fixture | ASP.NET Core/Kestrel | Bounded standard-library TCP fixture |
| Test authoring | TypeScript | TypeScript | TypeScript |
| Dedicated foreign-language test SDK | Not included | Not included | Not included |
| Desktop accessibility | Linux AT-SPI driver written in Python | Windows UIA driver written in C# | macOS AX driver written in Rust |

HTTP tests operate at the protocol boundary. They do not establish support for
all framework-specific features, WebSockets, gRPC, or arbitrary authentication.
The Python and Rust HTTP servers are small local test fixtures, not production
server implementations. Tkinter, PySide/PyQt, wxPython, Kivy, WPF, WinForms, WinUI,
Avalonia, MAUI, Slint, egui, iced and Tauri require explicit platform and control
qualification. OS accessibility drivers may serve several of these toolkits;
a toolkit name is not a guarantee that its controls expose every required pattern.
The existing C++ Qt helper is not a Python binding.

## Verify all three applications

Install the repository's pinned Node/pnpm dependencies and build the seven core
boundary packages, then use installed Python 3.12+, a .NET 10 SDK, and a Rust
compiler supporting edition 2024. The .NET app uses only the SDK's shared
framework; the Rust app has no registry dependencies and builds with
`--offline --locked`. No Python packages are required.

```sh
pnpm install --frozen-lockfile
pnpm build:native
node scripts/languages/verify.mjs
```

Tool selection can be explicit with `E2E_PYTHON`, `E2E_DOTNET`, `E2E_CARGO` and
`E2E_RUSTC`. These variables name executable paths, not shell commands. The
verifier fails if any required runtime is missing; it never records a skipped
language as qualified. Initial dependency/toolchain installation requires their
normal distribution sources or a prepared offline cache. Application compilation
and these tests require no external NuGet, Cargo or Python packages.

The verifier builds the applications and runs nine positive tests: CLI arithmetic,
invalid CLI input and HTTP behavior for each language. It then runs six deliberately
failing tests: wrong CLI and HTTP results for each language. Success requires the
negative failures to have the expected assertion category and code, exactly one
attempt each, and complete process cleanup. A compiler error, skipped test,
readiness timeout or cleanup error cannot masquerade as a successful negative test.

Reports are written beneath `examples/with-languages/.e2e/positive` and `negative`.
The final `.e2e/languages/verification.json` records actual runtime versions,
platform, architecture, output fingerprints and report paths. A workflow or a
framework name alone is not qualification evidence; publish the generated report
for each tested OS/toolchain combination.

## Reusable launch profiles

`@e2e-platform/process` exports `ApplicationLaunchProfile`, `PythonLaunchProfile`,
`DotnetLaunchProfile` and `ExecutableLaunchProfile`. Use the executable profile for
Rust, C++, self-contained .NET apphosts and other compiled programs.

```ts
import { PythonLaunchProfile, runProcess } from '@e2e-platform/process';

const app = new PythonLaunchProfile({
  identity: 'my-company.calculator',
  buildFingerprint: 'sha256:your-build-digest',
  interpreter: '/absolute/path/to/venv/bin/python',
  script: 'src/main.py',
  cwd: '/absolute/path/to/project',
  env: { APP_MODE: 'test' },
});
const launch = app.resolve(['sum', '0.1', '0.2']);
const result = await runProcess({ ...launch.process, timeoutMs: 5_000 });
```

Profiles copy argument arrays and environment records, resolve entry-point paths
against their own working directory, and default to `inheritEnv: false`. Supply
required runtime variables explicitly, or opt into inheritance deliberately.
Arguments are passed literally; shell quoting, redirection and interpolation do
not run. Python uses unbuffered output for reliable readiness messages. Builds
happen before runtime tests; profiles never invoke `cargo run` or `dotnet run`.

`identity` is the stable logical application name. `buildFingerprint` is optional
caller-provided provenance for particular sources or binaries. They are separate
metadata fields and do not automatically alter the core runner's cache or session
identity. The example disables trace caching and generates its fingerprints during
the build. Do not substitute an unstable executable path or timestamp for a logical
identity, and do not claim a caller-provided fingerprint has been verified by the
profile itself.

For another runtime, subclass `ApplicationLaunchProfile` and implement its protected
`command()` method. Keep domain logic, runtime selection, service supervision and
result oracles in separate modules. The Python app uses an abstract base class;
C# uses an abstract operation and calculator interface; Rust uses traits and
composition. New SDKs or GUI toolkits should extend those boundaries rather than
forking the runner.

## Desktop drivers and remaining boundaries

See [DESKTOP.md](DESKTOP.md). A driver's implementation language does not restrict
which application's controls it can inspect. The Python AT-SPI driver can inspect
accessible C++ GTK controls; the C# UIA driver can inspect accessible native Windows
controls. Exact toolkit/OS combinations must still pass their live checks.

These are application-control backends, not pytest, NUnit/xUnit or Cargo
implementations of the test runner. The new [C++17 SDK](native/cpp-sdk/README.md)
supports C++ test bodies with a small TypeScript discovery file and the shared
runner. Python, C# and Rust test-authoring SDKs remain future work. The runner,
locator execution, assertion polling and reports stay shared.
The existing C++ Qt helper remains the direct cooperative route for Qt; a Python
Qt binding and hybrid DOM/native coordination are not included.
