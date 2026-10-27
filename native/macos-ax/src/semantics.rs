//! Pure, portable interpretation of AX metadata; unknown visibility never means visible.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    pub fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite() && value.abs() <= 1_000_000.0)
            && self.width > 0.0
            && self.height > 0.0
    }
    pub fn intersection(self, other: Self) -> Option<Self> {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let result = Self {
            x,
            y,
            width: (self.x + self.width).min(other.x + other.width) - x,
            height: (self.y + self.height).min(other.y + other.height) - y,
        };
        (self.valid() && other.valid() && result.valid()).then_some(result)
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Visibility {
    Visible,
    Hidden,
    Unknown,
}
impl Visibility {
    pub fn hidden(self) -> bool {
        self != Self::Visible
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Visible => "visible",
            Self::Hidden => "hidden",
            Self::Unknown => "unknown",
        }
    }
}
/// AX geometry establishes semantic viewport visibility, never physical occlusion or pointer hit testing.
pub(crate) fn visibility(
    hidden: Option<bool>,
    app_hidden: Option<bool>,
    minimized: Option<bool>,
    parent_hidden: bool,
    rect: Option<Rect>,
    clip: Option<Rect>,
) -> Visibility {
    if hidden == Some(true) || app_hidden == Some(true) || minimized == Some(true) || parent_hidden
    {
        return Visibility::Hidden;
    }
    match (rect, clip) {
        (Some(rect), Some(clip)) if rect.valid() && clip.valid() => {
            if rect.intersection(clip).is_none() {
                return Visibility::Hidden;
            }
            if app_hidden == Some(false) && minimized == Some(false) {
                return Visibility::Visible;
            }
        }
        _ => {}
    }
    Visibility::Unknown
}
pub(crate) fn role(role: &str) -> &'static str {
    match role {
        "AXApplication" => "application",
        "AXWindow" => "window",
        "AXButton" => "button",
        "AXCheckBox" => "checkbox",
        "AXSwitch" => "switch",
        "AXRadioButton" => "radio",
        "AXRadioGroup" => "radiogroup",
        "AXTextField" | "AXTextArea" => "textbox",
        "AXStaticText" => "text",
        "AXComboBox" | "AXPopUpButton" => "combobox",
        "AXMenu" => "menu",
        "AXMenuBar" => "menubar",
        "AXMenuItem" => "menuitem",
        "AXTable" => "grid",
        "AXRow" => "row",
        "AXCell" => "gridcell",
        "AXList" => "listbox",
        "AXSlider" => "slider",
        "AXLink" => "link",
        "AXImage" => "img",
        "AXTabGroup" => "tablist",
        "AXOutline" => "tree",
        "AXScrollArea" => "region",
        "AXIncrementor" => "spinbutton",
        "AXProgressIndicator" => "progressbar",
        "AXToolbar" => "toolbar",
        _ => "group",
    }
}
/// Only scroll areas establish an additional clip. Ordinary AX groups can have overflowing children.
pub(crate) fn child_clip(role: &str, inherited: Option<Rect>, rect: Option<Rect>) -> Option<Rect> {
    if role != "AXScrollArea" {
        return inherited;
    }
    match (inherited, rect) {
        (Some(clip), Some(rect)) => clip.intersection(rect),
        (clip, None) => clip,
        (None, _) => None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn rect(x: f64) -> Rect {
        Rect {
            x,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        }
    }
    #[test]
    fn missing_visibility_evidence_is_not_visible() {
        for (app, window) in [(None, None), (Some(false), None), (None, Some(false))] {
            assert_eq!(
                visibility(None, app, window, false, Some(rect(0.0)), Some(rect(0.0))),
                Visibility::Unknown
            );
        }
        assert!(Visibility::Unknown.hidden());
        assert_eq!(Visibility::Unknown.label(), "unknown");
    }
    #[test]
    fn hidden_minimized_and_clipped_controls_are_not_visible() {
        assert_eq!(
            visibility(
                Some(true),
                Some(false),
                Some(false),
                false,
                Some(rect(0.0)),
                Some(rect(0.0))
            ),
            Visibility::Hidden
        );
        assert_eq!(
            visibility(
                None,
                Some(true),
                Some(false),
                false,
                Some(rect(0.0)),
                Some(rect(0.0))
            ),
            Visibility::Hidden
        );
        assert_eq!(
            visibility(
                None,
                Some(false),
                Some(true),
                false,
                Some(rect(0.0)),
                Some(rect(0.0))
            ),
            Visibility::Hidden
        );
        assert_eq!(
            visibility(
                None,
                Some(false),
                Some(false),
                true,
                Some(rect(0.0)),
                Some(rect(0.0))
            ),
            Visibility::Hidden
        );
        assert_eq!(
            visibility(
                None,
                Some(false),
                Some(false),
                false,
                Some(rect(20.0)),
                Some(rect(0.0))
            ),
            Visibility::Hidden
        );
    }
    #[test]
    fn only_positive_intersection_with_known_window_is_visible() {
        assert_eq!(
            visibility(
                None,
                Some(false),
                Some(false),
                false,
                Some(rect(5.0)),
                Some(rect(0.0))
            ),
            Visibility::Visible
        );
        assert_eq!(
            visibility(None, Some(false), Some(false), false, None, Some(rect(0.0))),
            Visibility::Unknown
        );
        let mut bad = rect(0.0);
        bad.width = f64::NAN;
        assert_eq!(
            visibility(
                None,
                Some(false),
                Some(false),
                false,
                Some(bad),
                Some(rect(0.0))
            ),
            Visibility::Unknown
        );
    }
    #[test]
    fn roles_match_common_desktop_contract() {
        for (source, expected) in [
            ("AXList", "listbox"),
            ("AXTable", "grid"),
            ("AXCell", "gridcell"),
            ("AXImage", "img"),
        ] {
            assert_eq!(role(source), expected);
        }
    }
    #[test]
    fn ordinary_groups_do_not_clip_overflowing_children() {
        let viewport = Some(Rect {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
        });
        assert_eq!(child_clip("AXGroup", viewport, Some(rect(0.0))), viewport);
        assert_eq!(
            child_clip("AXScrollArea", viewport, Some(rect(0.0))),
            Some(rect(0.0))
        );
    }
}
