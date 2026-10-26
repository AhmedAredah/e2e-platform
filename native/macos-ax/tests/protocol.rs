use e2e_platform_macos_ax::{
    error::{DriverError, Result},
    protocol::{MAX_FRAME_BYTES, Session},
    provider::{AccessibleProvider, Action},
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
#[derive(Clone, Default)]
struct FakeProvider {
    actions: Arc<Mutex<Vec<String>>>,
    uncertain: bool,
}
impl AccessibleProvider for FakeProvider {
    fn snapshot(&mut self) -> Result<Value> {
        Ok(
            json!({"root":{"ref":{"id":"desktop-root","revision":""},"role":"application","children":[{"ref":{"id":"secret","revision":""},"role":"textbox","states":{"secure":true}}]},"viewport":{"width":1,"height":1}}),
        )
    }
    fn perform(&mut self, id: &str, action: &Action) -> Result<()> {
        if id != "control" {
            return Err(DriverError::stale());
        }
        self.actions.lock().unwrap().push(format!("{action:?}"));
        if self.uncertain {
            return Err(DriverError::new(
                "ACTION_MAY_HAVE_COMMITTED",
                "unknown result",
            ));
        }
        Ok(())
    }
}
fn token() -> String {
    "a".repeat(64)
}
fn request(id: u64, method: &str, params: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})).unwrap()
}
fn new_session() -> Session<FakeProvider> {
    Session::new(FakeProvider::default(), token()).unwrap()
}
fn authenticate(session: &mut Session<FakeProvider>) -> Value {
    session
        .handle(&request(
            1,
            "initialize",
            json!({"protocolVersion":1,"token":token()}),
        ))
        .unwrap()
}
fn perform(action: Value) -> Value {
    json!({"ref":{"id":"control","revision":"r1"},"action":action})
}
fn code(response: &Value) -> &str {
    response["error"]["data"]["code"].as_str().unwrap()
}

