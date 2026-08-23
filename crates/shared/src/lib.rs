use std::collections::BTreeMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitWindow {
    pub id: String,
    pub duration_minutes: u64,
    pub used_percent: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<i64>,
}

impl RateLimitWindow {
    pub fn remaining_percent(&self) -> u8 {
        100_u8.saturating_sub(self.used_percent.min(100))
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub input: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input: Option<u64>,
    pub output: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<u64>,
    pub total: u64,
}

impl ModelUsage {
    pub fn add_assign(&mut self, other: &Self) {
        self.input += other.input;
        self.cached_input = Some(self.cached_input.unwrap_or(0) + other.cached_input.unwrap_or(0));
        self.output += other.output;
        self.reasoning = Some(self.reasoning.unwrap_or(0) + other.reasoning.unwrap_or(0));
        self.total += other.total;
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input: Option<u64>,
    pub output: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<u64>,
    pub total: u64,
    pub by_model: BTreeMap<String, ModelUsage>,
}

impl TokenUsage {
    pub fn push(&mut self, model: &str, usage: ModelUsage) {
        self.input += usage.input;
        self.cached_input = Some(self.cached_input.unwrap_or(0) + usage.cached_input.unwrap_or(0));
        self.output += usage.output;
        self.reasoning = Some(self.reasoning.unwrap_or(0) + usage.reasoning.unwrap_or(0));
        self.total += usage.total;
        self.by_model.entry(model.to_owned()).or_default().add_assign(&usage);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remaining_is_clamped() {
        let window = RateLimitWindow { used_percent: 140, ..Default::default() };
        assert_eq!(window.remaining_percent(), 0);
    }

    #[test]
    fn aggregation_preserves_breakdown() {
        let mut total = TokenUsage::default();
        total.push("gpt-test", ModelUsage { input: 10, cached_input: Some(4), output: 3, reasoning: Some(1), total: 14 });
        assert_eq!(total.total, 14);
        assert_eq!(total.by_model["gpt-test"].cached_input, Some(4));
    }
}
