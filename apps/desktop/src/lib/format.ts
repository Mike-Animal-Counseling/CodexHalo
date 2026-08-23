import type { RateLimitWindow } from "../types";

export const remaining = (window?: RateLimitWindow) =>
  window ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : 0;

export const quotaLabel = (minutes: number) => {
  if (minutes === 300) return "5H";
  if (minutes === 10080) return "WEEK";
  if (minutes % 1440 === 0) return `${minutes / 1440}D`;
  if (minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}M`;
};

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
