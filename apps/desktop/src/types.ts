export type ThemeMode = "system" | "light" | "dark";
export type HudStyle = "capsule" | "halo";
export type VisibilityMode = "always" | "autoHide" | "tray";
export type StartupBehavior = "off" | "startWithWindows" | "showWhenCodexStarts";
export type ConnectionState = "disabled" | "connecting" | "ready" | "unauthenticated" | "offline" | "error";

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

export interface PricingEstimate {
  value?: number;
  unavailableModels: string[];
  estimatedModels?: string[];
  version: string;
}

export interface DashboardStatus {
  connection: ConnectionState;
  windows: RateLimitWindow[];
  tokens: TokenUsage;
  pricing: PricingEstimate;
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
