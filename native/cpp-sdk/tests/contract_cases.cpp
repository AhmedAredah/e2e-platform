// SPDX-License-Identifier: MIT
#include <e2e/test.hpp>
#include <cstdlib>
#include <limits>
E2E_TEST("C++ contract café 漢字") {
    const auto* selected = std::getenv("E2E_CPP_CONTRACT_CASE");
    const std::string kind = selected ? selected : "equal";
    if (kind == "exit") std::exit(0);
    if (kind == "nonfinite") {
        try { session.expect_equal({{"value", std::numeric_limits<double>::quiet_NaN()}}, nullptr); } catch (...) {}
        return;
    }
    if (kind == "different") session.expect_equal(18446744073709551615ULL,18446744073709551614ULL,"[oracle:calculation]");
    else {
        session.expect_equal({{"max",18446744073709551615ULL},{"min",std::numeric_limits<std::int64_t>::min()}},
                             {{"max",18446744073709551615ULL},{"min",std::numeric_limits<std::int64_t>::min()}});
    }
}
E2E_TEST_MAIN()
