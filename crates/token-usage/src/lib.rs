use std::{fs::File, io::{BufRead, BufReader}, path::Path};
use chrono::{DateTime, Local, NaiveDate};
use codexhalo_shared::{ModelUsage, TokenUsage};
use serde_json::Value;
use walkdir::WalkDir;

pub fn aggregate_day(root: &Path, day: NaiveDate) -> Result<TokenUsage, String> {
    if !root.exists() {
        return Ok(TokenUsage::default());
    }
    let mut result = TokenUsage::default();
    for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() || entry.path().extension().and_then(|value| value.to_str()) != Some("jsonl") {
            continue;
        }
        parse_file(entry.path(), day, &mut result)?;
    }
    Ok(result)
}

pub fn aggregate_today(root: &Path) -> Result<TokenUsage, String> {
    aggregate_day(root, Local::now().date_naive())
}

fn parse_file(path: &Path, day: NaiveDate, total: &mut TokenUsage) -> Result<(), String> {
    let file = File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut current_model = "unknown-codex".to_owned();
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { continue };
        let Ok(record) = serde_json::from_str::<Value>(&line) else { continue };
        let payload = record.get("payload").unwrap_or(&record);
        if payload.get("type").and_then(Value::as_str) == Some("turn_context") {
            if let Some(model) = payload.get("model").and_then(Value::as_str) {
                current_model = model.to_owned();
            }
            continue;
        }
        if payload.get("type").and_then(Value::as_str) != Some("token_count") || !on_day(&record, day) {
            continue;
        }
        let Some(usage) = payload.pointer("/info/last_token_usage").or_else(|| payload.get("last_token_usage")) else {
            continue;
        };
        let model = usage.get("model").and_then(Value::as_str).unwrap_or(&current_model);
        total.push(model, parse_usage(usage));
    }
    Ok(())
}

fn on_day(record: &Value, day: NaiveDate) -> bool {
    let Some(timestamp) = record.get("timestamp").and_then(Value::as_str) else { return false };
    DateTime::parse_from_rfc3339(timestamp)
        .map(|value| value.with_timezone(&Local).date_naive() == day)
        .unwrap_or(false)
}

fn token(value: &Value, names: &[&str]) -> u64 {
    names.iter().find_map(|name| value.get(*name).and_then(Value::as_u64)).unwrap_or(0)
}

fn parse_usage(value: &Value) -> ModelUsage {
    let input = token(value, &["input_tokens", "input"]);
    let cached = token(value, &["cached_input_tokens", "cached_input"]);
    let output = token(value, &["output_tokens", "output"]);
    let reasoning = token(value, &["reasoning_output_tokens", "reasoning_tokens", "reasoning"]);
    let total = token(value, &["total_tokens", "total"]).max(input + output);
    ModelUsage {
        input,
        cached_input: Some(cached),
        output,
        reasoning: Some(reasoning),
        total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};

    #[test]
    fn aggregates_delta_events_without_summing_cumulative_totals() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        let path = temp.path().join("session.jsonl");
        let mut file = fs::File::create(path).unwrap();
        writeln!(file, "{}", r#"{"timestamp":"2026-08-23T12:00:00Z","payload":{"type":"turn_context","model":"gpt-5.3-codex"}}"#).unwrap();
        writeln!(file, "{}", r#"{"timestamp":"2026-08-23T12:01:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":999},"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"total_tokens":120}}}}"#).unwrap();
        let usage = aggregate_day(temp.path(), NaiveDate::from_ymd_opt(2026, 8, 23).unwrap()).unwrap();
        assert_eq!(usage.total, 120);
        assert_eq!(usage.by_model["gpt-5.3-codex"].cached_input, Some(40));
    }

    #[test]
    fn missing_root_is_empty_and_safe() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        let usage = aggregate_today(&temp.path().join("never-created")).unwrap();
        assert_eq!(usage, TokenUsage::default());
    }
}
