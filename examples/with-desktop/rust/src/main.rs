//! Real AppKit controls, constructed in Rust without third-party GUI dependencies.
#[cfg(any(target_os = "macos", feature = "check-macos"))]
mod appkit;
fn main() {
    #[cfg(target_os = "macos")]
    unsafe {
        appkit::run();
    }
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("This GUI fixture requires macOS.");
        std::process::exit(2);
    }
}
