//! Platform implementations are compile-time selected; unsupported systems fail closed.
#[cfg(any(target_os = "macos", feature = "check-macos"))]
pub mod macos;
