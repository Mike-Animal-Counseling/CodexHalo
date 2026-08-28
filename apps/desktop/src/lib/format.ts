import type { RateLimitWindow } from "../types";

export const remaining = (window?: RateLimitWindow) =>
  window ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : 0;

export type QuotaTone = "ok" | "warn" | "low";
export const quotaTone = (value?: number | null): QuotaTone =>
  value == null || value >= 70 ? "ok" : value >= 30 ? "warn" : "low";

export const quotaLabel = (minutes: number) => {
  if (minutes === 300) return "5H";
  if (minutes === 10080) return "WEEK";
  if (minutes % 1440 === 0) return `${minutes / 1440}D`;
  if (minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}M`;
};

export const quotaName = (minutes: number) => {
  if (minutes === 300) return "5 hour";
  if (minutes === 10080) return "Weekly";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
};

export function primaryQuotaWindow(windows: RateLimitWindow[], preferredMinutes?: number | null) {
  if (preferredMinutes != null) {
    const preferred = windows.find((window) => window.durationMinutes === preferredMinutes);
    if (preferred) return preferred;
  }
  return windows.reduce<RateLimitWindow | undefined>((longest, window) =>
    !longest || window.durationMinutes > longest.durationMinutes ? window : longest, undefined);
}

export function orderedQuotaWindows(windows: RateLimitWindow[], preferredMinutes?: number | null) {
  const primary = primaryQuotaWindow(windows, preferredMinutes);
  if (!primary) return [];
  return [primary, ...windows.filter((window) => window !== primary)];
}

export const compactNumber = (value: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value);

export const currency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);

export function timeUntil(epochSeconds?: number, now = Date.now()) {
  if (!epochSeconds) return "Reset time unavailable";
  const seconds = Math.max(0, epochSeconds - Math.floor(now / 1000));
  if (seconds === 0) return "Resetting now";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `Resets in ${days}d ${hours}h`;
  if (hours) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${Math.max(1, minutes)}m`;
}

export function freshness(updatedAt?: number, now = Date.now()) {
  if (!updatedAt) return "Not updated yet";
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 5) return "Updated now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.floor(seconds / 60)}m ago`;
}
