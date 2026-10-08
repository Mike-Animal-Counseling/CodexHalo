use std::{env, path::PathBuf, sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}}, time::{Instant, Duration}};
use chrono::{Local, NaiveDate, Utc};
use codexhalo_codex_client::{read_quota, CodexClientError, QuotaRead};
use codexhalo_pricing::{estimate, estimate_with_snapshot, catalog_snapshot, CatalogSnapshot, PricingEstimate};
use codexhalo_shared::{RateLimitWindow, TokenUsage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistoryDay {
    pub date: String,
    pub tokens: TokenUsage,
    pub pricing: PricingEstimate,
}

#[derive(Clone)]
pub struct ReadPermit {
    generation: Arc<AtomicU64>,
    captured: u64,
}

impl ReadPermit {
    pub fn new(generation: Arc<AtomicU64>, captured: u64) -> Self { Self { generation, captured } }
    pub fn check(&self) -> Result<(), String> {
        (self.generation.load(Ordering::Acquire) == self.captured)
            .then_some(()).ok_or_else(|| "Codex access was revoked".to_owned())
    }
}

struct HistoryCache {
    date: NaiveDate,
    loaded: Instant,
    days: Vec<codexhalo_token_usage::DailyTokenUsage>,
}
static HISTORY: Mutex<Option<HistoryCache>> = Mutex::new(None);

pub fn clear_history_cache() {
    if let Ok(mut cache) = HISTORY.try_lock() { *cache = None; }
}

fn history(home: &std::path::Path, today: NaiveDate, tokens: &TokenUsage, snapshot: &CatalogSnapshot, permit: &ReadPermit) -> Result<Vec<UsageHistoryDay>, String> {
    permit.check()?;
    let mut cache = HISTORY.lock().map_err(|error| error.to_string())?;
    if cache.as_ref().is_none_or(|cached| cached.date != today || cached.loaded.elapsed() > Duration::from_secs(300)) {
        let days = codexhalo_token_usage::aggregate_codex_home_history_checked(home, today, &|| permit.check())?;
        permit.check()?;
        *cache = Some(HistoryCache { date: today, loaded: Instant::now(), days });
    }
    Ok(cache.as_ref().unwrap().days.iter().map(|day| {
        let tokens = if day.date == today.to_string() { tokens.clone() } else { day.tokens.clone() };
        UsageHistoryDay { date: day.date.clone(), pricing: estimate_with_snapshot(&tokens, snapshot), tokens }
    }).collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStatus {
    pub connection: ConnectionState,
    pub windows: Vec<RateLimitWindow>,
    pub tokens: TokenUsage,
    pub pricing: PricingEstimate,
    #[serde(default)]
    pub history: Vec<UsageHistoryDay>,
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
            history: Vec::new(),
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
        history: Vec::new(),
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

pub async fn refresh(enabled: bool, permit: ReadPermit) -> Result<DashboardStatus, String> {
    // This gate intentionally precedes path discovery, process launch, and every Codex read.
    require_enabled(enabled)?;
    permit.check()?;
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
                history: Vec::new(),
                updated_at: None,
                message: Some("Sign in through Codex to read quota.".into()),
            });
        }
        QuotaRead::Authenticated(windows) => windows,
    };
    permit.check()?;
    let home = codex_home()?;
    let snapshot = catalog_snapshot();
    let worker_snapshot = snapshot.clone();
    let (tokens, history) = tauri::async_runtime::spawn_blocking(move || {
        permit.check()?;
        let today = Local::now().date_naive();
        let tokens = codexhalo_token_usage::aggregate_codex_home_day_checked(&home, today, &|| permit.check())?;
        let history = history(&home, today, &tokens, &worker_snapshot, &permit)?;
        Ok::<_, String>((tokens, history))
    }).await.map_err(|error| error.to_string())??;
    let pricing = estimate_with_snapshot(&tokens, &snapshot);
    Ok(DashboardStatus {
        connection: ConnectionState::Ready,
        windows,
        tokens,
        pricing,
        history,
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
    fn revoked_permit_stops_later_read_stages_even_after_reenable() {
        let generation = Arc::new(AtomicU64::new(0));
        let permit = ReadPermit::new(generation.clone(), 0);
        assert!(permit.check().is_ok());
        generation.fetch_add(1, Ordering::AcqRel);
        assert!(permit.check().is_err());
        generation.fetch_add(1, Ordering::AcqRel);
        assert!(permit.check().is_err());
        assert!(ReadPermit::new(generation, 2).check().is_ok());
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
