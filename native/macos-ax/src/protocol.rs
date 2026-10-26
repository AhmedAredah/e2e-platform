//! Strict JSON-RPC native-v1 dispatch with an authenticated session boundary.
use crate::{
    error::{DriverError, Result},
    provider::{ACTIONS, AccessibleProvider, Action},
};
use serde_json::{Value, json};

pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_TEXT_BYTES: usize = 65_536;

pub struct Session<P> {
    provider: P,
    token: Vec<u8>,
    authenticated: bool,
    last_id: u64,
    shutdown: bool,
    poisoned: bool,
}
impl<P: AccessibleProvider> Session<P> {
    /// A session owns one provider and rejects malformed frames without echoing their contents.
    pub fn new(provider: P, token: String) -> Result<Self> {
        if token.len() != 64 || !token.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(DriverError::new(
                "INVALID_CONFIG",
                "E2E_NATIVE_TOKEN must be a 32-byte hexadecimal token",
            ));
        }
        Ok(Self {
            provider,
            token: token.into_bytes(),
            authenticated: false,
            last_id: 0,
            shutdown: false,
            poisoned: false,
        })
    }
    pub fn is_authenticated(&self) -> bool {
        self.authenticated
    }
    pub fn should_close(&self) -> bool {
        self.shutdown || self.poisoned
    }

    /// None means close the connection; no error body includes supplied tokens, values or selectors.
    pub fn handle(&mut self, bytes: &[u8]) -> Option<Value> {
        if self.should_close() || bytes.len() > MAX_FRAME_BYTES {
            self.poisoned = true;
            return None;
        }
        let request: Value = match crate::strict_json::parse(bytes) {
            Ok(value) => value,
            Err(_) => {
                self.poisoned = true;
                return None;
            }
        };
        let Some(object) = request.as_object() else {
            self.poisoned = true;
            return None;
        };
        let valid = object.len() == 4
            && object.get("jsonrpc") == Some(&json!("2.0"))
            && object.get("method").is_some_and(Value::is_string)
            && object.get("params").is_some_and(Value::is_object);
        let Some(id) = object
            .get("id")
            .and_then(Value::as_u64)
            .filter(|id| *id > self.last_id && *id <= 9_007_199_254_740_991)
        else {
            self.poisoned = true;
            return None;
        };
        if !valid {
            self.poisoned = true;
            return None;
        }
        self.last_id = id;
        let method = request["method"].as_str()?;
        let params = &request["params"];
        if !self.authenticated {
            let valid_token = params["token"]
                .as_str()
                .is_some_and(|value| constant_time_equal(value.as_bytes(), &self.token));
            if method != "initialize"
                || !keys(
                    params,
                    &["protocolVersion", "token"],
                    &["protocolVersion", "token"],
                )
                || params["protocolVersion"] != json!(1)
                || !valid_token
            {
                self.poisoned = true;
                return Some(error(
                    id,
                    DriverError::new("POLICY_DENIED", "authentication failed"),
                ));
            }
            self.authenticated = true;
            self.token.fill(0);
            return Some(success(
                id,
                json!({"protocolVersion":1,"name":"e2e-platform-macos-ax","version":env!("CARGO_PKG_VERSION"),"actions":ACTIONS,"keyboard":false,"screenshots":false}),
            ));
        }
        let result = match method {
            "snapshot"
                if keys(params, &["pixels"], &[])
                    && (params.get("pixels").is_none() || params["pixels"].is_boolean()) =>
            {
                self.provider.snapshot()
            }
            "perform" => parse_perform(params)
                .and_then(|(id, action)| self.provider.perform(id, &action))
                .map(|()| Value::Null),
            "shutdown" if keys(params, &[], &[]) => {
                self.shutdown = true;
                Ok(Value::Null)
            }
            "initialize" => Err(DriverError::new(
                "INVALID_STATE",
                "session is already authenticated",
            )),
            "screenshot" | "keyboard.type" | "keyboard.press" => Err(DriverError::unsupported()),
            _ => Err(DriverError::new(
                "UNSUPPORTED_CAPABILITY",
                "unsupported method or parameters",
            )),
        };
        Some(match result {
            Ok(value) => success(id, value),
            Err(failure) => {
                if failure.code == "ACTION_MAY_HAVE_COMMITTED" {
                    self.poisoned = true;
                }
                error(id, failure)
            }
        })
    }
}

fn success(id: u64, result: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"result":result})
}
fn error(id: u64, failure: DriverError) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":failure.message,"data":{"code":failure.code}}})
}
fn keys(value: &Value, allowed: &[&str], required: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.keys().all(|key| allowed.contains(&key.as_str()))
            && required.iter().all(|key| object.contains_key(*key))
    })
}
fn constant_time_equal(a: &[u8], b: &[u8]) -> bool {
    let mut difference = a.len() ^ b.len();
    for (index, byte) in b.iter().enumerate() {
        difference |= usize::from(a.get(index).copied().unwrap_or(0) ^ byte);
    }
    difference == 0
}
fn parse_perform(params: &Value) -> Result<(&str, Action)> {
    let invalid = || DriverError::new("UNSUPPORTED_CAPABILITY", "invalid action parameters");
    if !keys(params, &["ref", "action"], &["ref", "action"])
        || !keys(&params["ref"], &["id", "revision"], &["id", "revision"])
    {
        return Err(invalid());
    }
    let id = params["ref"]["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 512)
        .ok_or_else(invalid)?;
    if !params["ref"]["revision"]
        .as_str()
        .is_some_and(|value| value.len() <= 512)
    {
        return Err(invalid());
    }
    let raw = &params["action"];
    let kind = raw["kind"].as_str().ok_or_else(invalid)?;
    if kind == "fill" {
        if !keys(
            raw,
            &["kind", "value", "sensitive"],
            &["kind", "value", "sensitive"],
        ) {
            return Err(invalid());
        }
        let value = raw["value"]
            .as_str()
            .filter(|value| value.len() <= MAX_TEXT_BYTES)
            .ok_or_else(invalid)?
            .to_owned();
        let sensitive = raw["sensitive"].as_bool().ok_or_else(invalid)?;
        return Ok((id, Action::Fill { value, sensitive }));
    }
    if !keys(raw, &["kind"], &["kind"]) {
        return Err(invalid());
    }
    let action = match kind {
        "tap" => Action::Tap,
        "clear" => Action::Clear,
        "focus" => Action::Focus,
        "check" => Action::Check,
        "uncheck" => Action::Uncheck,
        _ => return Err(DriverError::unsupported()),
    };
    Ok((id, action))
}
