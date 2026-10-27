//! Shared protocol and process ownership for the macOS Accessibility sidecar.
pub mod error;
pub mod platform;
pub mod process;
pub mod protocol;
pub mod provider;
pub mod server;
pub mod startup;
mod strict_json;

#[cfg(any(target_os = "macos", feature = "check-macos", test))]
mod budget;

#[cfg(any(target_os = "macos", feature = "check-macos", test))]
mod semantics;

#[cfg(any(target_os = "macos", feature = "check-macos", test))]
mod sensitivity;
