use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap},
    fs::File,
    io::{BufRead, BufReader, Read, Seek},
    path::{Path, PathBuf},
};
use chrono::{DateTime, FixedOffset, Local, NaiveDate};
use codexhalo_shared::{ModelUsage, TokenUsage};
use serde_json::Value;
use walkdir::WalkDir;

const UNCLASSIFIED_MODEL: &str = "unknown-codex";
const MAX_ROLLOUT_BYTES: u64 = 512 * 1024 * 1024;
const ZSTD_MAGIC: [u8; 4] = [0x28, 0xb5, 0x2f, 0xfd];

#[derive(Default)]
struct StreamState {
    current_model: Option<String>,
    previous_total: Option<ModelUsage>,
    previous_legacy: Option<LegacySnapshot>,
}

#[derive(Clone, Default)]
struct TokenRecordOwner {
    thread_id: Option<String>,
    parent_thread_id: Option<String>,
}

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
enum StreamKey {
    Thread(String),
    Anonymous(PathBuf),
}

struct SequencedEvent {
    timestamp: Option<DateTime<FixedOffset>>,
    timestamp_text: Option<String>,
    ordinal: Option<u64>,
    path: PathBuf,
    line_number: usize,
    owner: TokenRecordOwner,
    subagent_history_start_ordinal: Option<u64>,
    kind: EventKind,
}

enum EventKind {
    Model(Option<String>),
    Token(TokenEvent),
}

struct TokenEvent {
    cumulative: Option<ModelUsage>,
    last: Option<ModelUsage>,
    fallback_model: Option<String>,
    fingerprint: String,
}

#[derive(Clone, PartialEq)]
struct LegacySnapshot {
    timestamp: Option<String>,
    model: String,
    usage: ModelUsage,
}

pub fn aggregate_day(root: &Path, day: NaiveDate) -> Result<TokenUsage, String> {
    aggregate_roots_day(&[root.to_path_buf()], day)
}

pub fn aggregate_codex_home_day(codex_home: &Path, day: NaiveDate) -> Result<TokenUsage, String> {
    aggregate_roots_day(
        &[
            codex_home.join("sessions"),
            codex_home.join("archived_sessions"),
        ],
        day,
    )
}

fn aggregate_roots_day(roots: &[PathBuf], day: NaiveDate) -> Result<TokenUsage, String> {
    let mut result = TokenUsage::default();
    let mut paths = Vec::new();
    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(Result::ok) {
            if entry.file_type().is_file() && is_rollout_path(entry.path()) {
                paths.push(entry.into_path());
            }
        }
    }
    paths.sort();
    paths.dedup();

    let mut streams = BTreeMap::<StreamKey, Vec<SequencedEvent>>::new();
    let mut first_error = None;
    for path in paths {
        if let Err(error) = collect_file(&path, &mut streams) {
            first_error.get_or_insert(error);
        }
    }
    if streams.is_empty() {
        if let Some(error) = first_error {
            return Err(error);
        }
    }

    let mut seen_token_records = HashMap::new();
    for events in streams.values_mut() {
        events.sort_by(compare_events);
        process_stream(events, day, &mut result, &mut seen_token_records);
    }
    Ok(result)
}

pub fn aggregate_today(root: &Path) -> Result<TokenUsage, String> {
    aggregate_day(root, Local::now().date_naive())
}

pub fn aggregate_codex_home_today(codex_home: &Path) -> Result<TokenUsage, String> {
    aggregate_codex_home_day(codex_home, Local::now().date_naive())
}

fn is_rollout_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
}

fn rollout_reader(path: &Path) -> Result<Box<dyn BufRead>, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Could not open a Codex rollout: {error}"))?;
    let file_len = file
        .metadata()
        .map_err(|error| format!("Could not inspect a Codex rollout: {error}"))?
        .len();
    if file_len > MAX_ROLLOUT_BYTES {
        return Err("A Codex rollout exceeds the safe local parsing limit".to_owned());
    }
    let compressed = path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.ends_with(".jsonl.zst"));
    if compressed {
        let mut magic = [0_u8; 4];
        file.read_exact(&mut magic)
            .map_err(|_| "Invalid compressed Codex rollout".to_owned())?;
        if magic != ZSTD_MAGIC {
            return Err("Invalid compressed Codex rollout".to_owned());
        }
        file.rewind()
            .map_err(|error| format!("Could not read a Codex rollout: {error}"))?;
        let decoder = zstd::stream::read::Decoder::new(file)
            .map_err(|_| "Invalid compressed Codex rollout".to_owned())?;
        Ok(Box::new(BufReader::new(decoder.take(MAX_ROLLOUT_BYTES))))
    } else {
        Ok(Box::new(BufReader::new(file.take(MAX_ROLLOUT_BYTES))))
    }
}

