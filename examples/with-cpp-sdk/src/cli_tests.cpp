// SPDX-License-Identifier: MIT
#include <e2e/test.hpp>
#include <cstdlib>

E2E_TEST("C++ test validates a real compiled CLI") {
    const char* executable = std::getenv("E2E_CPP_BINARY");
    if (!executable || !*executable) throw e2e::Error("E2E_CPP_BINARY is required");
    const auto result = session.processes().run(executable, {"sum", "--a", "1.5", "--b", "2.5"});
    session.expect_equal(result.exit_code.value_or(-1), 0);
    session.expect_equal(e2e::parse_json(result.stdout_text).at("sum"), 4);
    session.expect_true(!result.truncated && result.stderr_text.empty());
}
int main(int argc, char** argv) { return e2e::run(argc, argv); }
