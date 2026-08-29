import type { DashboardStatus } from "../types";

export type DashboardViewState = "disabled" | "connecting" | "disconnected" | "data" | "error";

export function dashboardViewState(status: DashboardStatus): DashboardViewState {
  if (status.connection === "disabled") return "disabled";
  if (status.connection === "connecting") return "connecting";
  if (status.connection === "disconnected" || status.connection === "unauthenticated") return "disconnected";
  if (status.connection === "error" && status.updatedAt == null) return "error";
  return "data";
}
