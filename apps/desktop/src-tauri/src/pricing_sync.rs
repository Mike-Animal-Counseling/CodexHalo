//! Downloads only a public price catalog. Codex usage, credentials, and model IDs
//! are never sent. The caller applies consent and automatic-sync settings gates.
use std::{fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}, time::Duration};
use chrono::Utc;
use codexhalo_pricing::{catalog_status, install_catalog, record_cache_error, record_refresh, CatalogSource,
    PricingCatalog, PricingCatalogStatus, MAX_CATALOG_BYTES};
use serde::{Deserialize, Serialize};

const CATALOG_URL: &str = "https://raw.githubusercontent.com/Mike-Animal-Counseling/CodexHalo/main/data/pricing.json";
const REFRESH_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES: usize = MAX_CATALOG_BYTES + 4096;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CachedCatalog {
    catalog: PricingCatalog,
    checked_at: i64,
    updated_at: i64,
}

pub struct PricingSync {
    cache_path: PathBuf,
    last_attempt: tokio::sync::Mutex<Option<i64>>,
}

impl PricingSync {
    pub fn new(config_dir: PathBuf) -> Self {
        let cache_path = config_dir.join("pricing-cache.json");
        let mut last_attempt = None;
        if cache_path.exists() {
            match read_cache(&cache_path).and_then(|cached| {
                let now = Utc::now().timestamp_millis();
                if cached.checked_at <= 0 || cached.updated_at <= 0
                    || cached.checked_at > now || cached.updated_at > cached.checked_at {
                    return Err("Saved price catalog has invalid freshness metadata".into());
                }
                install_catalog(cached.catalog, CatalogSource::Cached,
                    Some(cached.checked_at), Some(cached.updated_at))?;
                Ok(cached.checked_at)
            }) {
                Ok(checked_at) => last_attempt = Some(checked_at),
                Err(error) => record_cache_error(error),
            }
        }
        Self { cache_path, last_attempt: tokio::sync::Mutex::new(last_attempt) }
    }

    /// A failed refresh retains bundled or previously verified cached prices.
    pub async fn refresh(&self, force: bool) -> PricingCatalogStatus {
        let mut last_attempt = self.last_attempt.lock().await;
        let now = Utc::now().timestamp_millis();
        if !force && !refresh_due(*last_attempt, now) { return catalog_status(); }
        *last_attempt = Some(now);
        match download_catalog(CATALOG_URL).await {
            Ok(catalog) => {
                let updated_at = Utc::now().timestamp_millis();
                let checked_at = updated_at;
                match install_catalog(catalog.clone(), CatalogSource::Remote,
                    Some(checked_at), Some(updated_at)) {
                    Ok(()) => {
                        let cached = CachedCatalog { catalog, checked_at, updated_at };
                        if write_cache(&self.cache_path, &cached).is_err() {
                            record_refresh(checked_at, Some("Prices updated, but the local cache could not be saved".into()));
                        }
                    }
                    Err(error) => record_refresh(updated_at, Some(error)),
                }
            }
            Err(error) => record_refresh(Utc::now().timestamp_millis(), Some(error)),
        }
        catalog_status()
    }
}

fn refresh_due(last_attempt: Option<i64>, now: i64) -> bool {
    last_attempt.is_none_or(|last| now < last || now.saturating_sub(last) >= REFRESH_INTERVAL_MS)
}

async fn download_catalog(url: &str) -> Result<PricingCatalog, String> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .user_agent("CodexHalo/1 public-pricing-catalog")
        .build().map_err(|_| "Could not create the price catalog connection".to_owned())?;
    let mut response = client.get(url).header(reqwest::header::ACCEPT, "application/json")
        .send().await.map_err(|_| "Price refresh unavailable; using the available local catalog".to_owned())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("The remote price catalog is not published yet; using the available local catalog".into());
    }
    if !response.status().is_success() {
        return Err(format!("Price refresh returned HTTP {}; using the available local catalog", response.status().as_u16()));
    }
    if response.content_length().is_some_and(|length| length > MAX_CATALOG_BYTES as u64) {
        return Err("Price catalog exceeds the download size limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await
        .map_err(|_| "Price catalog download was interrupted; using local prices".to_owned())? {
        if bytes.len().saturating_add(chunk.len()) > MAX_CATALOG_BYTES {
            return Err("Price catalog exceeds the download size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    PricingCatalog::from_json(&bytes)
}

fn read_cache(path: &Path) -> Result<CachedCatalog, String> {
    let file = File::open(path).map_err(|_| "Saved price catalog could not be opened".to_owned())?;
    let mut bytes = Vec::new();
    file.take(MAX_CACHE_BYTES as u64 + 1).read_to_end(&mut bytes)
        .map_err(|_| "Saved price catalog could not be read".to_owned())?;
    if bytes.len() > MAX_CACHE_BYTES { return Err("Saved price catalog exceeds the size limit".into()); }
    let cached: CachedCatalog = serde_json::from_slice(&bytes)
        .map_err(|_| "Saved price catalog is invalid; using bundled prices".to_owned())?;
    cached.catalog.validate()?;
    Ok(cached)
}

fn write_cache(path: &Path, cached: &CachedCatalog) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Invalid price cache location".to_owned())?;
    fs::create_dir_all(parent).map_err(|_| "Could not create the price cache directory".to_owned())?;
    let bytes = serde_json::to_vec(cached).map_err(|_| "Could not encode the price cache".to_owned())?;
    if bytes.len() > MAX_CACHE_BYTES { return Err("Price cache exceeds size limit".into()); }
    let temporary = path.with_extension("json.tmp");
    let mut file = File::create(&temporary).map_err(|_| "Could not write the price cache".to_owned())?;
    file.write_all(&bytes).and_then(|_| file.sync_all())
        .map_err(|_| "Could not save the price cache".to_owned())?;
    drop(file);
    fs::rename(&temporary, path).map_err(|_| "Could not replace the price cache".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_is_due_daily_and_recovers_from_clock_changes() {
        assert!(refresh_due(None, 100));
        assert!(!refresh_due(Some(100), 101));
        assert!(!refresh_due(Some(100), 100 + REFRESH_INTERVAL_MS - 1));
        assert!(refresh_due(Some(100), 100 + REFRESH_INTERVAL_MS));
        assert!(refresh_due(Some(200), 100));
    }

    #[test]
    fn cache_round_trip_keeps_verified_rates_and_timestamps() {
        let directory = std::env::temp_dir().join(format!("codexhalo-pricing-{}-{}", std::process::id(), Utc::now().timestamp_nanos_opt().unwrap()));
        let path = directory.join("pricing-cache.json");
        let cached = CachedCatalog { catalog: codexhalo_pricing::bundled_catalog(), checked_at: 123, updated_at: 120 };
        write_cache(&path, &cached).unwrap();
        write_cache(&path, &cached).unwrap();
        let restored = read_cache(&path).unwrap();
        assert_eq!(restored.catalog, cached.catalog);
        assert_eq!(restored.checked_at, 123);
        assert_eq!(restored.updated_at, 120);
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn corrupt_cache_cannot_supply_prices() {
        let path = std::env::temp_dir().join(format!("codexhalo-bad-pricing-{}-{}.json", std::process::id(), Utc::now().timestamp_nanos_opt().unwrap()));
        fs::write(&path, br#"{"catalog":{"schemaVersion":999}}"#).unwrap();
        assert!(read_cache(&path).is_err());
        fs::remove_file(path).unwrap();
    }
}
