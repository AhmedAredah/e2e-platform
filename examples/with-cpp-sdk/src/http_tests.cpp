// SPDX-License-Identifier: MIT
#include <e2e/test.hpp>
#include <cstdlib>

E2E_TEST("C++ test validates a real HTTP application") {
    const char* configured = std::getenv("E2E_CPP_HTTP_BASE_URL");
    if (configured == nullptr || std::string(configured).empty()) throw e2e::Error("Set E2E_CPP_HTTP_BASE_URL to the running application");
    const std::string base(configured);
    const auto health = session.http().get(base + "/health");
    session.expect_equal(health.status, 200);
    const auto response = session.http().get(base + "/sum?a=1.5&b=2.5");
    session.expect_equal(response.status, 200);
    const auto result = response.json();
    session.expect_equal(result.at("schemaVersion"), 1);
    session.expect_equal(result.at("operation"), "sum");
    session.expect_equal(result.at("sum"), 4);
    session.expect_equal(session.http().get(base + "/sum?a=invalid&b=2").status, 400);
    session.expect_equal(session.http().get(base + "/missing").status, 404);
}
int main(int argc, char** argv) { return e2e::run(argc, argv); }
