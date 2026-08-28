import { useState } from "react";
import type { DashboardStatus, RateLimitWindow } from "../types";
import { compactNumber, currency, freshness, orderedQuotaWindows, quotaName, quotaTone, remaining, timeUntil } from "../lib/format";
import { InfoIcon, RefreshIcon, SlidersIcon } from "./Icons";
import { QuotaRing } from "./QuotaRing";

function StatRow({ label, value }: { label: string; value: string }) {
  return <div className="panel-stat"><span>{label}</span><b>{value}</b></div>;
}

function QuotaWindowRow({ window, reducedMotion, secondary = false }: {
  window: RateLimitWindow;
  reducedMotion: boolean;
  secondary?: boolean;
}) {
  const label = quotaName(window.durationMinutes);
  const value = Math.round(remaining(window));
  const resetValue = window.resetsAt ? timeUntil(window.resetsAt) : "Reset time unavailable";
  const reset = resetValue.startsWith("Resets in ")
    ? `Resets ${resetValue.slice("Resets in ".length)}`
    : resetValue === "Resetting now" ? "Resets now" : "Reset unavailable";
  const tone = quotaTone(value);

  return <section className={`quota-row ${secondary ? "quota-row--secondary" : ""}`} aria-label={`${label} quota`}>
    <div className="quota-row__labels"><strong>{label}</strong><span>{reset}</span></div>
    <div className="quota-row__meter"><div><i className={tone} data-quota={window.id}
      style={{ width: `${value}%`, transition: reducedMotion ? "none" : undefined }} /></div>
      <b>{value == null ? "—" : `${value}% left`}</b></div>
  </section>;
}

export function ExpandedPanel({ status, refreshing, reducedMotion, quotaWindowMinutes, onRefresh, onSettings }: {
  status: DashboardStatus;
  refreshing: boolean;
  reducedMotion: boolean;
  quotaWindowMinutes?: number | null;
  onRefresh: () => void;
  onSettings: () => void;
}) {
  const [showTip, setShowTip] = useState(false);
  const quotaWindows = orderedQuotaWindows(status.windows, quotaWindowMinutes);
  const focusedWindow = quotaWindows[0];
  const focusedRemaining = focusedWindow ? Math.round(remaining(focusedWindow)) : null;
  const models = Object.entries(status.tokens.byModel).sort((a, b) => b[1].total - a[1].total);
  const apiAvailable = status.pricing.value != null;
  const modelLabel = (model: string) => model === "unknown-codex" ? "Codex · unclassified" : model;

  const manyQuotas = quotaWindows.length > 2;
  const overflowingQuotas = quotaWindows.length > 4;

  return <main className={`panel ${manyQuotas ? "panel--many-quotas" : ""}`} role="dialog" aria-label="CodexHalo details">
    <header className="panel-header">
      <QuotaRing value={focusedRemaining} label={focusedWindow ? quotaName(focusedWindow.durationMinutes) : "Codex"}
        quotaId={focusedWindow?.id ?? "unavailable"} size={48} stroke={2.25} reducedMotion={reducedMotion} />
      <div className="panel-identity"><div><strong>CodexHalo</strong><i className={`connection-dot connection-dot--${status.connection}`} /></div>
        <span>{freshness(status.updatedAt)}{status.preview ? " · Preview" : ""}</span></div>
      <nav>
        <button className={refreshing ? "panel-icon is-spinning" : "panel-icon"} onClick={onRefresh} aria-label="Refresh Codex data"><RefreshIcon size={14} /></button>
        <button className="panel-icon" onClick={onSettings} aria-label="Settings"><SlidersIcon size={14} /></button>
      </nav>
    </header>

    <div className={`quota-stack ${overflowingQuotas ? "quota-stack--scroll" : ""}`}
      aria-label={overflowingQuotas ? "Quota windows" : undefined}
      tabIndex={overflowingQuotas ? 0 : undefined}>
      {quotaWindows.map((window, index) =>
        <QuotaWindowRow key={window.id} window={window} reducedMotion={reducedMotion} secondary={index > 0} />)}
    </div>

    <div className="panel-divider" />
    <section className="usage-headline">
      <div><span>Today</span><strong>{compactNumber(status.tokens.total)}<small>tokens</small></strong></div>
      <div className="api-value">
        <button onMouseEnter={() => setShowTip(true)} onMouseLeave={() => setShowTip(false)} onFocus={() => setShowTip(true)} onBlur={() => setShowTip(false)}>
          API equivalent <InfoIcon size={12} />
        </button>
        <strong>{apiAvailable ? `≈ ${currency(status.pricing.value!)}` : "Unavailable"}</strong>
        {showTip && <div className="api-tooltip">Estimated using published API token pricing. This is informational and not an additional charge.{status.pricing.unavailableModels.length ? ` Excludes models without a published price: ${status.pricing.unavailableModels.join(", ")}.` : ""}</div>}
      </div>
    </section>

    <section className="token-box">
      <StatRow label="Input" value={compactNumber(status.tokens.input)} />
      <StatRow label="Cached input" value={compactNumber(status.tokens.cachedInput ?? 0)} />
      <StatRow label="Output" value={compactNumber(status.tokens.output)} />
      {(status.tokens.reasoning ?? 0) > 0 && <StatRow label="Reasoning" value={compactNumber(status.tokens.reasoning ?? 0)} />}
    </section>

    <section className="model-list"><p>By model</p>
      {models.length ? models.slice(0, 4).map(([model, usage]) => {
        const percent = status.tokens.total > 0 ? Math.round(usage.total / status.tokens.total * 100) : 0;
        return <div className="model-item" key={model}><strong>{modelLabel(model)}</strong><div><i style={{ width: `${percent}%`, transition: reducedMotion ? "none" : undefined }} /></div><b>{compactNumber(usage.total)}</b></div>;
      }) : <span className="model-empty">No local token events found today.</span>}
    </section>
  </main>;
}
