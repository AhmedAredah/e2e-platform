#[cfg(any(target_os = "macos", feature = "check-macos"))]
#[allow(dead_code)]
fn run_macos() -> e2e_platform_macos_ax::error::Result<()> {
    use e2e_platform_macos_ax::{
        error::DriverError, platform::macos::MacOsProvider, process::OwnedApplication,
        protocol::Session, provider::AccessibleProvider, server::serve, startup::wait_for_ready,
    };
    use std::{
        io::Write,
        net::TcpListener,
        sync::{
            Arc,
            atomic::{AtomicBool, AtomicI32, Ordering},
        },
        thread,
        time::Duration,
    };
    static STOP: AtomicBool = AtomicBool::new(false);
    static TARGET_PID: AtomicI32 = AtomicI32::new(0);
    extern "C" fn stop(_: i32) {
        STOP.store(true, Ordering::Relaxed);
        let pid = TARGET_PID.load(Ordering::Relaxed);
        // POSIX kill is async-signal-safe; do not wait for a blocked AX call to return.
        if pid > 0 {
            unsafe {
                kill(-pid, 9);
            }
        }
    }
    unsafe extern "C" {
        fn signal(signal: i32, handler: extern "C" fn(i32)) -> usize;
        fn getppid() -> i32;
        fn kill(pid: i32, signal: i32) -> i32;
    }
    unsafe {
        signal(2, stop);
        signal(15, stop);
        signal(1, stop);
    }
    let parent_pid = unsafe { getppid() };
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    if arguments.first().is_none_or(|arg| arg != "--") {
        return Err(DriverError::new(
            "INVALID_CONFIG",
            "usage: e2e-platform-macos-ax -- executable [arguments]",
        ));
    }
    let token = std::env::var("E2E_NATIVE_TOKEN")
        .map_err(|_| DriverError::new("INVALID_CONFIG", "E2E_NATIVE_TOKEN is required"))?;
    MacOsProvider::require_trust()?;
    let mut application = OwnedApplication::launch(&arguments[1..])?;
    TARGET_PID.store(application.pid() as i32, Ordering::Relaxed);
    if STOP.load(Ordering::Relaxed) {
        return Err(DriverError::new(
            "CANCELLED",
            "desktop launch was cancelled",
        ));
    }
    // This watchdog remains responsive if Accessibility IPC blocks on the main thread.
    struct Watchdog {
        done: Arc<AtomicBool>,
        thread: Option<thread::JoinHandle<()>>,
    }
    impl Drop for Watchdog {
        fn drop(&mut self) {
            self.done.store(true, Ordering::Relaxed);
            if let Some(worker) = self.thread.take() {
                let _ = worker.join();
            }
            TARGET_PID.store(0, Ordering::Relaxed);
        }
    }
    let done = Arc::new(AtomicBool::new(false));
    let stopped = done.clone();
    let target_pid = application.pid() as i32;
    let _watchdog = Watchdog {
        done,
        thread: Some(thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                if unsafe { getppid() } != parent_pid || STOP.load(Ordering::Relaxed) {
                    unsafe {
                        kill(-target_pid, 9);
                    }
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
        })),
    };
    let mut provider = MacOsProvider::new(application.pid())?;
    wait_for_ready(
        Duration::from_secs(20),
        || {
            provider.snapshot().map(|snapshot| {
                snapshot["root"]["children"]
                    .as_array()
                    .is_some_and(|children| !children.is_empty())
            })
        },
        || {
            !STOP.load(Ordering::Relaxed)
                && unsafe { getppid() } == parent_pid
                && application.is_running()
        },
    )?;
    let session = Session::new(provider, token)?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| DriverError::new("ENGINE_FAILURE", "could not bind loopback server"))?;
    println!(
        "E2E_NATIVE_READY {{\"port\":{}}}",
        listener
            .local_addr()
            .map_err(|_| DriverError::new("ENGINE_FAILURE", "could not inspect server address"))?
            .port()
    );
    std::io::stdout()
        .flush()
        .map_err(|_| DriverError::new("ENGINE_FAILURE", "could not announce readiness"))?;
    serve(listener, session, || {
        !STOP.load(Ordering::Relaxed)
            && unsafe { getppid() } == parent_pid
            && application.is_running()
    })
}
#[cfg(target_os = "macos")]
fn run() -> e2e_platform_macos_ax::error::Result<()> {
    run_macos()
}
#[cfg(not(target_os = "macos"))]
fn run() -> e2e_platform_macos_ax::error::Result<()> {
    Err(e2e_platform_macos_ax::error::DriverError::new(
        "UNSUPPORTED_CAPABILITY",
        "macOS Accessibility requires macOS",
    ))
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{}: {}", error.code, error.message);
        std::process::exit(2);
    }
}
