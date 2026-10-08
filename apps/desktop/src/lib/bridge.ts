import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { defaultSettings, type DashboardStatus, type Settings, type PricingCatalogStatus } from "../types";

declare global {
  interface Window { __TAURI_INTERNALS__?: unknown }
}

export const isTauri = () => Boolean(window.__TAURI_INTERNALS__);
const storageKey = "codexhalo.preview.settings";

export type WindowSurface = "onboarding" | "compact" | "expanded";
export type DockEdge = "left" | "right" | "top" | "bottom";
export interface SettledOrb { x: number; y: number; edge: DockEdge | null }
export interface DragOutcome { moved: boolean; settled: SettledOrb | null; layout: SurfaceLayout | null }
export interface SurfaceLayout {
  orbX: number;
  orbY: number;
  panelX: number;
  panelY: number;
  placement: "above" | "below" | "left" | "right";
  edge?: DockEdge | null;
}

function previewSettings(): Settings {
  const stored = localStorage.getItem(storageKey);
  return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
}

function demoStatus(): DashboardStatus {
  const now = Math.floor(Date.now() / 1000);
  const result: DashboardStatus = {
    connection: "ready",
    preview: true,
    windows: [
      { id: "primary", durationMinutes: 300, usedPercent: 68, resetsAt: now + 7200 },
      { id: "secondary", durationMinutes: 10080, usedPercent: 57, resetsAt: now + 242400 },
    ],
    tokens: {
      input: 1_284_300,
      cachedInput: 486_200,
      output: 68_420,
      reasoning: 19_800,
      total: 1_352_720,
      byModel: {
        "gpt-6.1-sol": { input: 1_112_000, cachedInput: 421_000, output: 59_200, reasoning: 18_200, total: 1_171_200 },
        "gpt-6-sol": { input: 172_300, cachedInput: 65_200, output: 9_220, reasoning: 1_600, total: 181_520 },
      },
    },
    pricing: { value: 2.33554, unavailableModels: [], version: "2026-10-05", catalogSource: "bundled" },
    updatedAt: Date.now(),
  };
  result.pricing.breakdown = Object.entries(result.tokens.byModel).map(([model, usage]) => {
    const cachedRate = model === "gpt-6.1-sol" ? 0.1 : 0.2;
    const rates = { inputPerMillion: 2, cachedInputPerMillion: cachedRate, cacheWritePerMillion: 2.5, outputPerMillion: 10 };
    const cached = Math.min(usage.input, usage.cachedInput ?? 0);
    const inputValue = (usage.input - cached) * 2 / 1_000_000;
    const cachedInputValue = cached * cachedRate / 1_000_000;
    const outputValue = usage.output * 10 / 1_000_000;
    return { model, usage, rates, value: inputValue + cachedInputValue + outputValue, inputValue, cachedInputValue, outputValue,
      longContext: { inputThreshold: 272_000, rates: { ...rates, inputPerMillion: 4, cachedInputPerMillion: cachedRate * 2, cacheWritePerMillion: 5, outputPerMillion: 15 } } };
  });
  const dateKey = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  const history = Array.from({ length: 365 }, (_, i) => {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - (364 - i));
    const scale = i === 364 ? 1 : (i % 7 === 5 || i % 7 === 6 ? 0.12 : 0.35 + ((i * 17) % 11) / 12);
    const tokens = { ...result.tokens,
      input: Math.round(result.tokens.input * scale), cachedInput: Math.round((result.tokens.cachedInput ?? 0) * scale),
      output: Math.round(result.tokens.output * scale), reasoning: Math.round((result.tokens.reasoning ?? 0) * scale),
      total: Math.round(result.tokens.total * scale), byModel: {} };
    return { date: dateKey(date), tokens, pricing: { ...result.pricing, value: 2.33554 * scale } };
  });
  result.history = history;
  return result;
}

export const bridge = {
  async getSettings(): Promise<Settings> {
    return isTauri() ? invoke("get_settings") : previewSettings();
  },
  async saveSettings(settings: Settings): Promise<Settings> {
    if (isTauri()) return invoke("set_settings", { settings });
    localStorage.setItem(storageKey, JSON.stringify(settings));
    return settings;
  },
  async setCodexEnabled(enabled: boolean): Promise<Settings> {
    if (isTauri()) return invoke("set_codex_enabled", { enabled });
    const next = { ...previewSettings(), codexEnabled: enabled };
    localStorage.setItem(storageKey, JSON.stringify(next));
    return next;
  },
  async refresh(): Promise<DashboardStatus> {
    return isTauri() ? invoke("refresh_status") : demoStatus();
  },
  async getPricingStatus(): Promise<PricingCatalogStatus> {
    return isTauri() ? invoke("get_pricing_status") : { version: "2026-10-05", catalogSource: "bundled" };
  },
  async syncPricing(): Promise<PricingCatalogStatus> {
    return isTauri() ? invoke("refresh_pricing") : { version: "2026-10-05", catalogSource: "bundled", lastCheckedAt: Date.now() };
  },
  async testReminder(): Promise<void> {
    if (isTauri()) await invoke("test_reset_notification");
    else throw new Error("System notifications are available in the desktop app.");
  },
  async startLogin(): Promise<void> {
    if (isTauri()) {
      await invoke("start_codex_login");
      return;
    }
    window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
  },
  async hideWindow() {
    if (isTauri()) return invoke("hide_window");
    window.close();
  },
  async isWindowVisible(): Promise<boolean> {
    if (!isTauri()) return true;
    return getCurrentWindow().isVisible();
  },
  async setSurface(surface: WindowSurface): Promise<SurfaceLayout | null> {
    if (!isTauri()) return surface === "expanded"
      ? { orbX: 66, orbY: 0, panelX: 4, panelY: 31, placement: "below", edge: null }
      : { orbX: 0, orbY: 0, panelX: 0, panelY: 31, placement: "below", edge: null };
    return invoke<SurfaceLayout>("set_window_surface", { surface });
  },
  async startDragging(): Promise<DragOutcome> {
    if (!isTauri()) return { moved: false, settled: null, layout: null };
    return invoke<DragOutcome>("drag_orb");
  },
  async applyExpandedLayout(animate: boolean): Promise<SurfaceLayout | null> {
    if (!isTauri()) return null;
    return invoke<SurfaceLayout>("apply_expanded_layout", { animate });
  },
  async commitCompactSurface(status: DashboardStatus, refreshing: boolean): Promise<SurfaceLayout | null> {
    if (!isTauri()) return { orbX: 0, orbY: 0, panelX: 0, panelY: 31, placement: "below", edge: null };
    return invoke<SurfaceLayout>("commit_compact_surface", {
      status: { connection: status.connection, windows: status.windows, updatedAt: status.updatedAt ?? null }, refreshing,
    });
  },
  async finishCompactHandoff(): Promise<void> {
    if (isTauri()) await invoke("finish_compact_handoff");
  },
  async setEdgeRetracted(retracted: boolean, edge: DockEdge | null, animate: boolean): Promise<SettledOrb | null> {
    if (!isTauri()) return null;
    return invoke<SettledOrb>("set_orb_retracted", { retracted, edge, animate });
  },
  async trackFocus(onFocusChanged: (focused: boolean) => void) {
    if (!isTauri()) return () => {};
    return getCurrentWindow().onFocusChanged(({ payload }) => onFocusChanged(payload));
  },
};
