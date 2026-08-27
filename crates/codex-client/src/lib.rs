use std::{
    env,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
};
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

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

impl AppServer {
    async fn connect() -> Result<Self, CodexClientError> {
        let executable = executable()?;
        let mut command = Command::new(executable);
        command.args(["app-server", "--listen", "stdio://"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        let mut child = command.spawn()
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
    #[cfg(windows)]
    {
        let search_path = env::var_os("PATH");
        let local_app_data = env::var_os("LOCALAPPDATA").map(PathBuf::from);
        let user_profile = env::var_os("USERPROFILE").map(PathBuf::from);
        return find_windows_executable(
            search_path.as_deref(),
            local_app_data.as_deref(),
            user_profile.as_deref(),
        )
        .ok_or(CodexClientError::NotFound);
    }
    #[cfg(not(windows))]
    {
        which::which("codex").map_err(|_| CodexClientError::NotFound)
    }
}

#[cfg(windows)]
fn find_windows_executable(
    search_path: Option<&OsStr>,
    local_app_data: Option<&Path>,
    user_profile: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(search_path) = search_path {
        for directory in env::split_paths(search_path) {
            let native = directory.join("codex.exe");
            if native.is_file() {
                return Some(native);
            }
            let has_launcher = ["codex.cmd", "codex.ps1", "codex"]
                .into_iter()
                .any(|name| directory.join(name).is_file());
            if has_launcher {
                if let Some(native) = npm_native_executable(&directory) {
                    return Some(native);
                }
            }
        }
    }

    if let Some(local_app_data) = local_app_data {
        let bin = local_app_data.join("OpenAI").join("Codex").join("bin");
        if let Some(native) = newest_child_executable(&bin, "codex.exe") {
            return Some(native);
        }
    }

    if let Some(user_profile) = user_profile {
        for vscode_root in [".vscode", ".vscode-insiders"] {
            let extensions = user_profile.join(vscode_root).join("extensions");
            let mut candidates = direct_children(&extensions)
                .into_iter()
                .filter(|path| {
                    path.file_name()
                        .and_then(OsStr::to_str)
                        .is_some_and(|name| name.to_ascii_lowercase().starts_with("openai.chatgpt-"))
                })
                .map(|path| {
                    path.join("bin")
                        .join(windows_target_directory())
                        .join("codex.exe")
                })
                .filter(|path| path.is_file())
                .collect::<Vec<_>>();
            candidates.sort();
            if let Some(native) = candidates.pop() {
                return Some(native);
            }
        }
    }
    None
}

#[cfg(windows)]
fn npm_native_executable(launcher_directory: &Path) -> Option<PathBuf> {
    let platform_package = if cfg!(target_arch = "aarch64") {
        "codex-win32-arm64"
    } else {
        "codex-win32-x64"
    };
    let triple = windows_target_directory();
    let package_root = launcher_directory
        .join("node_modules")
        .join("@openai")
        .join("codex");
    let vendor_roots = [
        package_root
            .join("node_modules")
            .join("@openai")
            .join(platform_package)
            .join("vendor"),
        launcher_directory
            .join("node_modules")
            .join("@openai")
            .join(platform_package)
            .join("vendor"),
        package_root.join("vendor"),
    ];
    for vendor in vendor_roots {
        for relative in [
            PathBuf::from(triple).join("bin").join("codex.exe"),
            PathBuf::from(triple).join("codex").join("codex.exe"),
        ] {
            let candidate = vendor.join(relative);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn windows_target_directory() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64-pc-windows-msvc"
    } else {
        "x86_64-pc-windows-msvc"
    }
}

#[cfg(windows)]
fn direct_children(directory: &Path) -> Vec<PathBuf> {
    fs::read_dir(directory)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect()
}

#[cfg(windows)]
fn newest_child_executable(directory: &Path, executable_name: &str) -> Option<PathBuf> {
    let direct = directory.join(executable_name);
    if direct.is_file() {
        return Some(direct);
    }
    let mut candidates = direct_children(directory)
        .into_iter()
        .map(|child| child.join(executable_name))
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.pop()
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
    let mut command = StdCommand::new(executable()?);
    command.arg("login").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn()
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

    #[cfg(windows)]
    #[test]
    fn resolves_native_binary_behind_official_npm_launcher() {
        let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        fs::write(temp.path().join("codex.cmd"), "@echo off").unwrap();
        let native = temp
            .path()
            .join("node_modules/@openai/codex/node_modules/@openai")
            .join(if cfg!(target_arch = "aarch64") {
                "codex-win32-arm64"
            } else {
                "codex-win32-x64"
            })
            .join("vendor")
            .join(windows_target_directory())
            .join("bin/codex.exe");
        fs::create_dir_all(native.parent().unwrap()).unwrap();
        fs::write(&native, "synthetic").unwrap();
        let search_path = env::join_paths([temp.path()]).unwrap();

        assert_eq!(
            find_windows_executable(Some(&search_path), None, None),
            Some(native)
        );
    }

    #[cfg(windows)]
    #[test]
    fn resolves_official_desktop_bundle_without_path_cli() {
        let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        let native = temp.path().join("OpenAI/Codex/bin/26.1/codex.exe");
        fs::create_dir_all(native.parent().unwrap()).unwrap();
        fs::write(&native, "synthetic").unwrap();

        assert_eq!(
            find_windows_executable(None, Some(temp.path()), None),
            Some(native)
        );
    }
}