fn collect_file(
    path: &Path,
    streams: &mut BTreeMap<StreamKey, Vec<SequencedEvent>>,
) -> Result<(), String> {
    let mut owner = TokenRecordOwner::default();
    let mut subagent_history_start_ordinal = None;
    for (line_number, line) in rollout_reader(path)?.lines().enumerate() {
        let Ok(line) = line else { continue };
        let Ok(record) = serde_json::from_str::<Value>(&line) else { continue };
        let payload = record.get("payload").unwrap_or(&record);

        if is_record_type(&record, payload, "session_meta") {
            let meta = payload.get("meta").unwrap_or(payload);
            owner.thread_id = string_field(meta, &["id", "session_id"]);
            owner.parent_thread_id = string_field(meta, &["parent_thread_id"]);
            subagent_history_start_ordinal =
                meta.get("subagent_history_start_ordinal").and_then(Value::as_u64);
            continue;
        }

        let timestamp_text = record
            .get("timestamp")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let timestamp = timestamp_text
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok());
        let ordinal = record.get("ordinal").and_then(Value::as_u64);
        let key = owner
            .thread_id
            .clone()
            .map_or_else(|| StreamKey::Anonymous(path.to_path_buf()), StreamKey::Thread);

        if is_record_type(&record, payload, "turn_context") {
            streams.entry(key).or_default().push(SequencedEvent {
                timestamp,
                timestamp_text,
                ordinal,
                path: path.to_path_buf(),
                line_number,
                owner: owner.clone(),
                subagent_history_start_ordinal,
                kind: EventKind::Model(model_id(payload.get("model"))),
            });
            continue;
        }
        if !is_record_type(&record, payload, "token_count") {
            continue;
        }

        let info = payload.get("info").unwrap_or(payload);
        let cumulative = info.get("total_token_usage").map(parse_usage);
        let last_value = info.get("last_token_usage").or_else(|| payload.get("last_token_usage"));
        let fallback_model = last_value
            .and_then(|usage| model_id(usage.get("model")))
            .or_else(|| model_id(info.get("model")))
            .or_else(|| model_id(payload.get("model")));
        let last = last_value.map(parse_usage);
        if cumulative.is_none() && last.is_none() {
            continue;
        }

        let fingerprint = serde_json::to_string(&record).unwrap_or(line);
        streams.entry(key).or_default().push(SequencedEvent {
            timestamp,
            timestamp_text,
            ordinal,
            path: path.to_path_buf(),
            line_number,
            owner: owner.clone(),
            subagent_history_start_ordinal,
            kind: EventKind::Token(TokenEvent {
                cumulative,
                last,
                fallback_model,
                fingerprint,
            }),
        });
    }
    Ok(())
}

