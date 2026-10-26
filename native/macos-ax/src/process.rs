//! Owned child process groups. No shell expansion and no credentials in the target environment.
use crate::error::{DriverError, Result};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::{
    ffi::OsString,
    process::{Child, Command, Stdio},
};

pub struct OwnedApplication {
    child: Child,
    stopped: bool,
}
impl OwnedApplication {
    pub fn launch(arguments: &[OsString]) -> Result<Self> {
        let Some(executable) = arguments.first() else {
            return Err(DriverError::new(
                "INVALID_CONFIG",
                "expected -- executable [arguments]",
            ));
        };
        let mut command = Command::new(executable);
        command
            .args(&arguments[1..])
            .env_remove("E2E_NATIVE_TOKEN")
            .env_remove("E2E_NATIVE_PORT")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        command.process_group(0);
        let child = command
            .spawn()
            .map_err(|_| DriverError::new("ENGINE_FAILURE", "could not launch application"))?;
        Ok(Self {
            child,
            stopped: false,
        })
    }
    pub fn pid(&self) -> u32 {
        self.child.id()
    }
    pub fn is_running(&mut self) -> bool {
        self.child.try_wait().is_ok_and(|status| status.is_none())
    }
    pub fn stop(&mut self) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        #[cfg(unix)]
        {
            unsafe extern "C" {
                fn kill(pid: i32, signal: i32) -> i32;
            }
            // Only the fresh process group created above is addressed, including after its leader exits.
            if let Ok(pid) = i32::try_from(self.child.id()) {
                unsafe {
                    kill(-pid, 9);
                }
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Drop for OwnedApplication {
    fn drop(&mut self) {
        self.stop();
    }
}
