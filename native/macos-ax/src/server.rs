//! Single-client loopback transport with bounded frames, startup and idle polling.
use crate::{
    error::{DriverError, Result},
    protocol::{MAX_FRAME_BYTES, Session},
    provider::AccessibleProvider,
};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};

/// The liveness callback observes owned-target exit, host exit and termination signals.
pub fn serve<P: AccessibleProvider>(
    listener: TcpListener,
    mut session: Session<P>,
    mut alive: impl FnMut() -> bool,
) -> Result<()> {
    listener
        .set_nonblocking(true)
        .map_err(|_| transport_error())?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut stream = loop {
        if !alive() {
            return Err(transport_error());
        }
        if Instant::now() >= deadline {
            return Err(DriverError::new(
                "OPERATION_TIMEOUT",
                "runner did not connect",
            ));
        }
        match listener.accept() {
            Ok((stream, peer)) if peer.ip().is_loopback() => break stream,
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25))
            }
            Err(_) => return Err(transport_error()),
        }
    };
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|_| transport_error())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| transport_error())?;
    let authentication_deadline = Instant::now() + Duration::from_secs(5);
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    while alive() {
        if !session.is_authenticated() && Instant::now() >= authentication_deadline {
            return Err(DriverError::new(
                "OPERATION_TIMEOUT",
                "authentication timed out",
            ));
        }
        match stream.read(&mut chunk) {
            Ok(0) => return Ok(()),
            Ok(count) => {
                buffer.extend_from_slice(&chunk[..count]);
                loop {
                    let Some(end) = buffer.iter().position(|byte| *byte == b'\n') else {
                        break;
                    };
                    if end > MAX_FRAME_BYTES {
                        return Err(transport_error());
                    }
                    let Some(response) = session.handle(&buffer[..end]) else {
                        return Err(transport_error());
                    };
                    buffer.drain(..=end);
                    write_response(&mut stream, &response)?;
                    if session.should_close() {
                        return Ok(());
                    }
                }
                if buffer.len() > MAX_FRAME_BYTES {
                    return Err(transport_error());
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock
                        | std::io::ErrorKind::TimedOut
                        | std::io::ErrorKind::Interrupted
                ) => {}
            Err(_) => return Err(transport_error()),
        }
    }
    Ok(())
}
fn write_response(stream: &mut TcpStream, response: &serde_json::Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(response).map_err(|_| transport_error())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err(transport_error());
    }
    bytes.push(b'\n');
    stream.write_all(&bytes).map_err(|_| transport_error())
}
fn transport_error() -> DriverError {
    DriverError::new("ENGINE_FAILURE", "desktop transport closed or invalid")
}
