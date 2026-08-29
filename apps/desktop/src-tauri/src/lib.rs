mod settings;
mod status;
#[cfg(target_os = "windows")]
mod windows_startup;

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use serde::{Deserialize, Serialize};
use settings::{Settings, SettingsStore, StartupBehavior, VisibilityMode, WindowPosition};
use status::{ConnectionState, DashboardStatus};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri::utils::config::Color;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio::time::{interval, sleep, Duration, MissedTickBehavior};

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER};

#[cfg(target_os = "windows")]
#[link(name = "user32")]
unsafe extern "system" {
    fn GetAsyncKeyState(v_key: i32) -> i16;
}

#[cfg(target_os = "windows")]
fn primary_pointer_is_down() -> bool {
    unsafe { (GetAsyncKeyState(0x01) as u16 & 0x8000) != 0 }
}

struct AppState {
    settings: Mutex<Settings>,
    consent_generation: AtomicU64,
    store: SettingsStore,
    cache: Mutex<Option<DashboardStatus>>,
    geometry: tokio::sync::Mutex<()>,
    surface: Mutex<WindowSurface>,
    surface_layout: Mutex<SurfaceLayout>,
    orb_position: Mutex<Option<WindowPosition>>,
    retracted: Mutex<Option<DockEdge>>,
    startup_monitor: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

fn require_codex_consent(enabled: bool) -> Result<(), String> {
    enabled
        .then_some(())
        .ok_or_else(|| "Codex access is disabled".to_owned())
}

fn consent_is_current(enabled: bool, current_generation: u64, captured_generation: u64) -> bool {
    enabled && current_generation == captured_generation
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum WindowSurface { Onboarding, Compact, Expanded }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompactHandoffPayload {
    status: DashboardStatus,
    settings: Settings,
    refreshing: bool,
}

const COMPACT_WIDTH: f64 = 148.0;
const COMPACT_HEIGHT: f64 = 32.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum DockEdge { Left, Right, Top, Bottom }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ExpandedPlacement { Above, Below, Left, Right }

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettledOrb {
    x: i32,
    y: i32,
    edge: Option<DockEdge>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct DragOutcome {
    moved: bool,
    settled: Option<SettledOrb>,
    layout: Option<SurfaceLayout>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct SurfaceLayout {
    orb_x: f64,
    orb_y: f64,
    panel_x: f64,
    panel_y: f64,
    placement: ExpandedPlacement,
    edge: Option<DockEdge>,
}

#[derive(Debug, Clone, Copy)]
struct DisplayBounds {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

fn surface_dimensions(surface: WindowSurface) -> (f64, f64) {
    match surface {
        WindowSurface::Compact => (COMPACT_WIDTH, COMPACT_HEIGHT),
        WindowSurface::Expanded => (280.0, 464.0),
        WindowSurface::Onboarding => (404.0, 620.0),
    }
}

fn expanded_dimensions(placement: ExpandedPlacement, scale: f64) -> (i32, i32) {
    let (width, height) = match placement {
        ExpandedPlacement::Above | ExpandedPlacement::Below => (280.0, 464.0),
        ExpandedPlacement::Left | ExpandedPlacement::Right => (428.0, 432.0),
    };
    ((width * scale).round() as i32, (height * scale).round() as i32)
}

fn physical_dimensions(surface: WindowSurface, scale: f64) -> (i32, i32) {
    let (width, height) = surface_dimensions(surface);
    ((width * scale).round() as i32, (height * scale).round() as i32)
}

fn legacy_orb_anchor_to_compact_window(position: WindowPosition, scale: f64) -> WindowPosition {
    let legacy_orb_size = 44.0;
    WindowPosition {
        x: position.x - ((COMPACT_WIDTH - legacy_orb_size) * scale / 2.0).round() as i32,
        y: position.y - ((COMPACT_HEIGHT - legacy_orb_size) * scale / 2.0).round() as i32,
    }
}

fn distance_to_bounds(x: i32, y: i32, bounds: DisplayBounds) -> i64 {
    let dx = if x < bounds.left { bounds.left - x } else if x > bounds.right { x - bounds.right } else { 0 };
    let dy = if y < bounds.top { bounds.top - y } else if y > bounds.bottom { y - bounds.bottom } else { 0 };
    i64::from(dx) * i64::from(dx) + i64::from(dy) * i64::from(dy)
}

fn display_for_point(window: &WebviewWindow, x: i32, y: i32) -> Result<DisplayBounds, String> {
    let displays: Vec<DisplayBounds> = window.available_monitors().map_err(|error| error.to_string())?
        .into_iter().map(|monitor| {
            let work_area = monitor.work_area();
            let origin = work_area.position;
            let size = work_area.size;
            DisplayBounds {
                left: origin.x,
                top: origin.y,
                right: origin.x + size.width as i32,
                bottom: origin.y + size.height as i32,
            }
        }).collect();
    displays.into_iter().min_by_key(|bounds| distance_to_bounds(x, y, *bounds))
        .ok_or_else(|| "No active display is available".to_owned())
}

fn clamp_position(position: WindowPosition, width: i32, height: i32, bounds: DisplayBounds) -> WindowPosition {
    let max_x = (bounds.right - width).max(bounds.left);
    let max_y = (bounds.bottom - height).max(bounds.top);
    WindowPosition {
        x: position.x.clamp(bounds.left, max_x),
        y: position.y.clamp(bounds.top, max_y),
    }
}

fn free_position(position: WindowPosition, width: i32, height: i32, bounds: DisplayBounds) -> (WindowPosition, Option<DockEdge>) {
    let max_x = (bounds.right - width).max(bounds.left);
    let max_y = (bounds.bottom - height).max(bounds.top);
    let edge = if position.x <= bounds.left {
        Some(DockEdge::Left)
    } else if position.x >= max_x {
        Some(DockEdge::Right)
    } else if position.y <= bounds.top {
        Some(DockEdge::Top)
    } else if position.y >= max_y {
        Some(DockEdge::Bottom)
    } else {
        None
    };
    (clamp_position(position, width, height, bounds), edge)
}

fn retracted_position(
    anchor: WindowPosition,
    width: i32,
    height: i32,
    bounds: DisplayBounds,
    edge: DockEdge,
    handle: i32,
) -> WindowPosition {
    match edge {
        DockEdge::Left => WindowPosition { x: bounds.left - width + handle, y: anchor.y },
        DockEdge::Right => WindowPosition { x: bounds.right - handle, y: anchor.y },
        DockEdge::Top => WindowPosition { x: anchor.x, y: bounds.top - height + handle },
        DockEdge::Bottom => WindowPosition { x: anchor.x, y: bounds.bottom - handle },
    }
}

fn expanded_surface_layout(orb: WindowPosition, bounds: DisplayBounds, scale: f64) -> (WindowPosition, SurfaceLayout) {
    let orb_width = (COMPACT_WIDTH * scale).round() as i32;
    let orb_height = (COMPACT_HEIGHT * scale).round() as i32;
    let card_width = (272.0 * scale).round() as i32;
    let card_height = (424.0 * scale).round() as i32;
    let join = scale.round() as i32;
    let center_x = orb.x + orb_width / 2;
    let center_y = orb.y + orb_height / 2;
    let display_center_x = bounds.left + (bounds.right - bounds.left) / 2;
    let display_center_y = bounds.top + (bounds.bottom - bounds.top) / 2;
    let can_open_above = orb.y - bounds.top >= card_height - join;
    let can_open_below = bounds.bottom - (orb.y + orb_height) >= card_height - join;
    let can_open_left = orb.x - bounds.left >= card_width - join;
    let can_open_right = bounds.right - (orb.x + orb_width) >= card_width - join;
    let placement = if center_y > display_center_y && can_open_above {
        ExpandedPlacement::Above
    } else if center_y <= display_center_y && can_open_below {
        ExpandedPlacement::Below
    } else if can_open_above {
        ExpandedPlacement::Above
    } else if can_open_below {
        ExpandedPlacement::Below
    } else if center_x > display_center_x && can_open_left {
        ExpandedPlacement::Left
    } else if center_x <= display_center_x && can_open_right {
        ExpandedPlacement::Right
    } else if can_open_left {
        ExpandedPlacement::Left
    } else {
        ExpandedPlacement::Right
    };
    let (window_width, window_height) = expanded_dimensions(placement, scale);

    let desired = match placement {
        ExpandedPlacement::Above => WindowPosition { x: center_x - window_width / 2, y: orb.y + orb_height - window_height },
        ExpandedPlacement::Below => WindowPosition { x: center_x - window_width / 2, y: orb.y },
        ExpandedPlacement::Left => WindowPosition { x: orb.x + orb_width - window_width, y: center_y - window_height / 2 },
        ExpandedPlacement::Right => WindowPosition { x: orb.x, y: center_y - window_height / 2 },
    };
    let window_position = clamp_position(desired, window_width, window_height, bounds);
    let orb_x = (orb.x - window_position.x) as f64 / scale;
    let orb_y = (orb.y - window_position.y) as f64 / scale;
    let centered_panel_x = (orb_x + (COMPACT_WIDTH - 272.0) / 2.0)
        .clamp(0.0, (window_width - card_width) as f64 / scale);
    let centered_panel_y = (orb_y + (COMPACT_HEIGHT - 424.0) / 2.0)
        .clamp(0.0, (window_height - card_height) as f64 / scale);
    let (panel_x, panel_y) = match placement {
        ExpandedPlacement::Above => (centered_panel_x, (orb_y - 423.0).clamp(0.0, (window_height - card_height) as f64 / scale)),
        ExpandedPlacement::Below => (centered_panel_x, (orb_y + COMPACT_HEIGHT - 1.0).clamp(0.0, (window_height - card_height) as f64 / scale)),
        ExpandedPlacement::Left => ((orb_x - 271.0).clamp(0.0, (window_width - card_width) as f64 / scale), centered_panel_y),
        ExpandedPlacement::Right => ((orb_x + COMPACT_WIDTH - 1.0).clamp(0.0, (window_width - card_width) as f64 / scale), centered_panel_y),
    };

    (window_position, SurfaceLayout { orb_x, orb_y, panel_x, panel_y, placement, edge: None })
}

fn expanded_orb_position(window_position: WindowPosition, layout: SurfaceLayout, scale: f64) -> WindowPosition {
    WindowPosition {
        x: window_position.x + (layout.orb_x * scale).round() as i32,
        y: window_position.y + (layout.orb_y * scale).round() as i32,
    }
}

fn settle_expanded_layout(
    released_window: WindowPosition,
    current_layout: SurfaceLayout,
    bounds: DisplayBounds,
    scale: f64,
) -> (WindowPosition, WindowPosition, SurfaceLayout) {
    let released_orb = expanded_orb_position(released_window, current_layout, scale);
    let orb_width = (COMPACT_WIDTH * scale).round() as i32;
    let orb_height = (COMPACT_HEIGHT * scale).round() as i32;
    let (orb, _) = free_position(released_orb, orb_width, orb_height, bounds);
    let window_position = WindowPosition {
        x: released_window.x + orb.x - released_orb.x,
        y: released_window.y + orb.y - released_orb.y,
    };
    (orb, window_position, current_layout)
}

fn expanded_panel_fits(window: WindowPosition, layout: SurfaceLayout, bounds: DisplayBounds, scale: f64) -> bool {
    let panel_left = window.x + (layout.panel_x * scale).round() as i32;
    let panel_top = window.y + (layout.panel_y * scale).round() as i32;
    let panel_width = (272.0 * scale).round() as i32;
    let panel_height = (424.0 * scale).round() as i32;
    panel_left >= bounds.left
        && panel_top >= bounds.top
        && panel_left + panel_width <= bounds.right
        && panel_top + panel_height <= bounds.bottom
}

fn adaptive_expanded_layout(
    window: WindowPosition,
    current_layout: SurfaceLayout,
    orb: WindowPosition,
    bounds: DisplayBounds,
    scale: f64,
) -> Option<(WindowPosition, SurfaceLayout)> {
    let (target, layout) = expanded_surface_layout(orb, bounds, scale);
    (layout.placement != current_layout.placement || !expanded_panel_fits(window, current_layout, bounds, scale))
        .then_some((target, layout))
}

fn persist_orb_position(state: &AppState, position: WindowPosition) -> Result<(), String> {
    let mut settings_guard = state.settings.lock().map_err(|error| error.to_string())?;
    let mut settings = settings_guard.clone();
    settings.window_position = Some(position);
    settings.surface_version = 3;
    state.store.save(&settings)?;
    *settings_guard = settings;
    *state.orb_position.lock().map_err(|error| error.to_string())? = Some(position);
    Ok(())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    state.settings.lock().map(|value| value.clone()).map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_settings(window: WebviewWindow, state: State<'_, AppState>, mut settings: Settings) -> Result<Settings, String> {
    settings.opacity = settings.opacity.clamp(0.70, 1.0);
    let mut settings_guard = state.settings.lock().map_err(|error| error.to_string())?;
    let previous = settings_guard.clone();
    // Consent is security-sensitive and may only change through set_codex_enabled.
    settings.codex_enabled = previous.codex_enabled;
    if previous.startup_behavior != settings.startup_behavior {
        configure_autostart(window.app_handle(), settings.startup_behavior)?;
    }
    window.set_always_on_top(settings.always_on_top).map_err(|error| error.to_string())?;
    window.set_ignore_cursor_events(settings.click_through).map_err(|error| error.to_string())?;
    if let Err(error) = state.store.save(&settings) {
        if previous.startup_behavior != settings.startup_behavior {
            let _ = configure_autostart(window.app_handle(), previous.startup_behavior);
        }
        return Err(error);
    }
    *settings_guard = settings.clone();
    drop(settings_guard);
    sync_codex_monitor(window.app_handle(), state.inner(), settings.startup_behavior);
    if settings.visibility_mode == VisibilityMode::Tray {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
fn set_codex_enabled(state: State<'_, AppState>, enabled: bool) -> Result<Settings, String> {
    let mut settings_guard = state.settings.lock().map_err(|error| error.to_string())?;
    let mut settings = settings_guard.clone();
    let changed = settings.codex_enabled != enabled;
    settings.codex_enabled = enabled;
    state.store.save(&settings)?;
    *settings_guard = settings.clone();
    if changed {
        state.consent_generation.fetch_add(1, Ordering::AcqRel);
    }
    if !enabled {
        *state.cache.lock().map_err(|error| error.to_string())? = None;
    }
    Ok(settings)
}

#[tauri::command]
async fn drag_orb(window: WebviewWindow, state: State<'_, AppState>) -> Result<DragOutcome, String> {
    let _geometry = state.geometry.lock().await;
    #[cfg(target_os = "windows")]
    if !primary_pointer_is_down() {
        return Ok(DragOutcome { moved: false, settled: None, layout: None });
    }

    let before = window.outer_position().map_err(|error| error.to_string())?;
    window.start_dragging().map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    {
        for _ in 0..3_000 {
            if !primary_pointer_is_down() { break; }
            sleep(Duration::from_millis(10)).await;
        }
    }
    #[cfg(not(target_os = "windows"))]
    sleep(Duration::from_millis(80)).await;

    sleep(Duration::from_millis(24)).await;
    let after = window.outer_position().map_err(|error| error.to_string())?;
    let moved = (after.x - before.x).abs() >= 2 || (after.y - before.y).abs() >= 2;
    if !moved {
        return Ok(DragOutcome { moved: false, settled: None, layout: None });
    }

    let (settled, layout) = settle_orb_position_inner(&window, state.inner(), after.x, after.y)?;
    Ok(DragOutcome { moved: true, settled: Some(settled), layout })
}

async fn set_window_surface_inner(window: &WebviewWindow, state: &AppState, requested_surface: Option<WindowSurface>) -> Result<SurfaceLayout, String> {
    let _geometry = state.geometry.lock().await;
    let current_surface = *state.surface.lock().map_err(|error| error.to_string())?;
    let surface = requested_surface.unwrap_or(current_surface);
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    if state.retracted.lock().map_err(|error| error.to_string())?.take().is_some() {
        if let Some(anchor) = *state.orb_position.lock().map_err(|error| error.to_string())? {
            window.set_position(PhysicalPosition::new(anchor.x, anchor.y)).map_err(|error| error.to_string())?;
        }
    }
    let current_position = window.outer_position().map_err(|error| error.to_string())?;
    let (default_width, default_height) = physical_dimensions(surface, scale);
    let current = WindowPosition { x: current_position.x, y: current_position.y };

    if current_surface == WindowSurface::Compact && surface != WindowSurface::Compact {
        persist_orb_position(state, current)?;
    }

    let saved_orb = *state.orb_position.lock().map_err(|error| error.to_string())?;
    let legacy_position = state.settings.lock().map_err(|error| error.to_string())?.surface_version < 3;
    let (target, layout, target_width, target_height) = match surface {
        WindowSurface::Compact => {
            let anchor = saved_orb
                .map(|position| if legacy_position { legacy_orb_anchor_to_compact_window(position, scale) } else { position })
                .unwrap_or(current);
            let bounds = display_for_point(&window, anchor.x + default_width / 2, anchor.y + default_height / 2)?;
            let (target, edge) = free_position(anchor, default_width, default_height, bounds);
            (target, SurfaceLayout { orb_x: 0.0, orb_y: 0.0, panel_x: 0.0, panel_y: 31.0, placement: ExpandedPlacement::Below, edge }, default_width, default_height)
        }
        WindowSurface::Expanded => {
            let orb = saved_orb.unwrap_or(current);
            let bounds = display_for_point(&window, orb.x, orb.y)?;
            let (target, layout) = expanded_surface_layout(orb, bounds, scale);
            let (width, height) = expanded_dimensions(layout.placement, scale);
            (target, layout, width, height)
        }
        WindowSurface::Onboarding => {
            let bounds = display_for_point(&window, current.x, current.y)?;
            (clamp_position(current, default_width, default_height, bounds), SurfaceLayout { orb_x: 0.0, orb_y: 0.0, panel_x: 0.0, panel_y: 0.0, placement: ExpandedPlacement::Below, edge: None }, default_width, default_height)
        }
    };

    window.set_size(PhysicalSize::new(target_width as u32, target_height as u32)).map_err(|error| error.to_string())?;
    window.set_position(PhysicalPosition::new(target.x, target.y)).map_err(|error| error.to_string())?;
    *state.surface_layout.lock().map_err(|error| error.to_string())? = layout;
    *state.surface.lock().map_err(|error| error.to_string())? = surface;
    if surface == WindowSurface::Compact {
        persist_orb_position(state, target)?;
    }
    Ok(layout)
}

#[tauri::command]
async fn set_window_surface(window: WebviewWindow, state: State<'_, AppState>, surface: WindowSurface) -> Result<SurfaceLayout, String> {
    set_window_surface_inner(&window, state.inner(), Some(surface)).await
}

async fn move_native_window(window: &WebviewWindow, from: WindowPosition, to: WindowPosition, animate: bool) -> Result<(), String> {
    if !animate || from == to {
        return window.set_position(PhysicalPosition::new(to.x, to.y)).map_err(|error| error.to_string());
    }
    for step in 1..=8 {
        sleep(Duration::from_millis(12)).await;
        let progress = step as f64 / 8.0;
        let eased = 1.0 - (1.0 - progress).powi(3);
        let x = from.x as f64 + (to.x - from.x) as f64 * eased;
        let y = from.y as f64 + (to.y - from.y) as f64 * eased;
        window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn set_native_window_rect(window: &WebviewWindow, position: WindowPosition, width: i32, height: i32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                position.x,
                position.y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOZORDER,
            )
        }.map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        window.set_size(PhysicalSize::new(width as u32, height as u32)).map_err(|error| error.to_string())?;
        window.set_position(PhysicalPosition::new(position.x, position.y)).map_err(|error| error.to_string())
    }
}

#[tauri::command]
async fn apply_expanded_layout(
    window: WebviewWindow,
    state: State<'_, AppState>,
    animate: bool,
) -> Result<SurfaceLayout, String> {
    let _geometry = state.geometry.lock().await;
    if *state.surface.lock().map_err(|error| error.to_string())? != WindowSurface::Expanded {
        return Err("The expanded surface is not active".to_owned());
    }
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let current = window.outer_position().map_err(|error| error.to_string())?;
    let current = WindowPosition { x: current.x, y: current.y };
    let current_layout = *state.surface_layout.lock().map_err(|error| error.to_string())?;
    let orb = state.orb_position.lock().map_err(|error| error.to_string())?
        .unwrap_or_else(|| expanded_orb_position(current, current_layout, scale));
    let orb_width = (COMPACT_WIDTH * scale).round() as i32;
    let orb_height = (COMPACT_HEIGHT * scale).round() as i32;
    let bounds = display_for_point(&window, orb.x + orb_width / 2, orb.y + orb_height / 2)?;
    let (target, layout) = expanded_surface_layout(orb, bounds, scale);
    let (width, height) = expanded_dimensions(layout.placement, scale);
    window.set_size(PhysicalSize::new(width as u32, height as u32)).map_err(|error| error.to_string())?;
    move_native_window(&window, current, target, animate).await?;
    *state.surface_layout.lock().map_err(|error| error.to_string())? = layout;
    Ok(layout)
}

#[tauri::command]
async fn commit_compact_surface(
    window: WebviewWindow,
    state: State<'_, AppState>,
    status: DashboardStatus,
    refreshing: bool,
) -> Result<SurfaceLayout, String> {
    let _geometry = state.geometry.lock().await;
    if *state.surface.lock().map_err(|error| error.to_string())? != WindowSurface::Expanded {
        return Ok(*state.surface_layout.lock().map_err(|error| error.to_string())?);
    }
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let current = window.outer_position().map_err(|error| error.to_string())?;
    let current = WindowPosition { x: current.x, y: current.y };
    let layout = *state.surface_layout.lock().map_err(|error| error.to_string())?;
    let saved = state.orb_position.lock().map_err(|error| error.to_string())?
        .unwrap_or_else(|| expanded_orb_position(current, layout, scale));
    let (width, height) = physical_dimensions(WindowSurface::Compact, scale);
    let bounds = display_for_point(&window, saved.x + width / 2, saved.y + height / 2)?;
    let (target, _) = free_position(saved, width, height, bounds);
    if target != saved {
        persist_orb_position(state.inner(), target)?;
    }
    let compact_layout = SurfaceLayout {
        orb_x: 0.0,
        orb_y: 0.0,
        panel_x: 0.0,
        panel_y: 31.0,
        placement: ExpandedPlacement::Below,
        edge: free_position(target, width, height, bounds).1,
    };
    let handoff = window.app_handle().get_webview_window("compact-handoff");
    if let Some(handoff) = handoff.as_ref() {
        set_native_window_rect(handoff, target, width, height)?;
        let payload = CompactHandoffPayload {
            status,
            settings: state.settings.lock().map_err(|error| error.to_string())?.clone(),
            refreshing,
        };
        window.app_handle().emit_to("compact-handoff", "halo://compact-handoff", payload)
            .map_err(|error| error.to_string())?;
        sleep(Duration::from_millis(40)).await;
        handoff.show().map_err(|error| error.to_string())?;
        sleep(Duration::from_millis(18)).await;
    }

    set_native_window_rect(&window, target, width, height)?;
    *state.surface_layout.lock().map_err(|error| error.to_string())? = compact_layout;
    *state.surface.lock().map_err(|error| error.to_string())? = WindowSurface::Compact;
    persist_orb_position(state.inner(), target)?;
    Ok(compact_layout)
}

#[tauri::command]
fn finish_compact_handoff(window: WebviewWindow) -> Result<(), String> {
    if let Some(handoff) = window.app_handle().get_webview_window("compact-handoff") {
        handoff.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_orb_retracted(
    window: WebviewWindow,
    state: State<'_, AppState>,
    retracted: bool,
    edge: Option<DockEdge>,
    animate: bool,
) -> Result<SettledOrb, String> {
    let _geometry = state.geometry.lock().await;
    let surface = *state.surface.lock().map_err(|error| error.to_string())?;
    let current = window.outer_position().map_err(|error| error.to_string())?;
    let current = WindowPosition { x: current.x, y: current.y };
    let saved = *state.orb_position.lock().map_err(|error| error.to_string())?;

    if surface != WindowSurface::Compact {
        *state.retracted.lock().map_err(|error| error.to_string())? = None;
        return Ok(SettledOrb { x: saved.unwrap_or(current).x, y: saved.unwrap_or(current).y, edge: None });
    }

    let size = window.outer_size().map_err(|error| error.to_string())?;
    let width = size.width as i32;
    let height = size.height as i32;
    let anchor = saved.unwrap_or(current);
    let bounds = display_for_point(&window, anchor.x + width / 2, anchor.y + height / 2)?;
    let (anchor, detected_edge) = free_position(anchor, width, height, bounds);
    persist_orb_position(state.inner(), anchor)?;

    if !retracted {
        move_native_window(&window, current, anchor, animate).await?;
        *state.retracted.lock().map_err(|error| error.to_string())? = None;
        return Ok(SettledOrb { x: anchor.x, y: anchor.y, edge: detected_edge });
    }

    let edge = edge.or(detected_edge).ok_or_else(|| "The orb is not touching a display edge".to_owned())?;
    let handle = (8.0 * window.scale_factor().map_err(|error| error.to_string())?).round() as i32;
    let target = retracted_position(anchor, width, height, bounds, edge, handle);
    move_native_window(&window, current, target, animate).await?;
    *state.retracted.lock().map_err(|error| error.to_string())? = Some(edge);
    Ok(SettledOrb { x: anchor.x, y: anchor.y, edge: Some(edge) })
}

fn resolve_compact_position(window: &WebviewWindow, x: i32, y: i32) -> Result<(WindowPosition, Option<DockEdge>), String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let width = size.width as i32;
    let height = size.height as i32;
    let bounds = display_for_point(&window, x + width / 2, y + height / 2)?;
    Ok(free_position(WindowPosition { x, y }, width, height, bounds))
}

fn settle_orb_position_inner(window: &WebviewWindow, state: &AppState, x: i32, y: i32) -> Result<(SettledOrb, Option<SurfaceLayout>), String> {
    let surface = *state.surface.lock().map_err(|error| error.to_string())?;
    if surface == WindowSurface::Expanded {
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let layout = *state.surface_layout.lock().map_err(|error| error.to_string())?;
        let released_window = WindowPosition { x, y };
        let released_orb = expanded_orb_position(released_window, layout, scale);
        let orb_width = (COMPACT_WIDTH * scale).round() as i32;
        let orb_height = (COMPACT_HEIGHT * scale).round() as i32;
        let bounds = display_for_point(window, released_orb.x + orb_width / 2, released_orb.y + orb_height / 2)?;
        let (position, window_position, current_layout) = settle_expanded_layout(released_window, layout, bounds, scale);
        window.set_position(PhysicalPosition::new(window_position.x, window_position.y)).map_err(|error| error.to_string())?;
        persist_orb_position(state, position)?;
        let suggested = adaptive_expanded_layout(window_position, current_layout, position, bounds, scale)
            .map(|(_, layout)| layout);
        return Ok((SettledOrb { x: position.x, y: position.y, edge: None }, suggested));
    }
    if surface != WindowSurface::Compact {
        return Ok((SettledOrb { x, y, edge: None }, None));
    }
    let (position, edge) = resolve_compact_position(window, x, y)?;
    window.set_position(PhysicalPosition::new(position.x, position.y)).map_err(|error| error.to_string())?;
    persist_orb_position(state, position)?;
    Ok((SettledOrb { x: position.x, y: position.y, edge }, None))
}

#[tauri::command]
async fn refresh_status(state: State<'_, AppState>) -> Result<DashboardStatus, String> {
    let captured_generation = {
        let settings = state.settings.lock().map_err(|error| error.to_string())?;
        if !settings.codex_enabled {
            return Ok(DashboardStatus::disabled());
        }
        state.consent_generation.load(Ordering::Acquire)
    };
    let refreshed = status::refresh(true).await;
    // Hold the settings lock through the cache decision. Disable uses the same lock,
    // increments the generation, and clears the cache, so stale work cannot win.
    let settings = state.settings.lock().map_err(|error| error.to_string())?;
    if !consent_is_current(
        settings.codex_enabled,
        state.consent_generation.load(Ordering::Acquire),
        captured_generation,
    ) {
        return Ok(DashboardStatus::disabled());
    }
    match refreshed {
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
fn start_codex_login(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let settings = state.settings.lock().map_err(|error| error.to_string())?;
    require_codex_consent(settings.codex_enabled)?;
    codexhalo_codex_client::launch_login().map_err(|error| error.to_string())?;
    Ok(None)
}

fn show_window(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(window) = app.get_webview_window("main") else { return };
        let state = app.state::<AppState>();
        let _ = set_window_surface_inner(&window, state.inner(), None).await;
        let _ = window.set_ignore_cursor_events(false);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("halo://reveal", ());
    });
}

fn requires_autostart(behavior: StartupBehavior) -> bool {
    behavior != StartupBehavior::Off
}

fn launched_from_autostart() -> bool {
    std::env::args_os().any(|argument| argument == "--autostart")
}

fn should_reveal_for_process_transition(was_running: bool, is_running: bool) -> bool {
    !was_running && is_running
}

#[cfg(target_os = "windows")]
fn configure_autostart(app: &AppHandle, behavior: StartupBehavior) -> Result<(), String> {
    let manager = app.autolaunch();
    let enabled = manager.is_enabled().map_err(|error| error.to_string())?;
    if requires_autostart(behavior) && !enabled {
        manager.enable().map_err(|error| error.to_string())?;
    } else if !requires_autostart(behavior) && enabled {
        manager.disable().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn configure_autostart(_app: &AppHandle, behavior: StartupBehavior) -> Result<(), String> {
    (behavior == StartupBehavior::Off).then_some(())
        .ok_or_else(|| "Startup behavior is only available on Windows in CodexHalo v1".to_owned())
}

fn sync_codex_monitor(app: &AppHandle, state: &AppState, behavior: StartupBehavior) {
    let Ok(mut monitor) = state.startup_monitor.lock() else { return };
    if let Some(task) = monitor.take() {
        task.abort();
    }
    #[cfg(target_os = "windows")]
    if behavior == StartupBehavior::ShowWhenCodexStarts {
        let app = app.clone();
        *monitor = Some(tauri::async_runtime::spawn(async move {
            let mut ticker = interval(Duration::from_secs(10));
            ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
            let mut was_running = false;
            loop {
                ticker.tick().await;
                let is_running = tauri::async_runtime::spawn_blocking(|| {
                    windows_startup::codex_process_is_running(std::process::id())
                }).await.unwrap_or(false);
                if should_reveal_for_process_transition(was_running, is_running) {
                    show_window(&app);
                }
                was_running = is_running;
            }
        }));
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
    let Ok(size) = window.outer_size() else { return };
    let Ok(bounds) = display_for_point(window, position.x, position.y) else { return };
    let recovered = clamp_position(position, size.width as i32, size.height as i32, bounds);
    let _ = window.set_position(PhysicalPosition::new(recovered.x, recovered.y));
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("CodexHalo")
                .arg("--autostart")
                .build(),
        )
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
            if let Err(error) = configure_autostart(app.handle(), settings.startup_behavior) {
                eprintln!("Could not synchronize Windows startup behavior: {error}");
            }
            let autostart_launch = launched_from_autostart();
            if autostart_launch && settings.startup_behavior == StartupBehavior::Off {
                if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
                app.handle().exit(0);
                return Ok(());
            }
            let shortcut = settings.shortcut.clone();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
                let _ = window.set_always_on_top(settings.always_on_top);
                restore_position(&window, settings.window_position.clone());
                if autostart_launch && settings.startup_behavior == StartupBehavior::ShowWhenCodexStarts {
                    let _ = window.hide();
                }
            }
            let startup_behavior = settings.startup_behavior;
            app.manage(AppState {
                orb_position: Mutex::new(settings.window_position),
                settings: Mutex::new(settings),
                consent_generation: AtomicU64::new(0),
                store,
                cache: Mutex::new(None),
                geometry: tokio::sync::Mutex::new(()),
                surface: Mutex::new(WindowSurface::Onboarding),
                surface_layout: Mutex::new(SurfaceLayout { orb_x: 0.0, orb_y: 0.0, panel_x: 0.0, panel_y: 0.0, placement: ExpandedPlacement::Below, edge: None }),
                retracted: Mutex::new(None),
                startup_monitor: Mutex::new(None),
            });
            let handoff = WebviewWindowBuilder::new(
                app,
                "compact-handoff",
                WebviewUrl::App("index.html?surface=handoff".into()),
            )
            .title("CodexHalo handoff")
            .inner_size(COMPACT_WIDTH, COMPACT_HEIGHT)
            .min_inner_size(COMPACT_WIDTH, COMPACT_HEIGHT)
            .decorations(false)
            .transparent(true)
            .background_color(Color(0, 0, 0, 0))
            .always_on_top(true)
            .resizable(false)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .build()?;
            let _ = handoff.set_ignore_cursor_events(true);
            if let Err(error) = app.global_shortcut().register(shortcut.as_str()) {
                eprintln!("Could not register global shortcut {shortcut}: {error}");
            }
            setup_tray(app)?;
            sync_codex_monitor(app.handle(), app.state::<AppState>().inner(), startup_behavior);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings, hide_window, set_settings, set_codex_enabled, refresh_status,
            start_codex_login, set_window_surface, set_orb_retracted, apply_expanded_layout,
            commit_compact_surface, finish_compact_handoff, drag_orb
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CodexHalo");
}

#[cfg(test)]
mod geometry_tests {
    use super::*;

    const DISPLAY: DisplayBounds = DisplayBounds { left: 0, top: 0, right: 1920, bottom: 1080 };

    #[test]
    fn startup_registration_and_reveal_edges_are_explicit() {
        assert!(!requires_autostart(StartupBehavior::Off));
        assert!(requires_autostart(StartupBehavior::StartWithWindows));
        assert!(requires_autostart(StartupBehavior::ShowWhenCodexStarts));
        assert!(should_reveal_for_process_transition(false, true));
        assert!(!should_reveal_for_process_transition(true, true));
        assert!(!should_reveal_for_process_transition(true, false));
    }

    #[test]
    fn stale_refresh_generation_is_rejected_after_consent_changes() {
        let generation = AtomicU64::new(7);
        let captured = generation.load(Ordering::Acquire);
        assert!(consent_is_current(true, generation.load(Ordering::Acquire), captured));

        generation.fetch_add(1, Ordering::AcqRel);
        assert!(!consent_is_current(true, generation.load(Ordering::Acquire), captured));
        assert!(!consent_is_current(false, captured, captured));
    }

    #[test]
    fn backend_codex_actions_require_explicit_consent() {
        assert!(require_codex_consent(false).is_err());
        assert!(require_codex_consent(true).is_ok());
    }

    #[test]
    fn capsule_keeps_near_edge_positions_free() {
        let original = WindowPosition { x: 9, y: 420 };
        let (position, edge) = free_position(original, 148, 32, DISPLAY);
        assert_eq!(position, original);
        assert!(edge.is_none());
    }

    #[test]
    fn capsule_docks_only_when_it_reaches_the_display_boundary() {
        let (position, edge) = free_position(WindowPosition { x: -12, y: 420 }, 148, 32, DISPLAY);
        assert_eq!(position, WindowPosition { x: 0, y: 420 });
        assert!(matches!(edge, Some(DockEdge::Left)));
    }

    #[test]
    fn native_retraction_leaves_only_the_requested_handle_inside_the_work_area() {
        let anchor = WindowPosition { x: 0, y: 420 };
        assert_eq!(retracted_position(anchor, 148, 32, DISPLAY, DockEdge::Left, 8), WindowPosition { x: -140, y: 420 });
        assert_eq!(
            retracted_position(WindowPosition { x: 1772, y: 420 }, 148, 32, DISPLAY, DockEdge::Right, 8),
            WindowPosition { x: 1912, y: 420 },
        );
    }

    #[test]
    fn expanded_card_grows_above_a_lower_screen_capsule_without_moving_it() {
        let capsule = WindowPosition { x: 880, y: 900 };
        let (position, layout) = expanded_surface_layout(capsule, DISPLAY, 1.0);
        assert_eq!(position, WindowPosition { x: 814, y: 468 });
        assert_eq!(layout.orb_x, 66.0);
        assert_eq!(layout.orb_y, 432.0);
        assert_eq!(layout.panel_x, 4.0);
        assert_eq!(layout.panel_y, 9.0);
        assert_eq!(layout.placement, ExpandedPlacement::Above);
        assert_eq!(expanded_orb_position(position, layout, 1.0), capsule);
    }

    #[test]
    fn expanded_drag_persists_the_orb_anchor_not_the_window_origin() {
        let layout = SurfaceLayout { orb_x: 66.0, orb_y: 0.0, panel_x: 4.0, panel_y: 31.0, placement: ExpandedPlacement::Below, edge: None };
        let orb = expanded_orb_position(WindowPosition { x: 100, y: 200 }, layout, 1.5);
        assert_eq!(orb, WindowPosition { x: 199, y: 200 });
    }

    #[test]
    fn open_close_round_trip_preserves_free_orb_positions_at_multiple_dpi_scales() {
        let positions = [
            WindowPosition { x: 39, y: 589 },
            WindowPosition { x: 720, y: 160 },
            WindowPosition { x: 1700, y: 780 },
        ];
        for scale in [1.0, 1.25, 2.0] {
            for orb in positions {
                let (window, layout) = expanded_surface_layout(orb, DISPLAY, scale);
                assert_eq!(expanded_orb_position(window, layout, scale), orb);
            }
        }
    }

    #[test]
    fn expanded_drag_preserves_the_released_native_window_when_the_orb_is_in_bounds() {
        for scale in [1.0_f64, 1.25, 1.5, 2.0] {
            let original_orb = WindowPosition { x: 720, y: 300 };
            let (original_window, original_layout) = expanded_surface_layout(original_orb, DISPLAY, scale);
            let released_window = WindowPosition { x: original_window.x + 180, y: original_window.y + 140 };
            let expected_orb = expanded_orb_position(released_window, original_layout, scale);
            let (orb, window, layout) = settle_expanded_layout(released_window, original_layout, DISPLAY, scale);
            assert_eq!(orb, expected_orb);
            assert_eq!(window, released_window);
            assert_eq!(layout.orb_x, original_layout.orb_x);
            assert_eq!(layout.orb_y, original_layout.orb_y);
            assert_eq!(expanded_orb_position(window, layout, scale), expected_orb);
        }
    }

    #[test]
    fn expanded_drag_clamps_only_the_orb_when_it_crosses_the_work_area() {
        let layout = SurfaceLayout { orb_x: 66.0, orb_y: 0.0, panel_x: 4.0, panel_y: 31.0, placement: ExpandedPlacement::Below, edge: None };
        let released_window = WindowPosition { x: -400, y: -80 };
        let (orb, window, settled_layout) = settle_expanded_layout(released_window, layout, DISPLAY, 1.0);
        assert_eq!(orb, WindowPosition { x: 0, y: 0 });
        assert_eq!(expanded_orb_position(window, settled_layout, 1.0), orb);
    }

    #[test]
    fn expanded_drag_suggests_the_opposite_vertical_direction_after_crossing_the_display_midpoint() {
        let original_orb = WindowPosition { x: 800, y: 900 };
        let (original_window, layout) = expanded_surface_layout(original_orb, DISPLAY, 1.0);
        assert_eq!(layout.placement, ExpandedPlacement::Above);
        let released_window = WindowPosition { x: original_window.x, y: original_window.y - 700 };
        let orb = expanded_orb_position(released_window, layout, 1.0);
        let (target, suggested) = adaptive_expanded_layout(released_window, layout, orb, DISPLAY, 1.0)
            .expect("crossing into the upper half should move the card below the capsule");
        assert_eq!(suggested.placement, ExpandedPlacement::Below);
        assert_eq!(expanded_orb_position(target, suggested, 1.0), orb);
    }

    #[test]
    fn expanded_drag_keeps_its_layout_when_the_card_remains_visible_on_the_same_vertical_side() {
        let orb = WindowPosition { x: 800, y: 900 };
        let (window, layout) = expanded_surface_layout(orb, DISPLAY, 1.0);
        assert_eq!(layout.placement, ExpandedPlacement::Above);
        assert!(adaptive_expanded_layout(window, layout, orb, DISPLAY, 1.0).is_none());
    }

    #[test]
    fn middle_band_opens_laterally_without_overlapping_the_capsule() {
        let short_display = DisplayBounds { left: 0, top: 0, right: 1920, bottom: 720 };

        let left_capsule = WindowPosition { x: 900, y: 344 };
        let (left_window, left_layout) = expanded_surface_layout(left_capsule, short_display, 1.0);
        assert_eq!(left_layout.placement, ExpandedPlacement::Left);
        assert_eq!(left_window, WindowPosition { x: 620, y: 144 });
        assert_eq!(left_layout.orb_x, 280.0);
        assert_eq!(left_layout.panel_x, 9.0);
        assert_eq!(left_layout.panel_x + 272.0, left_layout.orb_x + 1.0);

        let right_capsule = WindowPosition { x: 700, y: 344 };
        let (right_window, right_layout) = expanded_surface_layout(right_capsule, short_display, 1.0);
        assert_eq!(right_layout.placement, ExpandedPlacement::Right);
        assert_eq!(right_window, WindowPosition { x: 700, y: 144 });
        assert_eq!(right_layout.orb_x, 0.0);
        assert_eq!(right_layout.panel_x, 147.0);
        assert_eq!(right_layout.orb_x + COMPACT_WIDTH, right_layout.panel_x + 1.0);
    }

    #[test]
    fn missing_display_positions_recover_inside_the_active_display() {
        let position = clamp_position(WindowPosition { x: 2400, y: -300 }, 148, 32, DISPLAY);
        assert_eq!(position, WindowPosition { x: 1772, y: 0 });
    }

    #[test]
    fn onboarding_restore_uses_the_current_surface_dimensions() {
        assert_eq!(physical_dimensions(WindowSurface::Onboarding, 1.0), (404, 620));
        assert_eq!(physical_dimensions(WindowSurface::Compact, 1.0), (148, 32));
        assert_ne!(
            physical_dimensions(WindowSurface::Onboarding, 1.25),
            physical_dimensions(WindowSurface::Compact, 1.25),
        );
        let compact_anchor = WindowPosition { x: 1772, y: 1048 };
        let restored = clamp_position(compact_anchor, 404, 620, DISPLAY);
        assert_eq!(restored, WindowPosition { x: 1516, y: 460 });
        assert_eq!(compact_anchor, WindowPosition { x: 1772, y: 1048 });
    }

    #[test]
    fn legacy_orb_anchor_migrates_to_the_smaller_capsule_without_center_jump() {
        for scale in [1.0_f64, 1.25, 1.5, 2.0] {
            let old_capsule = WindowPosition { x: 320, y: 240 };
            let legacy_orb = WindowPosition {
                x: old_capsule.x + ((170.0 - 44.0) * scale / 2.0).round() as i32,
                y: old_capsule.y + ((36.0 - 44.0) * scale / 2.0).round() as i32,
            };
            let expected = WindowPosition {
                x: old_capsule.x + ((170.0 - COMPACT_WIDTH) * scale / 2.0).round() as i32,
                y: old_capsule.y + ((36.0 - COMPACT_HEIGHT) * scale / 2.0).round() as i32,
            };
            assert_eq!(legacy_orb_anchor_to_compact_window(legacy_orb, scale), expected);
        }
    }
}
