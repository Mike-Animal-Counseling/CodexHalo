mod settings;
mod status;

use std::sync::Mutex;
use settings::{Settings, SettingsStore, WindowPosition};
use status::{ConnectionState, DashboardStatus};
use tauri::{Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct AppState {
    settings: Mutex<Settings>,
    store: SettingsStore,
    cache: Mutex<Option<DashboardStatus>>,
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    state.settings.lock().map(|value| value.clone()).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_settings(window: WebviewWindow, state: State<'_, AppState>, mut settings: Settings) -> Result<Settings, String> {
    settings.opacity = settings.opacity.clamp(0.70, 1.0);
    window.set_always_on_top(settings.always_on_top).map_err(|error| error.to_string())?;
    window.set_ignore_cursor_events(settings.click_through).map_err(|error| error.to_string())?;
    state.store.save(&settings)?;
    *state.settings.lock().map_err(|error| error.to_string())? = settings.clone();
    Ok(settings)
}

#[tauri::command]
fn set_codex_enabled(state: State<'_, AppState>, enabled: bool) -> Result<Settings, String> {
    let mut settings = state.settings.lock().map_err(|error| error.to_string())?.clone();
    settings.codex_enabled = enabled;
    state.store.save(&settings)?;
    *state.settings.lock().map_err(|error| error.to_string())? = settings.clone();
    if !enabled {
        *state.cache.lock().map_err(|error| error.to_string())? = None;
    }
    Ok(settings)
}

#[tauri::command]
async fn refresh_status(state: State<'_, AppState>) -> Result<DashboardStatus, String> {
    let enabled = state.settings.lock().map_err(|error| error.to_string())?.codex_enabled;
    if !enabled {
        return Ok(DashboardStatus::disabled());
    }
    match status::refresh(true).await {
        Ok(fresh) => {
            *state.cache.lock().map_err(|error| error.to_string())? = Some(fresh.clone());
            Ok(fresh)
        }
        Err(message) => {
            if let Some(mut cached) = state.cache.lock().map_err(|error| error.to_string())?.clone() {
                cached.connection = ConnectionState::Offline;
                cached.message = Some(message);
                Ok(cached)
            } else {
                Ok(DashboardStatus {
                    connection: ConnectionState::Error,
                    windows: Vec::new(),
                    tokens: Default::default(),
                    pricing: codexhalo_pricing::estimate(&Default::default()),
                    updated_at: None,
                    message: Some(message),
                })
            }
        }
    }
}

#[tauri::command]
fn start_codex_login() -> Result<Option<String>, String> {
    codexhalo_codex_client::launch_login().map_err(|error| error.to_string())?;
    Ok(None)
}

#[tauri::command]
fn save_window_position(state: State<'_, AppState>, x: i32, y: i32) -> Result<(), String> {
    let mut settings = state.settings.lock().map_err(|error| error.to_string())?.clone();
    settings.window_position = Some(WindowPosition { x, y });
    state.store.save(&settings)?;
    *state.settings.lock().map_err(|error| error.to_string())? = settings;
    Ok(())
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(false);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show HUD", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh Now", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &refresh, &settings, &quit])?;
    let mut tray = TrayIconBuilder::with_id("codexhalo").menu(&menu).show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_window(app),
            "refresh" => { show_window(app); let _ = app.emit("halo://refresh", ()); }
            "settings" => { show_window(app); let _ = app.emit("halo://settings", ()); }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn restore_position(window: &WebviewWindow, position: Option<WindowPosition>) {
    let Some(position) = position else { return };
    let valid = window.available_monitors().unwrap_or_default().iter().any(|monitor| {
        let origin = monitor.position();
        let size = monitor.size();
        position.x >= origin.x && position.y >= origin.y
            && position.x < origin.x + size.width as i32
            && position.y < origin.y + size.height as i32
    });
    if valid {
        let _ = window.set_position(PhysicalPosition::new(position.x, position.y));
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| {
            if event.state() != ShortcutState::Pressed { return; }
            if let Some(window) = app.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) { let _ = window.hide(); } else { show_window(app); }
            }
        }).build())
        .setup(|app| {
            let config = app.path().app_config_dir()?;
            let store = SettingsStore::new(config);
            let settings = store.load();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(settings.always_on_top);
                restore_position(&window, settings.window_position.clone());
            }
            app.global_shortcut().register(settings.shortcut.as_str())?;
            app.manage(AppState { settings: Mutex::new(settings), store, cache: Mutex::new(None) });
            setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings, set_settings, set_codex_enabled, refresh_status,
            start_codex_login, save_window_position
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CodexHalo");
}