#[test]
fn authentication_is_required_and_failure_closes() {
    let mut s = new_session();
    let result = s.handle(&request(1, "snapshot", json!({}))).unwrap();
    assert_eq!(code(&result), "POLICY_DENIED");
    assert!(s.should_close());
    assert!(!result.to_string().contains(&token()));
}
#[test]
fn exact_token_required() {
    for invalid in ["a".repeat(63), "a".repeat(65), "b".repeat(64)] {
        let mut s = new_session();
        assert_eq!(
            code(
                &s.handle(&request(
                    1,
                    "initialize",
                    json!({"protocolVersion":1,"token":invalid})
                ))
                .unwrap()
            ),
            "POLICY_DENIED"
        );
    }
}
#[test]
fn capabilities_are_semantic_only() {
    let mut s = new_session();
    let r = authenticate(&mut s);
    assert_eq!(r["result"]["keyboard"], false);
    assert_eq!(r["result"]["screenshots"], false);
    assert!(
        !r["result"]["actions"]
            .as_array()
            .unwrap()
            .contains(&json!("selectOption"))
    );
}
#[test]
fn malformed_and_unknown_fields_close() {
    for bytes in [
        b"not json".to_vec(),
        request(0, "initialize", json!({})),
        br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{},"extra":1}"#.to_vec(),
        br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{},"id":2}"#.to_vec(),
    ] {
        let mut s = new_session();
        assert!(s.handle(&bytes).is_none());
        assert!(s.should_close());
    }
}
#[test]
fn nested_duplicates_close() {
    let mut s = new_session();
    authenticate(&mut s);
    assert!(s.handle(br#"{"jsonrpc":"2.0","id":2,"method":"perform","params":{"ref":{"id":"control","revision":""},"action":{"kind":"tap","kind":"clear"}}}"#).is_none());
}
#[test]
fn oversized_frame_closes() {
    let mut s = new_session();
    assert!(s.handle(&vec![b' '; MAX_FRAME_BYTES + 1]).is_none());
}
#[test]
fn snapshot_does_not_invent_pixels() {
    let mut s = new_session();
    authenticate(&mut s);
    let r = s
        .handle(&request(2, "snapshot", json!({"pixels":true})))
        .unwrap();
    assert!(r["result"].get("screenshot").is_none());
    assert_eq!(r["result"]["root"]["children"][0]["states"]["secure"], true);
}
#[test]
fn stale_ids_are_explicit() {
    let mut s = new_session();
    authenticate(&mut s);
    let r = s
        .handle(&request(
            2,
            "perform",
            json!({"ref":{"id":"deleted","revision":"r1"},"action":{"kind":"tap"}}),
        ))
        .unwrap();
    assert_eq!(code(&r), "NODE_STALE");
}
#[test]
fn unsupported_input_has_no_fallback() {
    let mut s = new_session();
    authenticate(&mut s);
    for (id, method) in [(2, "keyboard.press"), (3, "screenshot"), (4, "evaluate")] {
        assert_eq!(
            code(&s.handle(&request(id, method, json!({}))).unwrap()),
            "UNSUPPORTED_CAPABILITY"
        );
    }
}
#[test]
fn modifiers_are_rejected_before_mutation() {
    let provider = FakeProvider::default();
    let calls = provider.actions.clone();
    let mut s = Session::new(provider, token()).unwrap();
    authenticate(&mut s);
    let r = s
        .handle(&request(
            2,
            "perform",
            perform(json!({"kind":"tap","modifiers":["Shift"]})),
        ))
        .unwrap();
    assert_eq!(code(&r), "UNSUPPORTED_CAPABILITY");
    assert!(calls.lock().unwrap().is_empty());
}
#[test]
fn fill_is_typed_and_mutated_once() {
    let provider = FakeProvider::default();
    let calls = provider.actions.clone();
    let mut s = Session::new(provider, token()).unwrap();
    authenticate(&mut s);
    let r = s
        .handle(&request(
            2,
            "perform",
            perform(json!({"kind":"fill","value":"hello λ","sensitive":true})),
        ))
        .unwrap();
    assert_eq!(r["result"], Value::Null);
    assert_eq!(calls.lock().unwrap().len(), 1);
    assert!(!r.to_string().contains("hello"));
}
#[test]
fn invalid_fill_rejected_before_dispatch() {
    let provider = FakeProvider::default();
    let calls = provider.actions.clone();
    let mut s = Session::new(provider, token()).unwrap();
    authenticate(&mut s);
    for (id, action) in [
        (2, json!({"kind":"fill","value":"x"})),
        (3, json!({"kind":"fill","value":10,"sensitive":false})),
        (
            4,
            json!({"kind":"fill","value":"x".repeat(65537),"sensitive":false}),
        ),
    ] {
        assert_eq!(
            code(&s.handle(&request(id, "perform", perform(action))).unwrap()),
            "UNSUPPORTED_CAPABILITY"
        );
    }
    assert!(calls.lock().unwrap().is_empty());
}
#[test]
fn id_replay_closes_without_repeating_mutation() {
    let provider = FakeProvider::default();
    let calls = provider.actions.clone();
    let mut s = Session::new(provider, token()).unwrap();
    authenticate(&mut s);
    let req = request(2, "perform", perform(json!({"kind":"tap"})));
    assert!(s.handle(&req).is_some());
    assert!(s.handle(&req).is_none());
    assert_eq!(calls.lock().unwrap().len(), 1);
}
#[test]
fn uncertain_mutation_closes_session() {
    let mut s = Session::new(
        FakeProvider {
            uncertain: true,
            ..Default::default()
        },
        token(),
    )
    .unwrap();
    authenticate(&mut s);
    let r = s
        .handle(&request(2, "perform", perform(json!({"kind":"tap"}))))
        .unwrap();
    assert_eq!(code(&r), "ACTION_MAY_HAVE_COMMITTED");
    assert!(s.should_close());
}
#[test]
fn shutdown_acknowledges_and_closes() {
    let mut s = new_session();
    authenticate(&mut s);
    assert_eq!(
        s.handle(&request(2, "shutdown", json!({}))).unwrap()["result"],
        Value::Null
    );
    assert!(s.should_close());
}
