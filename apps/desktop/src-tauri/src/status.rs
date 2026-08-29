use std::{env, path::PathBuf};
use chrono::Utc;
use codexhalo_codex_client::{read_quota, CodexClientError, QuotaRead};
use codexhalo_pricing::{estimate, PricingEstimate};
use codexhalo_shared::{RateLimitWindow, TokenUsage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStatus {
    pub connection: ConnectionState,
    pub windows: Vec<RateLimitWindow>,
    pub tokens: TokenUsage,
    pub pricing: PricingEstimate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState { Disabled, Connecting, Ready, Disconnected, Unauthenticated, Offline, Error }

impl DashboardStatus {
    pub fn disabled() -> Self {
        Self {
            connection: ConnectionState::Disabled,
            windows: Vec::new(),
            tokens: TokenUsage::default(),
            pricing: estimate(&TokenUsage::default()),
            updated_at: None,
            message: None,
        }
    }
}

fn require_enabled(enabled: bool) -> Result<(), String> {
    enabled.then_some(()).ok_or_else(|| "Codex access is disabled".to_owned())
}

fn codex_home() -> Result<PathBuf, String> {
    env::var_os("CODEX_HOME").map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|path| path.join(".codex")))
        .ok_or_else(|| "Could not determine the Codex data directory".to_owned())
}

fn disconnected_status() -> DashboardStatus {
    DashboardStatus {
        connection: ConnectionState::Disconnected,
        windows: Vec::new(),
        tokens: TokenUsage::default(),
        pricing: estimate(&TokenUsage::default()),
        updated_at: None,
        message: Some("Codex isn't connected yet".into()),
    }
}

fn quota_error_status(error: CodexClientError) -> Result<DashboardStatus, String> {
    match error {
        CodexClientError::NotFound => Ok(disconnected_status()),
        other => Err(other.to_string()),
    }
}

pub async fn refresh(enabled: bool) -> Result<DashboardStatus, String> {
    // This gate intentionally precedes path discovery, process launch, and every Codex read.
    require_enabled(enabled)?;
    let quota = match read_quota().await {
        Ok(quota) => quota,
        Err(error) => return quota_error_status(error),
    };
    let windows = match quota {
        QuotaRead::Unauthenticated => {
            return Ok(DashboardStatus {
                connection: ConnectionState::Unauthenticated,
                windows: Vec::new(),
                tokens: TokenUsage::default(),
                pricing: estimate(&TokenUsage::default()),
                updated_at: None,
                message: Some("Sign in through Codex to read quota.".into()),
            });
        }
        QuotaRead::Authenticated(windows) => windows,
    };
    let tokens = codexhalo_token_usage::aggregate_codex_home_today(&codex_home()?)?;
    let pricing = estimate(&tokens);
    Ok(DashboardStatus {
        connection: ConnectionState::Ready,
        windows,
        tokens,
        pricing,
        updated_at: Some(Utc::now().timestamp_millis()),
        message: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn disabled_gate_runs_before_any_service_access() {
        static ACCESSES: AtomicUsize = AtomicUsize::new(0);
        let result = require_enabled(false).and_then(|_| {
            ACCESSES.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(ACCESSES.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn missing_codex_is_a_normal_disconnected_state() {
        let status = quota_error_status(CodexClientError::NotFound).unwrap();
        assert!(matches!(status.connection, ConnectionState::Disconnected));
        assert!(status.windows.is_empty());
        assert_eq!(status.tokens.total, 0);
    }

    #[test]
    fn operational_quota_failures_remain_errors() {
        let error = quota_error_status(CodexClientError::Timeout).unwrap_err();
        assert!(error.contains("timed out"));
    }
}
