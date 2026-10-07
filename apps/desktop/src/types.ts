import type { UsageHistoryDay } from "./lib/history";
export type ThemeMode = "system" | "light" | "dark";
export type HudStyle = "capsule" | "halo";
export type VisibilityMode = "always" | "autoHide" | "tray";
export type StartupBehavior = "off" | "startWithWindows" | "showWhenCodexStarts";
export type ConnectionState = "disabled" | "connecting" | "ready" | "disconnected" | "unauthenticated" | "offline" | "error";

export interface RateLimitWindow {
  id: string;
  durationMinutes: number;
  usedPercent: number;
  resetsAt?: number;
}

export interface ModelUsage {
  input: number;
  cachedInput?: number;
  output: number;
  reasoning?: number;
  total: number;
}

export interface TokenUsage extends ModelUsage {
  byModel: Record<string, ModelUsage>;
}

export interface ModelPricing {
  inputPerMillion: number;
  cachedInputPerMillion?: number | null;
  cacheWritePerMillion?: number | null;
  outputPerMillion: number;
}
export interface ModelEstimate {
  model: string;
  usage: ModelUsage;
  rates?: ModelPricing;
  longContext?: { inputThreshold: number; rates: ModelPricing };
  value?: number;
  inputValue?: number;
  cachedInputValue?: number;
  outputValue?: number;
}
export interface PricingCatalogStatus {
  version: string;
  publishedAt?: string;
  sourceUrl?: string;
  catalogSource?: "bundled" | "cached" | "remote";
  lastCheckedAt?: number;
  lastUpdatedAt?: number;
  refreshError?: string;
}
export interface PricingEstimate extends PricingCatalogStatus {
  value?: number;
  unavailableModels: string[];
  estimatedModels?: string[];
  incomplete?: boolean;
  breakdown?: ModelEstimate[];
  assumptions?: string[];
}

export interface DashboardStatus {
  connection: ConnectionState;
  windows: RateLimitWindow[];
  tokens: TokenUsage;
  pricing: PricingEstimate;
  history?: UsageHistoryDay[];
  updatedAt?: number;
  message?: string;
  preview?: boolean;
}

export interface Settings {
  codexEnabled: boolean;
  visibilityMode: VisibilityMode;
  hudStyle: HudStyle;
  alwaysOnTop: boolean;
  edgeAutoHide: boolean;
  opacity: number;
  clickThrough: boolean;
  showApiEquivalent: boolean;
  showResetCountdown: boolean;
  theme: ThemeMode;
  shortcut: string;
  startupBehavior: StartupBehavior;
  reducedMotion: boolean;
  quotaWindowMinutes: number | null;
  resetReminderEnabled: boolean;
  resetReminderMinutes: number;
  autoSyncPricing: boolean;
  surfaceVersion: number;
}

export const defaultSettings: Settings = {
  codexEnabled: false,
  visibilityMode: "autoHide",
  hudStyle: "halo",
  alwaysOnTop: true,
  edgeAutoHide: true,
  opacity: 0.96,
  clickThrough: false,
  showApiEquivalent: true,
  showResetCountdown: true,
  theme: "system",
  shortcut: "CommandOrControl+Shift+H",
  startupBehavior: "off",
  reducedMotion: false,
  quotaWindowMinutes: null,
  resetReminderEnabled: false,
  resetReminderMinutes: 15,
  autoSyncPricing: true,
  surfaceVersion: 3,
};

export const emptyUsage: TokenUsage = {
  input: 0,
  cachedInput: 0,
  output: 0,
  reasoning: 0,
  total: 0,
  byModel: {},
};
