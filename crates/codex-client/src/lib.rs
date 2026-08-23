use std::{path::PathBuf, process::{Command as StdCommand, Stdio}};
use codexhalo_shared::RateLimitWindow;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, ChildStdout, Command}, time::{timeout, Duration}};

#[derive(Debug, Error)]
pub enum CodexClientError {
    #[error("Codex CLI was not found. Install Codex and sign in first.")]
    NotFound,
    #[error("Could not start Codex: {0}")]
    Spawn(String),
    #[error("Codex app-server closed unexpectedly")]
    Closed,
    #[error("Codex app-server timed out")]
    Timeout,
    #[error("Codex app-server returned an error: {0}")]
    Protocol(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum QuotaRead {
    Authenticated(Vec<RateLimitWindow>),
    Unauthenticated,
}

struct AppServer {
    _child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next_id: u64,
}

impl AppServer {
    async fn connect() -> Result<Self, CodexClientError> {
        let executable = executable()?;
        let mut child = Command::new(executable)
            .args(["app-server", "--listen", "stdio://"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .kill_on_drop(true).spawn()
            .map_err(|error| CodexClientError::Spawn(error.to_string()))?;
        let input = child.stdin.take().ok_or_else(|| CodexClientError::Spawn("stdin unavailable".into()))?;
        let output = child.stdout.take().ok_or_else(|| CodexClientError::Spawn("stdout unavailable".into()))?;
        let mut server = Self { _child: child, input, output: BufReader::new(output), next_id: 1 };
        server.rpc("initialize", json!({
            "clientInfo": { "name": "codexhalo", "title": "CodexHalo", "version": env!("CARGO_PKG_VERSION") },
            "capabilities": { "experimentalApi": false }
        })).await?;
        server.notify("initialized", None).await?;
        Ok(server)
    }

    async fn notify(&mut self, method: &str, params: Option<Value>) -> Result<(), CodexClientError> {
        let mut message = json!({ "method": method });
        if let Some(params) = params { message["params"] = params; }
        self.write(&message).await
    }

    async fn rpc(&mut self, method: &str, params: Value) -> Result<Value, CodexClientError> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(&json!({ "id": id, "method": method, "params": params })).await?;
        loop {
            let mut line = String::new();
            let bytes = timeout(Duration::from_secs(15), self.output.read_line(&mut line))
                .await.map_err(|_| CodexClientError::Timeout)?
                .map_err(|error| CodexClientError::Protocol(error.to_string()))?;
            if bytes == 0 { return Err(CodexClientError::Closed); }
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            if value.get("id").and_then(Value::as_u64) != Some(id) { continue; }
            if let Some(error) = value.get("error") {
                return Err(CodexClientError::Protocol(error.to_string()));
            }
            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    async fn write(&mut self, value: &Value) -> Result<(), CodexClientError> {
        let mut message = serde_json::to_vec(value).map_err(|error| CodexClientError::Protocol(error.to_string()))?;
        message.push(b'\n');
        self.input.write_all(&message).await.map_err(|error| CodexClientError::Protocol(error.to_string()))?;
        self.input.flush().await.map_err(|error| CodexClientError::Protocol(error.to_string()))
    }
}

fn executable() -> Result<PathBuf, CodexClientError> {
    which::which("codex").map_err(|_| CodexClientError::NotFound)
}

pub async fn read_quota() -> Result<QuotaRead, CodexClientError> {
    let mut server = AppServer::connect().await?;
    let account = server.rpc("account/read", json!({ "refreshToken": false })).await?;
    if account.get("account").is_none() || account.get("account") == Some(&Value::Null) {
        return Ok(QuotaRead::Unauthenticated);
    }
    let response = server.rpc("account/rateLimits/read", Value::Null).await?;
    Ok(QuotaRead::Authenticated(normalize_windows(&response)))
}

pub fn launch_login() -> Result<(), CodexClientError> {
    StdCommand::new(executable()?).arg("login")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
        .map_err(|error| CodexClientError::Spawn(error.to_string()))?;
    Ok(())
}

fn normalize_windows(response: &Value) -> Vec<RateLimitWindow> {
    let snapshot = response.pointer("/rateLimitsByLimitId/codex")
        .or_else(|| response.get("rateLimits"))
        .unwrap_or(&Value::Null);
    ["primary", "secondary"].into_iter().filter_map(|id| {
        let value = snapshot.get(id)?;
        let duration = value.get("windowDurationMins").and_then(Value::as_u64)?;
        Some(RateLimitWindow {
            id: format!("{}-{duration}", snapshot.get("limitId").and_then(Value::as_str).unwrap_or(id)),
            duration_minutes: duration,
            used_percent: value.get("usedPercent").and_then(Value::as_u64).unwrap_or(0).min(100) as u8,
            resets_at: value.get("resetsAt").and_then(Value::as_i64),
        })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_known_and_future_windows() {
        let source = json!({ "rateLimits": {
            "limitId": "codex",
            "primary": { "usedPercent": 28, "windowDurationMins": 300, "resetsAt": 10 },
            "secondary": { "usedPercent": 57, "windowDurationMins": 10080, "resetsAt": 20 }
        }});
        let windows = normalize_windows(&source);
        assert_eq!(windows[0].remaining_percent(), 72);
        assert_eq!(windows[1].duration_minutes, 10080);
    }
}
