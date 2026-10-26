use e2e_platform_macos_ax::{
    error::Result,
    process::OwnedApplication,
    protocol::Session,
    provider::{AccessibleProvider, Action},
    server::serve,
};
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};
struct Provider;
impl AccessibleProvider for Provider {
    fn snapshot(&mut self) -> Result<Value> {
        Ok(json!({}))
    }
    fn perform(&mut self, _: &str, _: &Action) -> Result<()> {
        Ok(())
    }
}
#[test]
fn loopback_shutdown_replies_and_returns() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let worker = thread::spawn(move || {
        serve(
            listener,
            Session::new(Provider, "a".repeat(64)).unwrap(),
            || true,
        )
    });
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    for (id, method, params) in [
        (
            1,
            "initialize",
            json!({"protocolVersion":1,"token":"a".repeat(64)}),
        ),
        (2, "shutdown", json!({})),
    ] {
        writeln!(
            stream,
            "{}",
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
        )
        .unwrap();
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let response: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(response["id"], id);
        assert!(response.get("result").is_some());
    }
    assert!(worker.join().unwrap().is_ok());
}
#[test]
fn disconnect_returns_instead_of_leaving_sidecar_alive() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let deadline = Instant::now() + Duration::from_secs(2);
    let worker = thread::spawn(move || {
        serve(
            listener,
            Session::new(Provider, "a".repeat(64)).unwrap(),
            || Instant::now() < deadline,
        )
    });
    let stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    drop(stream);
    assert!(worker.join().unwrap().is_ok());
}
#[cfg(unix)]
#[test]
fn owned_application_stops_and_reaps_child() {
    let mut app =
        OwnedApplication::launch(&["/bin/sh".into(), "-c".into(), "sleep 60".into()]).unwrap();
    assert!(app.is_running());
    app.stop();
    assert!(!app.is_running());
    app.stop();
}
#[test]
fn invalid_launch_does_not_create_an_owner() {
    assert!(OwnedApplication::launch(&[]).is_err());
    assert!(OwnedApplication::launch(&["/does/not/exist".into()]).is_err());
}
