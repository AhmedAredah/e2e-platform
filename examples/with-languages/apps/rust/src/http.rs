//! A bounded loopback demo transport, not a production HTTP implementation.
use std::{io::{Read, Write}, net::{TcpListener, TcpStream}, time::Duration};
use crate::domain::Calculator;

pub struct CalculatorServer<'a> { calculator: &'a Calculator }
impl<'a> CalculatorServer<'a> {
    pub fn new(calculator: &'a Calculator) -> Self { Self { calculator } }
    pub fn serve(&self) -> Result<(), String> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
        println!("E2E_LANGUAGE_READY {{\"port\":{}}}", listener.local_addr().map_err(|error| error.to_string())?.port());
        std::io::stdout().flush().map_err(|error| error.to_string())?;
        for client in listener.incoming() {
            let mut client = client.map_err(|error| error.to_string())?;
            // A malformed or stalled client cannot keep the demo waiting indefinitely.
            client.set_read_timeout(Some(Duration::from_secs(2))).map_err(|error| error.to_string())?;
            client.set_write_timeout(Some(Duration::from_secs(2))).map_err(|error| error.to_string())?;
            let _ = self.respond(&mut client);
        }
        Ok(())
    }
    fn respond(&self, stream: &mut TcpStream) -> std::io::Result<()> {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            let count = stream.read(&mut buffer)?;
            if count == 0 { return Ok(()); }
            bytes.extend_from_slice(&buffer[..count]);
            if bytes.len() > 8192 { return Ok(()); }
        }
        let request = String::from_utf8_lossy(&bytes);
        let mut words = request.lines().next().unwrap_or("").split_whitespace();
        let method = words.next().unwrap_or("");
        let target = words.next().unwrap_or("");
        let (status, body) = self.route(method, target);
        write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }
    fn route(&self, method: &str, target: &str) -> (&'static str, String) {
        if method != "GET" { return ("405 Method Not Allowed", "{\"error\":\"method not allowed\"}".into()); }
        if target == "/health" { return ("200 OK", "{\"ok\":true}".into()); }
        let Some(query) = target.strip_prefix("/sum?") else { return ("404 Not Found", "{\"error\":\"not found\"}".into()); };
        let Some(pairs) = query.split('&').map(|part| part.split_once('=')).collect::<Option<Vec<_>>>() else {
            return ("400 Bad Request", "{\"error\":\"invalid operands\"}".into());
        };
        let a = pairs.iter().filter(|(key, _)| *key == "a").collect::<Vec<_>>();
        let b = pairs.iter().filter(|(key, _)| *key == "b").collect::<Vec<_>>();
        if pairs.len() == 2 && a.len() == 1 && b.len() == 1 {
            if let Ok(result) = self.calculator.calculate(a[0].1, b[0].1) { return ("200 OK", result); }
        }
        ("400 Bad Request", "{\"error\":\"invalid operands\"}".into())
    }
}
