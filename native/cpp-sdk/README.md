# C++ test authoring SDK

Write test bodies in C++17 and execute them through the same E2E Platform scheduler, drivers, assertions, reports and process cleanup used by TypeScript tests. The header-only SDK supplies an abstract `e2e::Transport`, a bounded `StdioTransport`, and application, locator, assertion, HTTP and process objects. New transports can derive from `Transport` without changing test-facing classes.

The SDK requires the Node.js runner and its `@e2e-platform/cpp` adapter. It is not a standalone replacement for the runner. A C++ test can drive any configured supported target; available controls and actions depend on that target's driver. The application and its tests do not need to use the same language.

## Install and consume with CMake

```sh
cmake -S native/cpp-sdk -B native/cpp-sdk/build -DCMAKE_INSTALL_PREFIX=/your/prefix
cmake --build native/cpp-sdk/build --config Release
ctest --test-dir native/cpp-sdk/build -C Release --output-on-failure
cmake --install native/cpp-sdk/build --config Release
```

In an external CMake project:

```cmake
find_package(e2eCpp CONFIG REQUIRED)
add_executable(my_e2e tests.cpp)
target_link_libraries(my_e2e PRIVATE e2e::cpp)
```

Set `CMAKE_PREFIX_PATH` to the installation prefix when configuring the external project. The installation contains the CMake package, C++ headers and their licenses; no source checkout include path is required. The bundled nlohmann JSON dependency is pinned and covered by its retained MIT notice in `THIRD_PARTY.md`.

## Write and register tests

```cpp
#include <e2e/test.hpp>

E2E_TEST("calculates a total") {
    session.app().open();
    session.screen().get_by_test_id("quantity").fill("6");
    session.screen().get_by_test_id("calculate").click();
    session.screen().get_by_test_id("result").expect().to_have_text("Total: 6");
}

int main(int argc, char** argv) { return e2e::run(argc, argv); }
```

Register the compiled binary from a `.e2e.ts` file:

```ts
import { registerCppTests } from '@e2e-platform/cpp';
await registerCppTests({ executable: '/absolute/path/to/my_e2e' });
```

Use the normal E2E configuration to select the application and engine, then run `e2e-platform run --no-model`. The parent discovers each `E2E_TEST` name, runs one fresh binary process per attempt, and records each test separately. Names must be unique, nonempty, at most 1024 bytes, and contain no control characters or leading/trailing whitespace. Do not print to stdout from static initializers or C APIs: stdout/stdin belong to the wire protocol. During a test body, ordinary `std::cout` output is redirected to stderr. Diagnostics should use stderr directly.

## Current API and boundaries

- `Session::app()` exposes open, restart, clear state, back, screenshot and base URL operations when supported by the configured engine.
- `Session::screen()` composes role, text, label, placeholder, test ID and display value locators. Locator methods include click, double/secondary click, fill, clear, focus, hover, press, check/uncheck, single string option selection, scrolling and text/value/count reads.
- `Locator::expect()` provides the visible, hidden, enabled, disabled, checked, text, value and count assertions, with negation and a polling timeout. `Session::expect_equal()` and `expect_true()` record value assertions in the parent report.
- `Session::processes().run()` executes a finite child command with an argument array, optional stdin, timeout and accepted exit codes. Results include status, exit code and bounded stdout/stderr. Long-lived service and interactive terminal objects are not exposed by this C++ API.
- `Session::http()` provides bounded requests, `get()` and `post_json()`. The caller supplies an explicit URL; response status, headers and body are available for assertions. Application server lifecycle must be configured or owned outside this API.

Custom TypeScript fixtures, test hooks, native window enumeration/activation, multi-option selection and arbitrary driver extensions are not yet exposed by this SDK. They remain separate from application-language compatibility. A C++ framework is not automatically certified because a C++ test can communicate with its application.

The version 1 newline JSON protocol caps each frame at 1 MiB, nesting at 64 levels and calls at 10,000 per test process. IDs are positive ordered integers; duplicate keys, malformed or mismatched responses, missing newlines and excess output fail closed. The parent enforces discovery, execution and process cleanup timeouts. Transport error messages do not repeat application output.

Void actions and assertions require a JSON `null` acknowledgement. A failed
operation or malformed acknowledgement makes the connection unusable and the
registered case exit unsuccessfully, even if its C++ body catches the exception.
Typed process and HTTP results also validate their complete field shapes and
ranges. Process exit codes use signed 64-bit storage for the full unsigned
32-bit Windows range without narrowing; HTTP statuses must be integers from
100 through 599, headers must have string values and truncation must be boolean.

## Verification

After building the workspace packages, run:

```sh
node scripts/native/verify-cpp-sdk.mjs
# After building the Qt example with scripts/native/verify.mjs --qt-only --require-quick:
node scripts/native/verify-cpp-sdk.mjs --qt
```

The verifier builds and installs the SDK, builds an external `find_package` consumer, installs the packed npm kit into a separate directory, and executes compiled C++ CLI and HTTP positive and planted-error tests. The HTTP application is supervised outside the C++ test API, with readiness and owned shutdown. Optional Qt checks drive controls through the real Qt helper. Retained qualification metadata and strict report/cleanup evidence are in `.e2e/cpp/sdk/`. Configured CI profiles are not evidence of a pass until their artifacts exist.
