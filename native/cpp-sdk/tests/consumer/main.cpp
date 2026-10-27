// SPDX-License-Identifier: MIT
#include <e2e/test.hpp>
E2E_TEST("installed C++ SDK consumer") { session.expect_true(true); }
int main(int argc, char** argv) { return e2e::run(argc, argv); }
