"""Python-authored acceptance against the existing real platform reference apps."""

import os


def test_installed_python_desktop_consumer(e2e):
    e2e.app.open()
    backend = os.environ["E2E_DESKTOP_BACKEND"]
    screen = e2e.screen
    field = (
        screen.get_by_role("textbox", name="Name")
        if backend == "linux-atspi"
        else screen.get_by_test_id("input")
    )
    field.fill("E2E café")
    submit = (
        screen.get_by_role("button", name="Submit")
        if backend == "linux-atspi"
        else screen.get_by_test_id("apply" if backend == "macos-ax" else "submit")
    )
    submit.click()
    if backend == "linux-atspi":
        screen.get_by_role("text", name="Result").expect(
            message="[oracle:desktop-output]"
        ).to_have_text("Hello E2E café")
    elif backend == "macos-ax":
        screen.get_by_test_id("echo").expect(
            message="[oracle:desktop-output]"
        ).to_have_value("E2E café")
    else:
        screen.get_by_test_id("result").expect(
            message="[oracle:desktop-output]"
        ).to_have_text("E2E café")
        screen.get_by_test_id("load-choice").click()
        screen.get_by_test_id("delayed-choice").select_option("Later")
        screen.get_by_test_id("selection-result").expect().to_have_text("Later")
