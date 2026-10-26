//! Errors deliberately omit platform descriptions and application content.
#[derive(Debug, Clone)]
pub struct DriverError {
    pub code: &'static str,
    pub message: &'static str,
}
impl DriverError {
    pub const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
    pub const fn unsupported() -> Self {
        Self::new(
            "UNSUPPORTED_CAPABILITY",
            "control does not support this operation",
        )
    }
    pub const fn stale() -> Self {
        Self::new("NODE_STALE", "accessible object is no longer available")
    }
}
pub type Result<T> = std::result::Result<T, DriverError>;
