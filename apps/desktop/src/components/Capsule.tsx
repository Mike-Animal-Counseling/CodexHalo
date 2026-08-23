import type { DashboardStatus, HudStyle } from "../types";
import { freshness, quotaLabel, remaining } from "../lib/format";
import { HaloMeter } from "./HaloMeter";

export function Capsule({ status, style, refreshing, onExpand }: {
  status: DashboardStatus;
  style: HudStyle;
  refreshing: boolean;
  onExpand: () => void;
}) {
  const primary = status.windows.find((item) => item.durationMinutes === 300) ?? status.windows[0];
  const weekly = status.windows.find((item) => item.durationMinutes === 10080) ?? status.windows[1];
  const primaryRemaining = remaining(primary);
  const weeklyRemaining = remaining(weekly);

  if (style === "halo") {
    return (
      <button className="halo-button" onClick={onExpand} aria-label="Open CodexHalo details">
        <HaloMeter primary={primaryRemaining} secondary={weeklyRemaining} size={86} />
        <span className={`fresh-dot ${refreshing ? "is-refreshing" : ""}`} />
      </button>
    );
  }

  return (
    <button className="capsule" onClick={onExpand} aria-label="Open CodexHalo details">
      <HaloMeter primary={primaryRemaining} secondary={weeklyRemaining} size={48} compact />
      <span className="capsule__metric">
        <small>{primary ? quotaLabel(primary.durationMinutes) : "5H"}</small>
        <strong>{Math.round(primaryRemaining)}<i>%</i></strong>
      </span>
      <span className="capsule__separator"><i className={refreshing ? "is-refreshing" : ""} /></span>
      <span className="capsule__metric">
        <small>{weekly ? quotaLabel(weekly.durationMinutes) : "WEEK"}</small>
        <strong>{Math.round(weeklyRemaining)}<i>%</i></strong>
      </span>
      <span className="capsule__freshness">{freshness(status.updatedAt)}</span>
    </button>
  );
}
