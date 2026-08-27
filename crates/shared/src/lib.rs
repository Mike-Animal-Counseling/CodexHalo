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
        self.cached_input = sum_optional(self.cached_input, other.cached_input);
        self.output += other.output;
        self.reasoning = sum_optional(self.reasoning, other.reasoning);
        self.total += other.total;
    }
}

fn sum_optional(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (None, None) => None,
        (left, right) => Some(left.unwrap_or(0) + right.unwrap_or(0)),
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
        self.cached_input = sum_optional(self.cached_input, usage.cached_input);
        self.output += usage.output;
        self.reasoning = sum_optional(self.reasoning, usage.reasoning);
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

    #[test]
    fn aggregation_preserves_missing_optional_counters() {
        let mut total = TokenUsage::default();
        total.push("legacy", ModelUsage { input: 10, output: 2, total: 12, ..Default::default() });
        assert_eq!(total.cached_input, None);
        assert_eq!(total.reasoning, None);
        assert_eq!(total.by_model["legacy"].cached_input, None);
        assert_eq!(total.by_model["legacy"].reasoning, None);
    }
}
