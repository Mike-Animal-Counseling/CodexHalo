use std::{collections::BTreeSet, sync::{OnceLock, RwLock}};
use chrono::NaiveDate;
use codexhalo_shared::{ModelUsage, TokenUsage};
use serde::{Deserialize, Serialize};

pub const PRICING_VERSION: &str = "2026-10-05";
pub const OFFICIAL_PRICING_URL: &str = "https://developers.openai.com/api/docs/pricing";
pub const MAX_CATALOG_BYTES: usize = 256 * 1024;
const MAX_RATE: f64 = 100_000.0;
const BUNDLED_CATALOG: &str = include_str!("../../../data/pricing.json");

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelPricing {
    pub input_per_million: f64,
    pub cached_input_per_million: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_per_million: Option<f64>,
    pub output_per_million: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LongContextPricing {
    pub input_threshold: u64,
    pub rates: ModelPricing,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogModel {
    pub id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    pub rates: ModelPricing,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_context: Option<LongContextPricing>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PricingCatalog {
    pub schema_version: u32,
    pub version: String,
    pub published_at: String,
    pub currency: String,
    pub pricing_mode: String,
    pub source_url: String,
    pub models: Vec<CatalogModel>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CatalogSource { Bundled, Cached, Remote }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PricingCatalogStatus {
    pub version: String,
    pub published_at: String,
    pub source_url: String,
    pub catalog_source: CatalogSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CatalogSnapshot {
    pub catalog: PricingCatalog,
    pub status: PricingCatalogStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelEstimate {
    pub model: String,
    pub usage: ModelUsage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rates: Option<ModelPricing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub long_context: Option<LongContextPricing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_input_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_value: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PricingEstimate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    pub unavailable_models: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub estimated_models: Vec<String>,
    pub version: String,
    pub catalog_source: CatalogSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_error: Option<String>,
    pub incomplete: bool,
    pub breakdown: Vec<ModelEstimate>,
    pub assumptions: Vec<String>,
}

impl PricingCatalog {
    pub fn from_json(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_CATALOG_BYTES {
            return Err("Price catalog exceeds the download size limit".into());
        }
        let catalog: Self = serde_json::from_slice(bytes)
            .map_err(|_| "Price catalog is not valid schema v1 JSON".to_owned())?;
        catalog.validate()?;
        Ok(catalog)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.currency != "USD" || self.pricing_mode != "standard" {
            return Err("Unsupported price catalog schema, currency, or pricing mode".into());
        }
        if self.version.is_empty() || self.version.len() > 64
            || !self.version.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_')) {
            return Err("Invalid price catalog version".into());
        }
        let date = NaiveDate::parse_from_str(&self.published_at, "%Y-%m-%d")
            .map_err(|_| "Invalid price catalog publication date".to_owned())?;
        if date.format("%Y-%m-%d").to_string() != self.published_at {
            return Err("Invalid price catalog publication date".into());
        }
        if self.source_url != OFFICIAL_PRICING_URL {
            return Err("Price catalog must cite the official OpenAI pricing page".into());
        }
        if self.models.is_empty() || self.models.len() > 1024 {
            return Err("Invalid price catalog model count".into());
        }
        let mut identities = BTreeSet::new();
        for model in &self.models {
            if model.aliases.len() > 32 { return Err("Too many aliases in price catalog".into()); }
            for id in std::iter::once(&model.id).chain(model.aliases.iter()) {
                if id.is_empty() || id.len() > 128 || !id.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_')) {
                    return Err("Invalid model identity in price catalog".into());
                }
                if !identities.insert(id.to_ascii_lowercase()) {
                    return Err("Duplicate model identity or alias in price catalog".into());
                }
            }
            validate_rates(model.rates)?;
            if let Some(long) = model.long_context {
                if long.input_threshold == 0 || long.input_threshold > 100_000_000 {
                    return Err("Invalid long-context threshold in price catalog".into());
                }
                validate_rates(long.rates)?;
            }
        }
        Ok(())
    }

    pub fn model(&self, id: &str) -> Option<&CatalogModel> {
        self.models.iter().find(|model| model.id.eq_ignore_ascii_case(id)
            || model.aliases.iter().any(|alias| alias.eq_ignore_ascii_case(id)))
    }
}

fn validate_rates(rates: ModelPricing) -> Result<(), String> {
    for rate in [Some(rates.input_per_million), rates.cached_input_per_million,
        rates.cache_write_per_million, Some(rates.output_per_million)].into_iter().flatten() {
        if !rate.is_finite() || !(0.0..=MAX_RATE).contains(&rate) {
            return Err("Invalid token rate in price catalog".into());
        }
    }
    Ok(())
}

pub fn bundled_catalog() -> PricingCatalog {
    PricingCatalog::from_json(BUNDLED_CATALOG.as_bytes()).expect("Bundled pricing catalog must be valid")
}

fn snapshot_for(catalog: PricingCatalog, source: CatalogSource) -> CatalogSnapshot {
    let status = PricingCatalogStatus {
        version: catalog.version.clone(), published_at: catalog.published_at.clone(),
        source_url: catalog.source_url.clone(), catalog_source: source,
        last_checked_at: None, last_updated_at: None, refresh_error: None,
    };
    CatalogSnapshot { catalog, status }
}

fn active() -> &'static RwLock<CatalogSnapshot> {
    static CATALOG: OnceLock<RwLock<CatalogSnapshot>> = OnceLock::new();
    CATALOG.get_or_init(|| RwLock::new(snapshot_for(bundled_catalog(), CatalogSource::Bundled)))
}

pub fn catalog_snapshot() -> CatalogSnapshot {
    active().read().unwrap_or_else(|error| error.into_inner()).clone()
}

pub fn catalog_status() -> PricingCatalogStatus {
    active().read().unwrap_or_else(|error| error.into_inner()).status.clone()
}

pub fn install_catalog(catalog: PricingCatalog, source: CatalogSource,
    checked_at: Option<i64>, updated_at: Option<i64>) -> Result<(), String> {
    catalog.validate()?;
    let mut current = active().write().unwrap_or_else(|error| error.into_inner());
    if catalog.published_at < current.catalog.published_at {
        return Err("Downloaded price catalog is older than the available catalog".into());
    }
    let mut next = snapshot_for(catalog, source);
    next.status.last_checked_at = checked_at;
    next.status.last_updated_at = updated_at;
    *current = next;
    Ok(())
}

pub fn record_cache_error(error: String) {
    active().write().unwrap_or_else(|poisoned| poisoned.into_inner()).status.refresh_error = Some(error);
}

pub fn record_refresh(checked_at: i64, error: Option<String>) {
    let mut current = active().write().unwrap_or_else(|error| error.into_inner());
    current.status.last_checked_at = Some(checked_at);
    current.status.refresh_error = error;
}

pub fn pricing_for(model: &str) -> Option<ModelPricing> {
    active().read().unwrap_or_else(|error| error.into_inner()).catalog.model(model).map(|model| model.rates)
}

pub fn estimate(usage: &TokenUsage) -> PricingEstimate {
    estimate_with_snapshot(usage, &catalog_snapshot())
}

pub fn estimate_with_catalog(usage: &TokenUsage, catalog: &PricingCatalog) -> PricingEstimate {
    estimate_with_snapshot(usage, &snapshot_for(catalog.clone(), CatalogSource::Bundled))
}

pub fn estimate_with_snapshot(usage: &TokenUsage, snapshot: &CatalogSnapshot) -> PricingEstimate {
    let mut total = 0.0;
    let mut unavailable_models = Vec::new();
    let mut estimated_models = Vec::new();
    let mut breakdown = Vec::new();
    let mut has_context_tier = false;
    let mut has_cache_writes = false;
    let mut missing_cache_counts = false;
    let mut known_usage = false;
    for (model, model_usage) in &usage.by_model {
        if model_usage.total == 0 && model_usage.input == 0 && model_usage.output == 0 { continue; }
        match snapshot.catalog.model(model) {
            Some(entry) => {
                known_usage = true;
                let cached = model_usage.cached_input.unwrap_or(0).min(model_usage.input);
                let uncached = model_usage.input.saturating_sub(cached);
                let cached_rate = entry.rates.cached_input_per_million.unwrap_or(entry.rates.input_per_million);
                let input_value = uncached as f64 * entry.rates.input_per_million / 1_000_000.0;
                let cached_input_value = cached as f64 * cached_rate / 1_000_000.0;
                // Reasoning tokens are part of output; adding them again would double count.
                let output_value = model_usage.output as f64 * entry.rates.output_per_million / 1_000_000.0;
                let value = input_value + cached_input_value + output_value;
                total += value;
                has_context_tier |= entry.long_context.is_some();
                has_cache_writes |= entry.rates.cache_write_per_million.is_some();
                missing_cache_counts |= model_usage.cached_input.is_none();
                if entry.long_context.is_some() || entry.rates.cache_write_per_million.is_some()
                    || model_usage.cached_input.is_none() { estimated_models.push(model.clone()); }
                breakdown.push(ModelEstimate { model: model.clone(), usage: model_usage.clone(),
                    rates: Some(entry.rates), long_context: entry.long_context, value: Some(value),
                    input_value: Some(input_value), cached_input_value: Some(cached_input_value),
                    output_value: Some(output_value) });
            }
            None => {
                unavailable_models.push(model.clone());
                breakdown.push(ModelEstimate { model: model.clone(), usage: model_usage.clone(),
                    rates: None, long_context: None, value: None, input_value: None,
                    cached_input_value: None, output_value: None });
            }
        }
    }
    let unclassified = usage.total > 0 && usage.by_model.is_empty();
    if unclassified { unavailable_models.push("unclassified-usage".into()); }
    let mut assumptions = Vec::new();
    if known_usage {
        assumptions.push("Uses Standard service-tier token prices; tool fees and regional surcharges are excluded. This API-equivalent estimate is not an invoice or subscription charge.".into());
    }
    if has_context_tier {
        assumptions.push("Uses Standard short-context rates. Logs do not identify the pricing tier of each request; long-context requests may cost more.".into());
    }
    if has_cache_writes {
        assumptions.push("Logs do not separate cache writes from ordinary input; cache-write premiums are not included.".into());
    }
    if missing_cache_counts {
        assumptions.push("Missing cached-input counts are treated as ordinary input.".into());
    }
    let no_prices = !known_usage && (!unavailable_models.is_empty() || unclassified);
    PricingEstimate {
        value: if no_prices { None } else { Some(total) },
        incomplete: !unavailable_models.is_empty(), unavailable_models, estimated_models,
        version: snapshot.status.version.clone(), catalog_source: snapshot.status.catalog_source,
        last_checked_at: snapshot.status.last_checked_at, last_updated_at: snapshot.status.last_updated_at,
        refresh_error: snapshot.status.refresh_error.clone(), breakdown, assumptions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage(model: &str, input: u64, cached: Option<u64>, output: u64, reasoning: Option<u64>) -> TokenUsage {
        let mut usage = TokenUsage::default();
        usage.push(model, ModelUsage { input, cached_input: cached, output, reasoning, total: input + output });
        usage
    }

    #[test]
    fn prices_cached_input_and_included_reasoning_once() {
        let result = estimate_with_catalog(&usage("gpt-5.3-codex", 1_000_000, Some(500_000), 100_000, Some(50_000)), &bundled_catalog());
        assert!((result.value.unwrap() - 2.3625).abs() < 0.00001);
        assert_eq!(result.breakdown[0].output_value, Some(1.4));
        assert!(!result.incomplete);
    }

    #[test]
    fn uses_new_published_rates_with_explicit_assumptions() {
        let result = estimate_with_catalog(&usage("gpt-6.1-sol", 1_000_000, Some(500_000), 100_000, None), &bundled_catalog());
        assert!((result.value.unwrap() - 2.05).abs() < 0.00001);
        assert_eq!(result.breakdown[0].rates.unwrap().cached_input_per_million, Some(0.1));
        assert_eq!(result.estimated_models, ["gpt-6.1-sol"]);
        assert_eq!(result.assumptions.len(), 3);
    }

    #[test]
    fn unknown_model_is_unavailable_and_cannot_inherit_a_family_price() {
        for model in ["gpt-7-sol", "gpt-6.1-sol-pro", "gpt-5.5-pro-experimental", "gpt-5.3-codex-2099-01-01"] {
            let result = estimate_with_catalog(&usage(model, 500_000, None, 0, None), &bundled_catalog());
            assert_eq!(result.value, None);
            assert_eq!(result.unavailable_models, [model]);
            assert!(result.incomplete);
            assert_eq!(result.breakdown[0].value, None);
        }
    }

    #[test]
    fn mixed_pricing_returns_the_known_subtotal_and_marks_it_incomplete() {
        let mut tokens = usage("gpt-5.6-sol", 1_000_000, Some(0), 0, None);
        tokens.push("codex-auto-review", ModelUsage { input: 500_000, total: 500_000, ..Default::default() });
        let result = estimate_with_catalog(&tokens, &bundled_catalog());
        assert_eq!(result.value, Some(4.0));
        assert_eq!(result.unavailable_models, ["codex-auto-review"]);
        assert!(result.incomplete);
    }

    #[test]
    fn empty_usage_has_zero_value_but_unclassified_usage_does_not() {
        let catalog = bundled_catalog();
        assert_eq!(estimate_with_catalog(&TokenUsage::default(), &catalog).value, Some(0.0));
        assert_eq!(estimate_with_catalog(&TokenUsage { total: 15, ..Default::default() }, &catalog).value, None);
    }

    #[test]
    fn cached_input_is_clamped_and_request_tier_is_not_inferred_from_daily_totals() {
        let result = estimate_with_catalog(&usage("gpt-6-sol", 1_000_000, Some(2_000_000), 0, None), &bundled_catalog());
        assert_eq!(result.value, Some(0.2));
        assert_eq!(result.breakdown[0].input_value, Some(0.0));
        assert_eq!(result.breakdown[0].long_context.unwrap().input_threshold, 272_000);
    }

    #[test]
    fn new_catalog_can_add_future_models_without_code_changes() {
        let mut catalog = bundled_catalog();
        let mut entry = catalog.model("gpt-6-astra").unwrap().clone();
        entry.id = "gpt-future".into();
        entry.aliases = vec!["gpt-future-2026-10-05".into()];
        catalog.models.push(entry);
        let decoded = PricingCatalog::from_json(&serde_json::to_vec(&catalog).unwrap()).unwrap();
        assert_eq!(estimate_with_catalog(&usage("gpt-future-2026-10-05", 1_000_000, Some(0), 0, None), &decoded).value, Some(10.0));
    }

    #[test]
    fn rejects_bad_schema_duplicate_aliases_and_unsafe_rates() {
        let mut catalog = bundled_catalog();
        catalog.schema_version = 2;
        assert!(catalog.validate().is_err());
        catalog.schema_version = 1;
        catalog.models[0].rates.input_per_million = f64::INFINITY;
        assert!(catalog.validate().is_err());
        catalog.models[0].rates.input_per_million = -1.0;
        assert!(catalog.validate().is_err());
        catalog.models[0].rates.input_per_million = 100_001.0;
        assert!(catalog.validate().is_err());
        catalog.models[0].rates.input_per_million = 10.0;
        let conflicting_alias = catalog.models[0].id.to_uppercase();
        catalog.models[1].aliases.push(conflicting_alias);
        assert!(catalog.validate().is_err());
    }

    #[test]
    fn rejects_oversized_payloads_unknown_fields_and_malformed_dates() {
        assert!(PricingCatalog::from_json(&vec![b' '; MAX_CATALOG_BYTES + 1]).is_err());
        let mut value = serde_json::to_value(bundled_catalog()).unwrap();
        value["injected"] = true.into();
        assert!(PricingCatalog::from_json(&serde_json::to_vec(&value).unwrap()).is_err());
        let mut catalog = bundled_catalog();
        catalog.published_at = "2026-02-30".into();
        assert!(catalog.validate().is_err());
    }
}