fn compare_events(left: &SequencedEvent, right: &SequencedEvent) -> Ordering {
    match (&left.timestamp, &right.timestamp) {
        (Some(left), Some(right)) => left.cmp(right),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
    .then_with(|| left.ordinal.cmp(&right.ordinal))
    .then_with(|| event_rank(&left.kind).cmp(&event_rank(&right.kind)))
    .then_with(|| left.path.cmp(&right.path))
    .then_with(|| left.line_number.cmp(&right.line_number))
}

fn event_rank(event: &EventKind) -> u8 {
    match event {
        EventKind::Model(_) => 0,
        EventKind::Token(_) => 1,
    }
}

fn process_stream(
    events: &[SequencedEvent],
    day: NaiveDate,
    total: &mut TokenUsage,
    seen_token_records: &mut HashMap<String, Vec<TokenRecordOwner>>,
) {
    let mut state = StreamState::default();
    for event in events {
        let EventKind::Token(token_event) = &event.kind else {
            if let EventKind::Model(model) = &event.kind {
                state.current_model = model.clone();
            }
            continue;
        };

        let model = state
            .current_model
            .clone()
            .or_else(|| token_event.fallback_model.clone())
            .unwrap_or_else(|| UNCLASSIFIED_MODEL.to_owned());
        let inherited_projection = event
            .subagent_history_start_ordinal
            .zip(event.ordinal)
            .is_some_and(|(start, ordinal)| ordinal < start);

        if !inherited_projection {
            let owners = seen_token_records
                .entry(token_event.fingerprint.clone())
                .or_default();
            if owners
                .iter()
                .any(|previous| related_stream(&event.owner, previous))
            {
                continue;
            }
            owners.push(event.owner.clone());
        }

        let Some(usage) = next_usage(
            &mut state,
            token_event,
            event.timestamp_text.clone(),
            model.clone(),
        ) else {
            continue;
        };

        // Baselines advance for every unique snapshot, including snapshots outside the selected
        // day and inherited subagent history. This makes a resumed file count only its new delta.
        if !inherited_projection && on_day_timestamp(event.timestamp.as_ref(), day) && !usage_is_zero(&usage) {
            total.push(&model, usage);
        }
    }
}

fn next_usage(
    state: &mut StreamState,
    event: &TokenEvent,
    timestamp: Option<String>,
    model: String,
) -> Option<ModelUsage> {
    if let Some(cumulative) = &event.cumulative {
        state.previous_legacy = None;
        let delta = state
            .previous_total
            .as_ref()
            .map_or_else(|| cumulative.clone(), |previous| usage_delta(cumulative, previous));
        state.previous_total = Some(cumulative.clone());
        Some(delta)
    } else if let Some(usage) = &event.last {
        let snapshot = LegacySnapshot {
            timestamp,
            model,
            usage: usage.clone(),
        };
        if state.previous_legacy.as_ref() == Some(&snapshot) {
            return None;
        }
        state.previous_legacy = Some(snapshot);
        Some(usage.clone())
    } else {
        None
    }
}

fn related_stream(current: &TokenRecordOwner, previous: &TokenRecordOwner) -> bool {
    match (&current.thread_id, &previous.thread_id) {
        (Some(current), Some(previous)) if current == previous => true,
        (Some(current), _) if previous.parent_thread_id.as_ref() == Some(current) => true,
        (_, Some(previous)) if current.parent_thread_id.as_ref() == Some(previous) => true,
        _ => current.parent_thread_id.is_some()
            && current.parent_thread_id == previous.parent_thread_id,
    }
}

fn is_record_type(record: &Value, payload: &Value, expected: &str) -> bool {
    record.get("type").and_then(Value::as_str) == Some(expected)
        || payload.get("type").and_then(Value::as_str) == Some(expected)
}

fn model_id(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|model| !model.is_empty()).map(ToOwned::to_owned)
}

fn string_field(value: &Value, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| model_id(value.get(*name)))
}

fn on_day_timestamp(timestamp: Option<&DateTime<FixedOffset>>, day: NaiveDate) -> bool {
    timestamp
        .is_some_and(|value| value.with_timezone(&Local).date_naive() == day)
}

fn optional_token(value: &Value, names: &[&str]) -> Option<u64> {
    names.iter().find_map(|name| value.get(*name).and_then(Value::as_u64))
}

fn token(value: &Value, names: &[&str]) -> u64 {
    optional_token(value, names).unwrap_or(0)
}

fn parse_usage(value: &Value) -> ModelUsage {
    let input = token(value, &["input_tokens", "input"]);
    let cached = optional_token(value, &["cached_input_tokens", "cached_input"]);
    let output = token(value, &["output_tokens", "output"]);
    let reasoning = optional_token(value, &["reasoning_output_tokens", "reasoning_tokens", "reasoning"]);
    let total = token(value, &["total_tokens", "total"]).max(input + output);
    ModelUsage {
        input,
        cached_input: cached,
        output,
        reasoning,
        total,
    }
}

fn counter_delta(current: u64, previous: u64) -> u64 {
    if current >= previous { current - previous } else { current }
}

fn optional_counter_delta(current: Option<u64>, previous: Option<u64>) -> Option<u64> {
    current.map(|current| previous.map_or(current, |previous| counter_delta(current, previous)))
}

