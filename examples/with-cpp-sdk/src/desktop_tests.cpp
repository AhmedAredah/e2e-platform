// SPDX-License-Identifier: MIT
#include <e2e/test.hpp>
#include <cstdlib>

E2E_TEST("installed C++ desktop consumer validates application output") {
    const auto* configured = std::getenv("E2E_DESKTOP_BACKEND");
    if (!configured) throw e2e::Error("Missing desktop profile");
    const std::string backend(configured);
    session.app().open();
    const auto screen = session.screen();
    const auto input = backend == "linux-atspi"
        ? screen.get_by_role("textbox", "Name", true) : screen.get_by_test_id("input");
    input.fill("E2E café");
    const auto submit = backend == "linux-atspi" ? screen.get_by_role("button", "Submit", true)
        : screen.get_by_test_id(backend == "macos-ax" ? "apply" : "submit");
    submit.click();
    if (backend == "linux-atspi") {
        screen.get_by_role("text", "Result", true).expect().message("[oracle:desktop-output]").to_have_text("Hello E2E café");
    } else if (backend == "macos-ax") {
        screen.get_by_test_id("echo").expect().message("[oracle:desktop-output]").to_have_value("E2E café");
    } else if (backend == "windows-uia") {
        screen.get_by_test_id("result").expect().message("[oracle:desktop-output]").to_have_text("E2E café");
        screen.get_by_test_id("load-choice").click();
        screen.get_by_test_id("delayed-choice").select_option("Later");
        screen.get_by_test_id("selection-result").expect().to_have_text("Later");
    } else throw e2e::Error("Unknown desktop profile");
}
E2E_TEST_MAIN()
