//! A platform implementation supplies semantic controls, not arbitrary evaluation.
use crate::error::Result;
use serde_json::Value;

pub const ACTIONS: &[&str] = &[
    "tap",
    "fill",
    "clear",
    "focus",
    "check",
    "uncheck",
    "scrollIntoView",
    "selectOption",
];

/// Implementations must sanitize secrets before returning JSON and must not retry mutations.
pub trait AccessibleProvider {
    fn supports_actionability(&self) -> bool {
        false
    }
    fn preflight(&mut self, _id: &str, _action: &Action) -> Result<()> {
        Err(crate::error::DriverError::unsupported())
    }
    fn snapshot(&mut self) -> Result<Value>;
    fn perform(&mut self, id: &str, action: &Action) -> Result<()>;
}

#[derive(Debug, PartialEq)]
pub enum Action {
    Tap,
    Fill { value: String, sensitive: bool },
    Clear,
    Focus,
    Check,
    Uncheck,
    ScrollIntoView,
    SelectOption(SelectionChoice),
}

#[derive(Debug, PartialEq)]
pub enum SelectionChoice {
    Label(String),
    Value(String),
    Index(usize),
}
