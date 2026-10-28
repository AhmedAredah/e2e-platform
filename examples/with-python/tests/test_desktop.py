"""Common semantic contract for the separately qualified Python GUI fixtures."""


def test_python_desktop_controls(e2e):
    e2e.app.open()
    e2e.screen.get_by_role("textbox", name="Name").fill("Ada café")
    check = e2e.screen.get_by_role("checkbox", name="Remember")
    check.check()
    check.expect().to_be_checked()
    check.uncheck()
    check.expect().not_.to_be_checked()
    e2e.screen.get_by_role("button", name="Submit").click()
    e2e.screen.get_by_role("textbox", name="Result").expect(
        message="[oracle:python-desktop]"
    ).to_have_value("Hello Ada café")
