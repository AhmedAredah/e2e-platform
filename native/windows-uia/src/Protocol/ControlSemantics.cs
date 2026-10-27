using System.Globalization;

namespace E2E.Platform.Desktop.Protocol;

/// <summary>Canonical native roles and values shared by observation and portable contracts.</summary>
public static class ControlSemantics
{
    public static string Role(int typeId, bool gridItem = false) => typeId switch
    {
        50000 => "button", 50002 => "checkbox", 50003 => "combobox", 50004 => "textbox",
        50005 => "link", 50006 => "img", 50007 => "option", 50008 => "listbox", 50009 => "menu",
        50010 => "menubar", 50011 => "menuitem", 50012 => "progressbar", 50013 => "radio",
        50014 => "scrollbar", 50015 => "slider", 50016 => "spinbutton", 50018 => "tablist",
        50019 => "tab", 50020 => "text", 50021 => "toolbar", 50022 => "tooltip",
        50023 => "tree", 50024 => "treeitem", 50026 => "group", 50028 => "grid",
        50029 => gridItem ? "gridcell" : "row", 50030 => "document", 50032 => "window",
        50036 => "grid", _ => gridItem ? "gridcell" : "group"
    };

    public static string NumericValue(double value) => double.IsFinite(value)
        ? value.ToString("R", CultureInfo.InvariantCulture)
        : throw new DriverException("ENGINE_FAILURE");
}
