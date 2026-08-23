import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { defaultSettings, type DashboardStatus, type Settings } from "../types";

declare global {
  interface Window { __TAURI_INTERNALS__?: unknown }
}

export const isTauri = () => Boolean(window.__TAURI_INTERNALS__);
const storageKey = "codexhalo.preview.settings";

function previewSettings(): Settings {
  const stored = localStorage.getItem(storageKey);
  return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
}

function demoStatus(): DashboardStatus {
  const now = Math.floor(Date.now() / 1000);
  return {
    connection: "ready",
    preview: true,
    windows: [
      { id: "primary", durationMinutes: 300, usedPercent: 28, resetsAt: now + 8040 },
      { id: "secondary", durationMinutes: 10080, usedPercent: 57, resetsAt: now + 242400 },
    ],
    tokens: {
      input: 1_284_300,
      cachedInput: 486_200,
      output: 68_420,
      reasoning: 19_800,
      total: 1_858_720,
      byModel: {
        "gpt-5.3-codex": { input: 1_112_000, cachedInput: 421_000, output: 59_200, reasoning: 18_200, total: 1_590_400 },
        "gpt-5.2-codex": { input: 172_300, cachedInput: 65_200, output: 9_220, reasoning: 1_600, total: 268_320 },
      },
    },
    pricing: { value: 2.64, unavailableModels: [], version: "2026-08-23" },
    updatedAt: Date.now(),
  };
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
  async startLogin(): Promise<string | null> {
    return isTauri() ? invoke("start_codex_login") : "https://chatgpt.com/";
  },
  async openExternal(url: string) {
    if (isTauri()) return openUrl(url);
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async resize(expanded: boolean) {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    await window.setSize(new LogicalSize(expanded ? 404 : 352, expanded ? 620 : 92));
  },
  async trackPosition() {
    if (!isTauri()) return () => {};
    const window = getCurrentWindow();
    return window.onMoved(({ payload }) => invoke("save_window_position", { x: payload.x, y: payload.y }));
  },
};
