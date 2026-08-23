use codexhalo_shared::{ModelUsage, TokenUsage};
use serde::{Deserialize, Serialize};

pub const PRICING_VERSION: &str = "2026-08-23";

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelPricing {
    pub input_per_million: f64,
    pub cached_input_per_million: Option<f64>,
    pub output_per_million: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PricingEstimate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    pub unavailable_models: Vec<String>,
    pub version: String,
}

pub fn pricing_for(model: &str) -> Option<ModelPricing> {
    let normalized = model.to_ascii_lowercase();
    let prices = if normalized.starts_with("gpt-5.3-codex") || normalized.starts_with("gpt-5.2-codex") {
        ModelPricing { input_per_million: 1.75, cached_input_per_million: Some(0.175), output_per_million: 14.0 }
    } else if normalized.starts_with("gpt-5.1-codex") || normalized.starts_with("gpt-5-codex") {
        ModelPricing { input_per_million: 1.25, cached_input_per_million: Some(0.125), output_per_million: 10.0 }
    } else {
        return None;
    };
    Some(prices)
}

pub fn estimate(usage: &TokenUsage) -> PricingEstimate {
    let mut total = 0.0;
    let mut unavailable_models = Vec::new();
    for (model, model_usage) in &usage.by_model {
        match pricing_for(model) {
            Some(pricing) => total += model_value(model_usage, pricing),
            None if model_usage.total > 0 => unavailable_models.push(model.clone()),
            None => {}
        }
    }
    PricingEstimate {
        value: unavailable_models.is_empty().then_some(total),
        unavailable_models,
        version: PRICING_VERSION.to_owned(),
    }
}

fn model_value(usage: &ModelUsage, pricing: ModelPricing) -> f64 {
    let cached = usage.cached_input.unwrap_or(0).min(usage.input);
    let uncached = usage.input.saturating_sub(cached);
    let cached_price = pricing.cached_input_per_million.unwrap_or(pricing.input_per_million);
    (uncached as f64 * pricing.input_per_million
        + cached as f64 * cached_price
        + usage.output as f64 * pricing.output_per_million) / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn prices_cached_input_separately() {
        let usage = ModelUsage { input: 1_000_000, cached_input: Some(500_000), output: 100_000, reasoning: None, total: 1_100_000 };
        let price = model_value(&usage, pricing_for("gpt-5.3-codex").unwrap());
        assert!((price - 2.3625).abs() < 0.00001);
    }

    #[test]
    fn unknown_model_makes_estimate_unavailable() {
        let mut by_model = BTreeMap::new();
        by_model.insert("future-codex".to_owned(), ModelUsage { total: 1, ..Default::default() });
        let result = estimate(&TokenUsage { by_model, total: 1, ..Default::default() });
        assert_eq!(result.value, None);
        assert_eq!(result.unavailable_models, vec!["future-codex"]);
    }
}
