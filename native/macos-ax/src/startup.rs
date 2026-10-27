//! Read-only accessibility startup polling before the sidecar announces readiness.
use crate::error::{DriverError, Result};
use std::{
    thread,
    time::{Duration, Instant},
};

/// Waits for an observable application without replaying any platform mutation.
pub fn wait_for_ready(
    timeout: Duration,
    mut observe: impl FnMut() -> Result<bool>,
    mut running: impl FnMut() -> bool,
) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if !running() {
            return Err(DriverError::new(
                "CANCELLED",
                "application startup was cancelled or the owned process exited",
            ));
        }
        if Instant::now() >= deadline {
            return Err(DriverError::new(
                "OPERATION_TIMEOUT",
                "application accessibility did not become ready",
            ));
        }
        match observe() {
            Ok(true) if Instant::now() < deadline && running() => return Ok(()),
            Ok(_) => {}
            Err(error) if matches!(error.code, "OPERATION_TIMEOUT" | "NODE_STALE") => {}
            Err(error) => return Err(error),
        }
        thread::sleep(
            Duration::from_millis(25).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_reads_and_empty_tree_wait_until_observable() {
        let mut calls = 0;
        wait_for_ready(
            Duration::from_secs(1),
            || {
                calls += 1;
                match calls {
                    1 => Err(DriverError::new("OPERATION_TIMEOUT", "not ready")),
                    2 => Err(DriverError::stale()),
                    3 => Ok(false),
                    _ => Ok(true),
                }
            },
            || true,
        )
        .unwrap();
        assert_eq!(calls, 4);
    }

    #[test]
    fn permission_failure_is_never_retried() {
        let mut calls = 0;
        let error = wait_for_ready(
            Duration::from_secs(1),
            || {
                calls += 1;
                Err(DriverError::new("POLICY_DENIED", "permission denied"))
            },
            || true,
        )
        .unwrap_err();
        assert_eq!(error.code, "POLICY_DENIED");
        assert_eq!(calls, 1);
    }

    #[test]
    fn expired_startup_does_not_probe() {
        assert_eq!(
            wait_for_ready(Duration::ZERO, || panic!("expired probe"), || true)
                .unwrap_err()
                .code,
            "OPERATION_TIMEOUT"
        );
    }

    #[test]
    fn stopped_application_does_not_probe() {
        assert_eq!(
            wait_for_ready(
                Duration::from_secs(1),
                || panic!("cancelled probe"),
                || false
            )
            .unwrap_err()
            .code,
            "CANCELLED"
        );
    }
}
