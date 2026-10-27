# Tests written in C++

These small C++17 executables demonstrate test authoring through the installed E2E Platform C++ SDK. The CLI application and Qt application are the existing repository examples. The Node.js parent runner supplies scheduling, drivers, assertions, reports and cleanup; the C++ SDK is not an independent test runner.

Build and install `native/cpp-sdk`, then configure this example against that installation:

```sh
cmake -S native/cpp-sdk -B native/cpp-sdk/build -DCMAKE_INSTALL_PREFIX=/your/prefix
cmake --build native/cpp-sdk/build --config Release
cmake --install native/cpp-sdk/build --config Release
cmake -S examples/with-cpp-sdk -B examples/with-cpp-sdk/build -DCMAKE_PREFIX_PATH=/your/prefix
cmake --build examples/with-cpp-sdk/build --config Release
```

Build the application under `examples/with-cpp-cli`, set `E2E_CPP_BINARY` to its calculator executable, and set `E2E_CPP_TEST_BINARY` to this example's `e2e_cpp_cli_tests` executable. Then run `pnpm --filter e2e-example-with-cpp-sdk test:e2e`. On multi-configuration generators, executable paths include the selected configuration, such as `Release/`; Windows executables have the `.exe` suffix.

`e2e_cpp_negative_tests` uses the calculator's deliberate wrong-output switch. Its E2E run must fail an assertion despite the application exiting successfully. It is a failure-detection check, not a passing application test.

`e2e_cpp_http_tests` calls the real C++ HTTP reference application. Start `e2e_cpp_http`, read its readiness port, and set `E2E_CPP_HTTP_BASE_URL` to `http://127.0.0.1:<port>` and `E2E_CPP_TEST_BINARY` to the HTTP test executable before `test:e2e`. The test checks status, parsed arithmetic results, invalid arguments and missing routes. The qualification script automates service readiness and owned shutdown for both correct and deliberately wrong HTTP responses. This reference socket server does not certify a third-party C++ HTTP framework.

For Qt, build `examples/with-qt`, set `E2E_QT_DEMO` to its Widgets application and `E2E_CPP_TEST_BINARY` to `e2e_cpp_qt_tests`, and run `pnpm --filter e2e-example-with-cpp-sdk test:qt`. This C++ test fills fields, checks a checkbox, selects a currency, clicks Calculate and verifies the resulting total and status. The Qt helper uses toolkit events; this does not establish native OS input coverage or certify other GUI frameworks.

For reproducible installation verification, run `node scripts/native/verify-cpp-sdk.mjs` from the repository root after `pnpm build:native`. Add `--qt` after `node scripts/native/verify.mjs --qt-only --require-quick` to also execute the C++ Qt positive and planted-error cases. That script resolves executables through the CMake File API, builds against an installed SDK, installs the packed npm kit into a temporary external consumer, and validates assertion and cleanup outcomes.

See [the SDK documentation](../../native/cpp-sdk/README.md) for the supported methods and protocol limits. The inheritance extension point is `e2e::Transport`; the example uses the supplied standard-input/output implementation.
