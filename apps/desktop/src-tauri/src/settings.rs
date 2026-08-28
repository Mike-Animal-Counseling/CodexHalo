use std::{fs, path::PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VisibilityMode { Always, AutoHide, Tray }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HudStyle { Capsule, Halo }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupBehavior { Off, StartWithWindows, ShowWhenCodexStarts }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode { System, Light, Dark }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub codex_enabled: bool,
    pub visibility_mode: VisibilityMode,
    pub hud_style: HudStyle,
    pub always_on_top: bool,
    pub edge_auto_hide: bool,
    pub opacity: f64,
    pub click_through: bool,
    pub show_api_equivalent: bool,
    pub show_reset_countdown: bool,
    pub theme: ThemeMode,
    pub shortcut: String,
    pub startup_behavior: StartupBehavior,
    pub reduced_motion: bool,
    pub quota_window_minutes: Option<u64>,
    pub window_position: Option<WindowPosition>,
    pub surface_version: u8,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            codex_enabled: false,
            visibility_mode: VisibilityMode::AutoHide,
            hud_style: HudStyle::Halo,
            always_on_top: true,
            edge_auto_hide: true,
            opacity: 0.96,
            click_through: false,
            show_api_equivalent: true,
            show_reset_countdown: true,
            theme: ThemeMode::System,
            shortcut: "CommandOrControl+Shift+H".into(),
            startup_behavior: StartupBehavior::Off,
            reduced_motion: false,
            quota_window_minutes: None,
            window_position: None,
            surface_version: 3,
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(config_dir: PathBuf) -> Self {
        Self { path: config_dir.join("settings.json") }
    }

    pub fn load(&self) -> Settings {
        fs::read(&self.path).ok().map(|bytes| decode_settings(&bytes)).unwrap_or_default()
    }

    pub fn save(&self, settings: &Settings) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Settings path has no parent")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
        fs::write(&self.path, bytes).map_err(|error| error.to_string())
    }
}

fn decode_settings(bytes: &[u8]) -> Settings {
    let stored = serde_json::from_slice::<serde_json::Value>(bytes).ok();
    let stored_surface_version = stored.as_ref()
        .and_then(|value| value.get("surfaceVersion").and_then(serde_json::Value::as_u64))
        .unwrap_or(1);
    let mut settings = serde_json::from_slice::<Settings>(bytes).unwrap_or_default();
    if stored.as_ref().is_some_and(|value| {
        value.get("startupBehavior").is_none()
            && value.get("launchAtLogin").and_then(serde_json::Value::as_bool) == Some(true)
    }) {
        settings.startup_behavior = StartupBehavior::StartWithWindows;
    }
    if stored.as_ref().is_some_and(|value| value.get("quotaWindowMinutes").is_none()) {
        settings.quota_window_minutes = stored.as_ref()
            .and_then(|value| value.get("quotaFocus"))
            .and_then(serde_json::Value::as_str)
            .and_then(|focus| match focus {
                "weekly" => Some(10_080),
                "fiveHour" => Some(300),
                _ => None,
            });
    }
    if stored_surface_version < 2 {
        settings.hud_style = HudStyle::Halo;
    }
    if stored_surface_version < 3 {
        settings.surface_version = 2;
    }
    settings
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disabled_is_the_serialization_default() {
        let encoded = serde_json::to_string(&Settings::default()).unwrap();
        let decoded: Settings = serde_json::from_str(&encoded).unwrap();
        assert!(!decoded.codex_enabled);
        assert_eq!(decoded.hud_style, HudStyle::Halo);
        assert_eq!(decoded.quota_window_minutes, None);
        assert_eq!(decoded.startup_behavior, StartupBehavior::Off);
    }

    #[test]
    fn legacy_capsule_settings_migrate_to_the_orb_surface() {
        let settings = decode_settings(br#"{"codexEnabled":true,"hudStyle":"capsule"}"#);
        assert_eq!(settings.hud_style, HudStyle::Halo);
        assert_eq!(settings.quota_window_minutes, None);
        assert_eq!(settings.surface_version, 2);
    }

    #[test]
    fn legacy_launch_at_login_migrates_to_start_with_windows() {
        let settings = decode_settings(br#"{"launchAtLogin":true,"surfaceVersion":3}"#);
        assert_eq!(settings.startup_behavior, StartupBehavior::StartWithWindows);
    }

    #[test]
    fn legacy_quota_focus_migrates_to_a_duration_preference() {
        let weekly = decode_settings(br#"{"quotaFocus":"weekly","surfaceVersion":3}"#);
        let five_hour = decode_settings(br#"{"quotaFocus":"fiveHour","surfaceVersion":3}"#);
        assert_eq!(weekly.quota_window_minutes, Some(10_080));
        assert_eq!(five_hour.quota_window_minutes, Some(300));
    }

    #[test]
    fn dynamic_quota_duration_round_trips_without_a_known_window_enum() {
        let settings = Settings {
            quota_window_minutes: Some(240),
            ..Settings::default()
        };
        let encoded = serde_json::to_string(&settings).unwrap();
        assert!(encoded.contains(r#""quotaWindowMinutes":240"#));
        let decoded: Settings = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.quota_window_minutes, Some(240));
    }
}