fn usage_delta(current: &ModelUsage, previous: &ModelUsage) -> ModelUsage {
    ModelUsage {
        input: counter_delta(current.input, previous.input),
        cached_input: optional_counter_delta(current.cached_input, previous.cached_input),
        output: counter_delta(current.output, previous.output),
        reasoning: optional_counter_delta(current.reasoning, previous.reasoning),
        total: counter_delta(current.total, previous.total),
    }
}

fn usage_is_zero(usage: &ModelUsage) -> bool {
    usage.input == 0
        && usage.cached_input.unwrap_or(0) == 0
        && usage.output == 0
        && usage.reasoning.unwrap_or(0) == 0
        && usage.total == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};

    fn fixture(lines: &[&str]) -> tempfile::TempDir {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        let mut file = fs::File::create(temp.path().join("session.jsonl")).unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
        temp
    }

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 23).unwrap()
    }

    #[test]
    fn reads_authoritative_top_level_turn_context() {
        let temp = fixture(&[
            r#"{"timestamp":"2026-08-23T12:00:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
            r#"{"timestamp":"2026-08-23T12:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":120},"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":120}}}}"#,
        ]);
        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.total, 120);
        assert_eq!(usage.by_model["gpt-5.6-sol"].cached_input, Some(40));
        assert_eq!(usage.by_model["gpt-5.6-sol"].reasoning, Some(5));
    }

    #[test]
    fn attributes_cumulative_intervals_across_model_switches_without_a_whitelist() {
        let temp = fixture(&[
            r#"{"timestamp":"2026-08-23T12:00:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
            r#"{"timestamp":"2026-08-23T12:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":120}}}}"#,
            r#"{"timestamp":"2026-08-23T12:02:00Z","type":"turn_context","payload":{"model":"gpt-5.6-terra"}}"#,
            r#"{"timestamp":"2026-08-23T12:03:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":150,"cached_input_tokens":60,"output_tokens":30,"reasoning_output_tokens":7,"total_tokens":180}}}}"#,
            r#"{"timestamp":"2026-08-23T12:04:00Z","type":"turn_context","payload":{"model":"gpt-5.5"}}"#,
            r#"{"timestamp":"2026-08-23T12:05:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":200,"cached_input_tokens":80,"output_tokens":50,"reasoning_output_tokens":10,"total_tokens":250}}}}"#,
            r#"{"timestamp":"2026-08-23T12:06:00Z","type":"turn_context","payload":{"model":"gpt-5.7-example"}}"#,
            r#"{"timestamp":"2026-08-23T12:07:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":250,"cached_input_tokens":100,"output_tokens":70,"reasoning_output_tokens":12,"total_tokens":320}}}}"#,
        ]);
        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.by_model["gpt-5.6-sol"].total, 120);
        assert_eq!(usage.by_model["gpt-5.6-terra"].total, 60);
        assert_eq!(usage.by_model["gpt-5.5"].total, 70);
        assert_eq!(usage.by_model["gpt-5.7-example"].total, 70);
        assert_eq!(usage.by_model["gpt-5.7-example"].cached_input, Some(20));
        assert_eq!(usage.total, 320);
    }

    #[test]
    fn duplicate_cumulative_snapshots_are_not_double_counted() {
        let temp = fixture(&[
            r#"{"timestamp":"2026-08-23T12:00:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
            r#"{"timestamp":"2026-08-23T12:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"cached_input_tokens":20,"output_tokens":20,"total_tokens":100}}}}"#,
            r#"{"timestamp":"2026-08-23T12:02:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"cached_input_tokens":20,"output_tokens":20,"total_tokens":100}}}}"#,
        ]);
        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.total, 100);
        assert_eq!(usage.by_model["gpt-5.6-sol"].input, 80);
    }

    #[test]
    fn resumed_session_uses_the_prior_snapshot_as_its_baseline() {
        let temp = fixture(&[
            r#"{"timestamp":"2026-08-22T12:00:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
            r#"{"timestamp":"2026-08-22T12:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"cached_input_tokens":20,"output_tokens":20,"total_tokens":100}}}}"#,
            r#"{"timestamp":"2026-08-23T12:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":110,"cached_input_tokens":30,"output_tokens":30,"total_tokens":140}}}}"#,
        ]);
        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.by_model["gpt-5.6-sol"].input, 30);
        assert_eq!(usage.by_model["gpt-5.6-sol"].cached_input, Some(10));
        assert_eq!(usage.by_model["gpt-5.6-sol"].output, 10);
        assert_eq!(usage.total, 40);
    }

    #[test]
    fn split_file_resume_inherits_model_and_counts_only_the_new_interval() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        fs::write(temp.path().join("z-first.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"resumed-thread","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
        )).unwrap();
        fs::write(temp.path().join("a-resumed.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:01:00Z","ordinal":3,"type":"session_meta","payload":{"id":"resumed-thread","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:01:01Z","ordinal":4,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":110,"output_tokens":30,"total_tokens":140}}}}"#, "\n",
        )).unwrap();

        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.total, 140);
        assert_eq!(usage.by_model["gpt-5.6-sol"].total, 140);
        assert!(!usage.by_model.contains_key(UNCLASSIFIED_MODEL));
    }

    #[test]
    fn split_file_cross_day_resume_counts_only_the_selected_day_delta() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        fs::write(temp.path().join("previous-day.jsonl"), concat!(
            r#"{"timestamp":"2026-08-22T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"cross-day-thread","source":"vscode"}}"#, "\n",
            r#"{"timestamp":"2026-08-22T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-22T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
        )).unwrap();
        fs::write(temp.path().join("selected-day.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":3,"type":"session_meta","payload":{"id":"cross-day-thread","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":4,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":110,"output_tokens":30,"total_tokens":140}}}}"#, "\n",
        )).unwrap();

        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.total, 40);
        assert_eq!(usage.by_model["gpt-5.6-sol"].input, 30);
        assert_eq!(usage.by_model["gpt-5.6-sol"].output, 10);
    }

    #[test]
    fn overlapping_active_and_archived_files_are_ordered_and_deduplicated() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let home = tempfile::tempdir_in(target).unwrap();
        let sessions = home.path().join("sessions");
        let archived = home.path().join("archived_sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&archived).unwrap();

        fs::write(archived.join("archived-prefix.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"overlap-thread","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:03Z","ordinal":3,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":110,"output_tokens":30,"total_tokens":140}}}}"#, "\n",
        )).unwrap();
        fs::write(sessions.join("active-resume.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"overlap-thread","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:04Z","ordinal":4,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":140,"output_tokens":40,"total_tokens":180}}}}"#, "\n",
        )).unwrap();

        let usage = aggregate_codex_home_day(home.path(), day()).unwrap();
        assert_eq!(usage.total, 180);
        assert_eq!(usage.by_model["gpt-5.6-sol"].total, 180);
    }

    #[test]
    fn split_file_model_switch_attributes_only_the_new_delta_to_the_new_model() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        fs::write(temp.path().join("first.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"switch-thread","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
        )).unwrap();
        fs::write(temp.path().join("second.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:01:00Z","ordinal":3,"type":"session_meta","payload":{"id":"switch-thread","source":"vscode"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:01:01Z","ordinal":4,"type":"turn_context","payload":{"model":"gpt-5.6-terra"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:01:02Z","ordinal":5,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":130,"output_tokens":30,"total_tokens":160}}}}"#, "\n",
        )).unwrap();

        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.by_model["gpt-5.6-sol"].total, 100);
        assert_eq!(usage.by_model["gpt-5.6-terra"].total, 60);
        assert_eq!(usage.total, 160);
    }

    #[test]
    fn split_file_counter_reset_starts_a_new_epoch() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        fs::write(temp.path().join("before-reset.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"reset-thread","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-terra"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"cached_input_tokens":20,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
        )).unwrap();
        fs::write(temp.path().join("after-reset.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:01:00Z","ordinal":3,"type":"session_meta","payload":{"id":"reset-thread","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:01:01Z","ordinal":4,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":5,"total_tokens":15}}}}"#, "\n",
        )).unwrap();

        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.total, 115);
        assert_eq!(usage.by_model["gpt-5.6-terra"].cached_input, Some(22));
    }

    #[test]
    fn counter_reset_starts_a_new_cumulative_epoch() {
        let temp = fixture(&[
            r#"{"timestamp":"2026-08-23T12:00:00Z","type":"turn_context","payload":{"model":"gpt-5.6-terra"}}"#,
            r#"{"timestamp":"2026-08-23T12:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"cached_input_tokens":20,"output_tokens":20,"reasoning_output_tokens":4,"total_tokens":100}}}}"#,
            r#"{"timestamp":"2026-08-23T12:02:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":5,"reasoning_output_tokens":1,"total_tokens":15}}}}"#,
        ]);
        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.total, 115);
        assert_eq!(usage.by_model["gpt-5.6-terra"].cached_input, Some(22));
        assert_eq!(usage.by_model["gpt-5.6-terra"].reasoning, Some(5));
    }

    #[test]
    fn genuinely_missing_model_is_unclassified() {
        let temp = fixture(&[
            r#"{"timestamp":"2026-08-23T12:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":40,"output_tokens":10,"total_tokens":50}}}}"#,
        ]);
        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.by_model[UNCLASSIFIED_MODEL].total, 50);
        assert_eq!(usage.by_model[UNCLASSIFIED_MODEL].cached_input, None);
        assert_eq!(usage.by_model[UNCLASSIFIED_MODEL].reasoning, None);
    }

    #[test]
    fn explicit_turn_without_model_does_not_reuse_stale_attribution() {
        let temp = fixture(&[
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"missing-model-turn"}}"#,
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#,
            r#"{"timestamp":"2026-08-23T12:01:00Z","ordinal":3,"type":"turn_context","payload":{}}"#,
            r#"{"timestamp":"2026-08-23T12:01:01Z","ordinal":4,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":110,"output_tokens":30,"total_tokens":140}}}}"#,
        ]);

        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.by_model["gpt-5.6-sol"].total, 100);
        assert_eq!(usage.by_model[UNCLASSIFIED_MODEL].total, 40);
        assert_eq!(usage.total, 140);
    }

    #[test]
    fn supports_legacy_nested_turn_context_and_exact_duplicate_last_usage() {
        let temp = fixture(&[
            "not json",
            r#"{"timestamp":"2026-08-23T12:00:00Z","payload":{"type":"turn_context","model":"legacy-codex"}}"#,
            r#"{"timestamp":"2026-08-23T12:01:00Z","payload":{"type":"token_count","last_token_usage":{"input_tokens":30,"output_tokens":5,"total_tokens":35}}}"#,
            r#"{"timestamp":"2026-08-23T12:01:00Z","payload":{"type":"token_count","last_token_usage":{"input_tokens":30,"output_tokens":5,"total_tokens":35}}}"#,
        ]);
        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.by_model["legacy-codex"].total, 35);
    }

    #[test]
    fn each_thread_keeps_independent_model_and_counter_state() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        fs::write(temp.path().join("parent.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","type":"turn_context","payload":{"model":"gpt-5.5"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":70,"output_tokens":10,"total_tokens":80}}}}"#, "\n",
        )).unwrap();
        fs::write(temp.path().join("subagent.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:30Z","type":"turn_context","payload":{"model":"gpt-5.6-terra"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:01:30Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":40,"output_tokens":10,"total_tokens":50}}}}"#, "\n",
        )).unwrap();
        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.by_model["gpt-5.5"].total, 80);
        assert_eq!(usage.by_model["gpt-5.6-terra"].total, 50);
        assert_eq!(usage.total, 130);
    }

    #[test]
    fn aggregates_vscode_cli_and_archived_sessions_from_shared_codex_home() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let home = tempfile::tempdir_in(target).unwrap();
        let sessions = home.path().join("sessions/2026/08/23");
        let archived = home.path().join("archived_sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&archived).unwrap();

        fs::write(sessions.join("vscode.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"thread-vscode","session_id":"session-vscode","source":"vscode"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
        )).unwrap();
        fs::write(sessions.join("cli.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00.500Z","ordinal":0,"type":"session_meta","payload":{"id":"thread-cli","session_id":"session-cli","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01.500Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02.500Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":40,"output_tokens":10,"total_tokens":50}}}}"#, "\n",
        )).unwrap();
        fs::write(archived.join("terminal-other-model.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:03Z","ordinal":0,"type":"session_meta","payload":{"id":"thread-cli-2","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:04Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.5"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:05Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":25,"output_tokens":5,"total_tokens":30}}}}"#, "\n",
        )).unwrap();

        let usage = aggregate_codex_home_day(home.path(), day()).unwrap();
        assert_eq!(usage.by_model["gpt-5.6-sol"].total, 150);
        assert_eq!(usage.by_model["gpt-5.5"].total, 30);
        assert_eq!(usage.total, 180);
    }

    #[test]
    fn identical_snapshots_in_unrelated_concurrent_sessions_both_count() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        for (file, thread, source) in [
            ("vscode.jsonl", "thread-vscode", "vscode"),
            ("cli.jsonl", "thread-cli", "cli"),
        ] {
            fs::write(temp.path().join(file), format!(
                concat!(
                    r#"{{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{{"id":"{}","source":"{}"}}}}"#, "\n",
                    r#"{{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{{"model":"gpt-5.6-sol"}}}}"#, "\n",
                    r#"{{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}}}}}"#, "\n",
                ),
                thread, source
            )).unwrap();
        }

        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.by_model["gpt-5.6-sol"].total, 200);
    }

    #[test]
    fn reads_official_zstd_rollout_representation() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let home = tempfile::tempdir_in(target).unwrap();
        let archived = home.path().join("archived_sessions");
        fs::create_dir_all(&archived).unwrap();
        let rollout = concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"compressed-cli","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-terra"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":60,"output_tokens":10,"total_tokens":70}}}}"#, "\n",
        );
        let compressed = zstd::stream::encode_all(rollout.as_bytes(), 3).unwrap();
        fs::write(archived.join("rollout.jsonl.zst"), compressed).unwrap();

        let usage = aggregate_codex_home_day(home.path(), day()).unwrap();
        assert_eq!(usage.by_model["gpt-5.6-terra"].total, 70);
    }

    #[test]
    fn malformed_zstd_does_not_crash_or_hide_a_valid_session() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let home = tempfile::tempdir_in(target).unwrap();
        let sessions = home.path().join("sessions");
        let archived = home.path().join("archived_sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&archived).unwrap();
        fs::write(sessions.join("valid.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":40,"output_tokens":10,"total_tokens":50}}}}"#, "\n",
        )).unwrap();
        fs::write(archived.join("malformed.jsonl.zst"), b"not a zstd rollout").unwrap();

        let usage = aggregate_codex_home_day(home.path(), day()).unwrap();
        assert_eq!(usage.total, 50);
        assert_eq!(usage.by_model["gpt-5.6-sol"].total, 50);
    }

    #[test]
    fn duplicate_rollout_representations_are_counted_once() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let home = tempfile::tempdir_in(target).unwrap();
        let sessions = home.path().join("sessions");
        let archived = home.path().join("archived_sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&archived).unwrap();
        let rollout = concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"same-thread","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
        );
        fs::write(sessions.join("active.jsonl"), rollout).unwrap();
        fs::write(archived.join("archived-copy.jsonl"), rollout).unwrap();

        let usage = aggregate_codex_home_day(home.path(), day()).unwrap();
        assert_eq!(usage.total, 100);
    }

    #[test]
    fn excludes_inherited_subagent_prefix_but_counts_child_interval() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        fs::write(temp.path().join("a-parent.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00Z","ordinal":0,"type":"session_meta","payload":{"id":"parent","source":"cli"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
        )).unwrap();
        fs::write(temp.path().join("b-child.jsonl"), concat!(
            r#"{"timestamp":"2026-08-23T12:00:00.500Z","ordinal":0,"type":"session_meta","payload":{"id":"child","parent_thread_id":"parent","source":{"subAgent":{"threadSpawn":{"parent_thread_id":"parent"}}},"subagent_history_start_ordinal":3}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:01Z","ordinal":1,"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:02Z","ordinal":2,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":20,"total_tokens":100}}}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:03Z","ordinal":3,"type":"turn_context","payload":{"model":"gpt-5.6-terra"}}"#, "\n",
            r#"{"timestamp":"2026-08-23T12:00:04Z","ordinal":4,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":110,"output_tokens":30,"total_tokens":140}}}}"#, "\n",
        )).unwrap();

        let usage = aggregate_day(temp.path(), day()).unwrap();
        assert_eq!(usage.by_model["gpt-5.6-sol"].total, 100);
        assert_eq!(usage.by_model["gpt-5.6-terra"].total, 40);
        assert_eq!(usage.total, 140);
    }

    #[test]
    fn missing_root_is_empty_and_safe() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        let temp = tempfile::tempdir_in(target).unwrap();
        let usage = aggregate_today(&temp.path().join("never-created")).unwrap();
        assert_eq!(usage, TokenUsage::default());
    }
}
