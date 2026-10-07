use std::{collections::BTreeMap, fs, path::PathBuf};
use codexhalo_shared::RateLimitWindow;

#[derive(Default)]
pub struct ReminderTracker {
    path: PathBuf,
    sent: BTreeMap<String, i64>,
    observed: BTreeMap<String, RateLimitWindow>,
}

impl ReminderTracker {
    pub fn new(config_dir: PathBuf) -> Self {
        let path = config_dir.join("reset-reminders.json");
        let sent = fs::read(&path).ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        Self { path, sent, observed: BTreeMap::new() }
    }

    pub fn observe(&mut self, windows: &[RateLimitWindow], now: i64) {
        self.observed.retain(|key, window| {
            window.resets_at.is_some_and(|reset| reset >= now.saturating_sub(60))
                && !self.sent.contains_key(key)
        });
        for window in windows {
            let Some(reset) = window.resets_at else { continue };
            // A refreshed quota may already describe the next cycle at the instant
            // of reset. Keep the previously observed cycle through the scheduling
            // grace, but replace a future schedule if the server revises it.
            self.observed.retain(|_, previous| {
                let same_limit = previous.id == window.id
                    && previous.duration_minutes == window.duration_minutes;
                let still_future = previous.resets_at.is_some_and(|previous_reset| previous_reset > now);
                !(same_limit && still_future
                    && (previous.resets_at != Some(reset) || window.used_percent == 0))
            });
            let key = reminder_key(window);
            if window.used_percent > 0
                && reset >= now.saturating_sub(60)
                && !self.sent.contains_key(&key)
            {
                self.observed.insert(key, window.clone());
            }
        }
    }

    pub fn clear_observed(&mut self) {
        self.observed.clear();
    }

    pub fn due_observed(&self, now: i64, lead_minutes: u32) -> Vec<RateLimitWindow> {
        self.observed.values()
            .filter(|window| is_due(window, now, lead_minutes)
                && !self.sent.contains_key(&reminder_key(window)))
            .cloned().collect()
    }

    #[cfg(test)]
    pub fn due<'a>(&self, windows: &'a [RateLimitWindow], now: i64, lead_minutes: u32) -> Vec<&'a RateLimitWindow> {
        windows.iter().filter(|window| {
            is_due(window, now, lead_minutes) && !self.sent.contains_key(&reminder_key(window))
        }).collect()
    }

    pub fn mark_sent(&mut self, window: &RateLimitWindow, now: i64) {
        self.sent.retain(|_, reset| *reset > now.saturating_sub(86_400));
        let key = reminder_key(window);
        self.observed.remove(&key);
        self.sent.insert(key, window.resets_at.unwrap_or(now));
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(bytes) = serde_json::to_vec(&self.sent) { let _ = fs::write(&self.path, bytes); }
    }
}

fn is_due(window: &RateLimitWindow, now: i64, lead_minutes: u32) -> bool {
    let Some(reset) = window.resets_at else { return false };
    let delta = reset.saturating_sub(now);
    // A zero lead means at reset, with a short grace for timer scheduling.
    let in_window = if lead_minutes == 0 { (-60..=0).contains(&delta) }
        else { delta > 0 && delta <= i64::from(lead_minutes.min(10_080)) * 60 };
    window.used_percent > 0 && in_window
}

fn reminder_key(window: &RateLimitWindow) -> String {
    // Account IDs are unavailable; only quota identifiers and reset timestamps persist.
    format!("{}:{}:{}", window.id, window.duration_minutes, window.resets_at.unwrap_or(0))
}

pub fn reminder_body(window: &RateLimitWindow, now: i64) -> String {
    let label = match window.duration_minutes {
        300 => "5-hour limit".to_owned(),
        10_080 => "Weekly limit".to_owned(),
        minutes if minutes % 1_440 == 0 => format!("{}-day limit", minutes / 1_440),
        minutes if minutes % 60 == 0 => format!("{}-hour limit", minutes / 60),
        minutes => format!("{minutes}-minute limit"),
    };
    let seconds = window.resets_at.unwrap_or(now).saturating_sub(now).max(0);
    if seconds == 0 { format!("{label} is scheduled to reset now.") }
    else { let minutes = (seconds + 59) / 60;
        format!("{label} resets in {minutes} minute{}. Your quota will refresh automatically.", if minutes == 1 { "" } else { "s" }) }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn window(reset: i64) -> RateLimitWindow {
        RateLimitWindow { id: "primary".into(), duration_minutes: 300, used_percent: 80, resets_at: Some(reset) }
    }
    #[test]
    fn configurable_lead_and_cycle_deduplication() {
        let mut tracker = ReminderTracker::default();
        let windows = vec![window(2_000)];
        assert!(tracker.due(&windows, 1_000, 15).is_empty());
        assert_eq!(tracker.due(&windows, 1_100, 15).len(), 1);
        tracker.sent.insert(reminder_key(&windows[0]), 2_000);
        assert!(tracker.due(&windows, 1_200, 30).is_empty());
        assert_eq!(tracker.due(&[window(3_000)], 2_100, 15).len(), 1);
    }
    #[test]
    fn stale_resets_and_unused_windows_do_not_notify() {
        let tracker = ReminderTracker::default();
        assert!(tracker.due(&[window(1_000)], 1_001, 15).is_empty());
        let mut unused = window(2_000); unused.used_percent = 0;
        assert!(tracker.due(&[unused], 1_100, 15).is_empty());
    }
    #[test]
    fn zero_lead_notifies_at_reset_with_bounded_grace() {
        let tracker = ReminderTracker::default();
        assert!(tracker.due(&[window(2_000)], 1_999, 0).is_empty());
        assert_eq!(tracker.due(&[window(2_000)], 2_000, 0).len(), 1);
        assert_eq!(tracker.due(&[window(2_000)], 2_040, 0).len(), 1);
        assert!(tracker.due(&[window(2_000)], 2_061, 0).is_empty());
    }
    #[test]
    fn zero_lead_survives_refresh_rotating_to_an_unused_next_cycle() {
        let mut tracker = ReminderTracker::default();
        tracker.observe(&[window(2_000)], 1_985);
        let mut next_cycle = window(20_000);
        next_cycle.used_percent = 0;
        tracker.observe(&[next_cycle], 2_005);
        let due = tracker.due_observed(2_015, 0);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].resets_at, Some(2_000));
        tracker.sent.insert(reminder_key(&due[0]), 2_000);
        assert!(tracker.due_observed(2_030, 0).is_empty());
        tracker.observe(&[window(20_000)], 2_035);
        assert!(tracker.due_observed(2_061, 0).is_empty());
        assert_eq!(tracker.due_observed(20_000, 0).len(), 1);
    }
    #[test]
    fn server_revisions_replace_future_schedules() {
        let mut tracker = ReminderTracker::default();
        tracker.observe(&[window(2_000)], 1_000);
        tracker.observe(&[window(3_000)], 1_050);
        assert!(tracker.due_observed(1_100, 15).is_empty());
        assert_eq!(tracker.due_observed(2_100, 15).len(), 1);
        let mut unused = window(3_000); unused.used_percent = 0;
        tracker.observe(&[unused], 2_150);
        assert!(tracker.due_observed(2_200, 15).is_empty());
    }
    #[test]
    fn clearing_observed_schedules_prevents_notifications_after_consent_changes() {
        let mut tracker = ReminderTracker::default();
        tracker.observe(&[window(2_000)], 1_100);
        tracker.clear_observed();
        assert!(tracker.due_observed(1_200, 15).is_empty());
    }
}
