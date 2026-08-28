use codexhalo_shared::{ModelUsage, TokenUsage};
use serde::{Deserialize, Serialize};

pub const PRICING_VERSION: &str = "2026-08-27";

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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub estimated_models: Vec<String>,
    pub version: String,
}

pub fn pricing_for(model: &str) -> Option<ModelPricing> {
    let normalized = model.to_ascii_lowercase();
    let prices = if normalized.starts_with("gpt-5.6-luna") {
        ModelPricing { input_per_million: 0.20, cached_input_per_million: Some(0.02), output_per_million: 1.20 }
    } else if normalized.starts_with("gpt-5.6-terra") {
        ModelPricing { input_per_million: 2.0, cached_input_per_million: Some(0.20), output_per_million: 12.0 }
    } else if normalized == "gpt-5.6" || normalized.starts_with("gpt-5.6-sol") {
        ModelPricing { input_per_million: 4.0, cached_input_per_million: Some(0.40), output_per_million: 20.0 }
    } else if normalized.starts_with("gpt-5.5-pro") {
        ModelPricing { input_per_million: 30.0, cached_input_per_million: None, output_per_million: 180.0 }
    } else if normalized.starts_with("gpt-5.5") {
        ModelPricing { input_per_million: 5.0, cached_input_per_million: Some(0.50), output_per_million: 30.0 }
    } else if normalized.starts_with("gpt-5.4-pro") {
        ModelPricing { input_per_million: 30.0, cached_input_per_million: None, output_per_million: 180.0 }
    } else if normalized.starts_with("gpt-5.4-mini") {
        ModelPricing { input_per_million: 0.75, cached_input_per_million: Some(0.075), output_per_million: 4.50 }
    } else if normalized.starts_with("gpt-5.4-nano") {
        ModelPricing { input_per_million: 0.20, cached_input_per_million: Some(0.02), output_per_million: 1.25 }
    } else if normalized.starts_with("gpt-5.4") {
        ModelPricing { input_per_million: 2.50, cached_input_per_million: Some(0.25), output_per_million: 15.0 }
    } else if normalized.starts_with("gpt-5.3-codex") || normalized.starts_with("gpt-5.3")
        || normalized.starts_with("gpt-5.2-codex") || normalized.starts_with("gpt-5.2") {
        ModelPricing { input_per_million: 1.75, cached_input_per_million: Some(0.175), output_per_million: 14.0 }
    } else if normalized.starts_with("gpt-5.1-codex-mini") || normalized.starts_with("gpt-5-mini") {
        ModelPricing { input_per_million: 0.25, cached_input_per_million: Some(0.025), output_per_million: 2.0 }
    } else if normalized.starts_with("gpt-5.1-codex") || normalized.starts_with("gpt-5-codex") {
        ModelPricing { input_per_million: 1.25, cached_input_per_million: Some(0.125), output_per_million: 10.0 }
    } else if normalized.starts_with("codex-mini-latest") {
        ModelPricing { input_per_million: 1.50, cached_input_per_million: Some(0.375), output_per_million: 6.0 }
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
            None if model_usage.total > 0 => {
                unavailable_models.push(model.clone());
            }
            None => {}
        }
    }
    PricingEstimate {
        value: Some(total),
        unavailable_models,
        estimated_models: Vec::new(),
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
    fn unknown_model_preserves_identity_and_is_excluded_from_the_value() {
        let mut by_model = BTreeMap::new();
        by_model.insert("gpt-5.7-example".to_owned(), ModelUsage { input: 500_000, total: 500_000, ..Default::default() });
        let result = estimate(&TokenUsage { input: 500_000, by_model, total: 500_000, ..Default::default() });
        assert_eq!(result.value, Some(0.0));
        assert_eq!(result.unavailable_models, vec!["gpt-5.7-example"]);
        assert!(result.estimated_models.is_empty());
    }

    #[test]
    fn mixed_pricing_returns_only_the_published_price_subtotal() {
        let mut by_model = BTreeMap::new();
        by_model.insert("gpt-5.6-sol".to_owned(), ModelUsage { input: 1_000_000, total: 1_000_000, ..Default::default() });
        by_model.insert("codex-auto-review".to_owned(), ModelUsage { input: 500_000, total: 500_000, ..Default::default() });
        let result = estimate(&TokenUsage { input: 1_500_000, by_model, total: 1_500_000, ..Default::default() });
        assert_eq!(result.value, Some(4.0));
        assert_eq!(result.unavailable_models, vec!["codex-auto-review"]);
    }

    #[test]
    fn zero_usage_has_a_zero_value_instead_of_being_unavailable() {
        let result = estimate(&TokenUsage::default());
        assert_eq!(result.value, Some(0.0));
        assert!(result.unavailable_models.is_empty());
    }

    #[test]
    fn supports_current_and_legacy_codex_model_rates() {
        let sol = pricing_for("gpt-5.6-sol").unwrap();
        assert_eq!(sol.input_per_million, 4.0);
        assert_eq!(sol.cached_input_per_million, Some(0.4));
        assert_eq!(sol.output_per_million, 20.0);
        assert_eq!(pricing_for("gpt-5.6-terra").unwrap().input_per_million, 2.0);
        assert_eq!(pricing_for("gpt-5.6-luna").unwrap().cached_input_per_million, Some(0.02));
        assert_eq!(pricing_for("gpt-5.4-mini").unwrap().output_per_million, 4.5);
        assert_eq!(pricing_for("gpt-5.1-codex-mini").unwrap().input_per_million, 0.25);
        assert_eq!(pricing_for("codex-mini-latest").unwrap().cached_input_per_million, Some(0.375));
    }
}
