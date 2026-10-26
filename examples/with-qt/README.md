# C++ Qt examples

The Widgets example imports a CSV, edits quantities/prices, applies tax,
calculates asynchronously and exports JSON. The optional Quick example tests
the same calculation through QML controls. Both contain the real native helper.

The Widgets example exports only a completed valid calculation for its current
quantity, price, tax and currency. Editing those inputs invalidates the result;
invalid inputs, overflow, and edits during the asynchronous calculation cannot
export an earlier result or truncate an existing output file.

Requirements: C++17 compiler, CMake 3.16+, Qt 6.2+ Widgets/Network/Test; add
Quick/Qml and the Qt Quick Controls/Layouts runtime modules for the QML example.
Node and pnpm requirements are the repository's normal requirements.
The example source is [MIT licensed](LICENSE); Qt retains its separate
[dependency terms](../../native/qt/THIRD_PARTY.md).

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:cpp
cmake -S examples/with-qt -B examples/with-qt/build -DCMAKE_BUILD_TYPE=Release
cmake --build examples/with-qt/build --config Release
ctest --test-dir examples/with-qt/build -C Release --output-on-failure
cd examples/with-qt/e2e
pnpm test
pnpm test:quick
```

This example uses the fork's local pnpm workspace packages, which have not been
published. Install dependencies from the repository root. On Linux CI, wrap a test command with
`xvfb-run -a`, or set `QT_QPA_PLATFORM=offscreen` for the component/rendering lane.
An offscreen pass is not a real desktop-platform integration pass.

On Windows, run CMake from the matching MSVC developer shell and configure
`CMAKE_PREFIX_PATH` to the matching Qt MSVC kit. The default test path is
`build/Release/e2e_qt_demo.exe`. Deploy Qt runtime libraries/plugins with Qt's
`windeployqt` or use a correctly configured Qt development environment.
On macOS, use the matching Qt kit and CMake prefix; the targets are ordinary
executables. Run GUI tests in an unlocked graphical session for desktop checks.
These platform instructions are provided for verification; Linux is the local
execution environment used during development.

Override `E2E_QT_DEMO` or `E2E_QT_QUICK_DEMO` for another build layout.
`-DE2E_QT_WITH_QUICK=OFF` omits Quick. Runtime QML module availability matters
even when the C++ Quick target compiles.

## Deliberate defect

The Widgets binary accepts `--bad-calculation`, adding 1 to the total. The
normal deterministic assertion must then fail:

```sh
E2E_QT_BAD_CALCULATION=1 pnpm test
```

The expected result is a test failure for `83.50` versus `82.50`, not a process
startup/configuration failure. It demonstrates that a plausible-looking GUI
cannot turn an incorrect numerical result into a passing test.

`pnpm test:agent` runs a natural-language goal followed by an exact total
assertion. It requires the configured model credentials. Deterministic suites
and C++ protocol tests do not require a model. No model run is implied by an
ordinary deterministic pass.

See [helper scope and limits](../../native/qt/README.md) and
[the native protocol](../../packages/native/PROTOCOL.md).

Native component checks were rerun for this MIT fork on October 24, 2026, with
GCC 13.3, Qt 6.4.2 and the Linux offscreen platform: the calculator, bridge and
surface suites passed. The built MIT runner passed all three Widgets tests and
the Quick test. The planted wrong calculation exited 1 with `ASSERTION_FAILED`;
every attempt completed cleanup. The runner verifier writes exact workflow results to
`.e2e/cpp/verification.json` at the repository root and detailed example reports
under `e2e/.e2e/`. Windows, macOS and real desktop sessions require separate
qualification.
