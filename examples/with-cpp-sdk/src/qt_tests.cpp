// SPDX-License-Identifier: MIT
#include <e2e/test.hpp>

E2E_TEST("C++ test drives Qt accessible controls") {
    session.app().open();
    const auto screen = session.screen();
    screen.get_by_test_id("quantity").fill("6");
    screen.get_by_test_id("unit-price").fill("12.5");
    screen.get_by_test_id("tax").check();
    screen.get_by_test_id("currency").select_option("EUR");
    screen.get_by_test_id("calculate").click();
    screen.get_by_test_id("result").expect().to_have_text("Total: 82.50 EUR");
    screen.get_by_test_id("status").expect().to_have_text("Calculated");
}
int main(int argc, char** argv) { return e2e::run(argc, argv); }
