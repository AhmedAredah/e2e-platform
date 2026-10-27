#!/usr/bin/env python3
"""A real GTK3 accessible-control fixture; no e2e driver code runs in this app."""
import sys
import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk


class ControlsWindow(Gtk.Window):
    """Expose stable accessible names and intentionally wrong behavior when requested."""

    def __init__(self):
        super().__init__(title="E2E Platform GTK controls")
        self.set_default_size(480, 320)
        self.connect("destroy", Gtk.main_quit)
        layout = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.add(layout)
        self.name_entry = Gtk.Entry()
        self.name_entry.get_accessible().set_name("Name")
        layout.pack_start(self.name_entry, False, False, 0)
        password = Gtk.Entry()
        password.set_visibility(False)
        password.set_text("fixture-secret-never-serialize")
        password.get_accessible().set_name("Password")
        layout.pack_start(password, False, False, 0)
        reveal = Gtk.Button(label="Reveal password")
        reveal.connect("clicked", lambda _button: password.set_visibility(True))
        layout.pack_start(reveal, False, False, 0)
        self.checkbox = Gtk.CheckButton(label="Remember")
        layout.pack_start(self.checkbox, False, False, 0)
        self.listbox = Gtk.ListBox()
        self.listbox.set_selection_mode(Gtk.SelectionMode.SINGLE)
        self.listbox.get_accessible().set_name("Choice")
        for name in ("Alpha", "Beta"):
            row = Gtk.ListBoxRow()
            row.get_accessible().set_name(name)
            row.add(Gtk.Label(label=name))
            self.listbox.add(row)
        layout.pack_start(self.listbox, False, False, 0)
        self.result = Gtk.Label(label="Waiting")
        self.result.get_accessible().set_name("Result")
        button = Gtk.Button(label="Submit")
        button.connect("clicked", self.submit)
        layout.pack_start(button, False, False, 0)
        layout.pack_start(self.result, False, False, 0)
        self.show_all()

    def submit(self, _button):
        self.result.set_text("Wrong result" if "--wrong" in sys.argv else "Hello " + self.name_entry.get_text())


if __name__ == "__main__":
    ControlsWindow()
    Gtk.main()
