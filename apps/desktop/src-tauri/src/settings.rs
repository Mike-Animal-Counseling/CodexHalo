use std::{fs, path::PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VisibilityMode { Always, AutoHide, Tray }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HudStyle { Capsule, Halo }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode { System, Light, Dark }

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub launch_at_login: bool,
    pub window_position: Option<WindowPosition>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            codex_enabled: false,
            visibility_mode: VisibilityMode::AutoHide,
            hud_style: HudStyle::Capsule,
            always_on_top: true,
            edge_auto_hide: true,
            opacity: 0.96,
            click_through: false,
            show_api_equivalent: true,
            show_reset_countdown: true,
            theme: ThemeMode::System,
            shortcut: "CommandOrControl+Shift+H".into(),
            launch_at_login: false,
            window_position: None,
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
        fs::read(&self.path).ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, settings: &Settings) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Settings path has no parent")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
        fs::write(&self.path, bytes).map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disabled_is_the_serialization_default() {
        let encoded = serde_json::to_string(&Settings::default()).unwrap();
        let decoded: Settings = serde_json::from_str(&encoded).unwrap();
        assert!(!decoded.codex_enabled);
    }
}
