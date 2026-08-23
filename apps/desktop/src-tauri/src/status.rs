use std::{env, path::PathBuf};
use chrono::Utc;
use codexhalo_codex_client::{read_quota, QuotaRead};
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
pub enum ConnectionState { Disabled, Connecting, Ready, Unauthenticated, Offline, Error }

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

fn sessions_dir() -> Result<PathBuf, String> {
    let root = env::var_os("CODEX_HOME").map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|path| path.join(".codex")))
        .ok_or("Could not determine the Codex data directory")?;
    Ok(root.join("sessions"))
}

pub async fn refresh(enabled: bool) -> Result<DashboardStatus, String> {
    // This gate intentionally precedes path discovery, process launch, and every Codex read.
    require_enabled(enabled)?;
    let quota = read_quota().await.map_err(|error| error.to_string())?;
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
    let tokens = codexhalo_token_usage::aggregate_today(&sessions_dir()?)?;
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
}
