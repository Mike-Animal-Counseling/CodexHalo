import { useState } from "react";
import type { DashboardStatus, RateLimitWindow } from "../types";
import { compactNumber, currency, freshness, orderedQuotaWindows, quotaName, quotaTone, remaining, timeUntil } from "../lib/format";
import { dashboardViewState, type DashboardViewState } from "../lib/viewState";
import { InfoIcon, RefreshIcon, SlidersIcon } from "./Icons";
import { QuotaRing } from "./QuotaRing";
import { UsageTrend } from "./UsageTrend";

const rateCurrency = (value: number) => "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);

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

function ConnectionStatePanel({ viewState, refreshing, onRefresh, onSettings }: {
  viewState: Extract<DashboardViewState, "connecting" | "disconnected" | "error">;
  refreshing: boolean;
  onRefresh: () => void;
  onSettings: () => void;
}) {
  const connecting = viewState === "connecting";
  const disconnected = viewState === "disconnected";
  const title = connecting ? "Connecting to Codex"
    : disconnected ? "Codex isn't connected yet"
    : "Couldn't refresh Codex";
  const copy = connecting ? "Checking quota and local usage."
    : disconnected ? "Open or sign in to Codex to view quota and usage."
    : "Check your Codex connection, then try again.";
  const action = refreshing || connecting ? "Checking..." : disconnected ? "Check again" : "Try again";

  return <main className={`panel panel--connection panel--connection-${viewState}`} role="dialog" aria-label="CodexHalo connection status">
    <header className="panel-header panel-header--connection">
      <div className="panel-identity"><div><strong>CodexHalo</strong><i className={`connection-dot connection-dot--${viewState}`} /></div>
        <span>{connecting ? "Checking connection" : disconnected ? "Waiting for Codex" : "Refresh needed"}</span></div>
      <nav>
        <button className={refreshing ? "panel-icon is-spinning" : "panel-icon"} onClick={onRefresh}
          disabled={refreshing || connecting} aria-label="Refresh Codex data"><RefreshIcon size={14} /></button>
        <button className="panel-icon" onClick={onSettings} aria-label="Settings"><SlidersIcon size={14} /></button>
      </nav>
    </header>
    <section className="connection-state">
      <div className="connection-state__halo" aria-hidden="true"><i /></div>
      <h2>{title}</h2>
      <p>{copy}</p>
      <button className="connection-state__action" onClick={onRefresh} disabled={refreshing || connecting}>
        <RefreshIcon size={13} />{action}
      </button>
    </section>
  </main>;
}

export function ExpandedPanel({ status, refreshing, reducedMotion, quotaWindowMinutes, showApiEquivalent = true, onRefresh, onSettings }: {
  status: DashboardStatus;
  refreshing: boolean;
  reducedMotion: boolean;
  quotaWindowMinutes?: number | null;
  showApiEquivalent?: boolean;
  onRefresh: () => void;
  onSettings: () => void;
}) {
  const [showTip, setShowTip] = useState(false);
  const viewState = dashboardViewState(status);
  if (viewState === "connecting" || viewState === "disconnected" || viewState === "error") {
    return <ConnectionStatePanel viewState={viewState} refreshing={refreshing} onRefresh={onRefresh} onSettings={onSettings} />;
  }
  const quotaWindows = orderedQuotaWindows(status.windows, quotaWindowMinutes);
  const focusedWindow = quotaWindows[0];
  const focusedRemaining = focusedWindow ? Math.round(remaining(focusedWindow)) : null;
  const models = Object.entries(status.tokens.byModel).sort((a, b) => b[1].total - a[1].total);
  const apiAvailable = status.pricing.value != null && !(status.pricing.unavailableModels.length > 0 && status.pricing.value === 0 && status.pricing.breakdown?.every((row) => row.value == null));
  const modelLabel = (model: string) => model === "unknown-codex" ? "Codex · unclassified" : model;

  const manyQuotas = quotaWindows.length > 2;
  const overflowingQuotas = quotaWindows.length > 4;

  return <main className={`panel panel--dashboard ${manyQuotas ? "panel--many-quotas" : ""}`} role="dialog" aria-label="CodexHalo details">
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

    <div className="panel-content">
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

    <UsageTrend history={status.history ?? []} reducedMotion={reducedMotion} showApiEquivalent={showApiEquivalent} />
    {status.pricing.unavailableModels.length > 0 && <p className="price-incomplete">Some models have no published price. Value excludes them.</p>}
    <section className="token-box">
      <StatRow label="Input" value={compactNumber(status.tokens.input)} />
      <StatRow label="Cached input" value={compactNumber(status.tokens.cachedInput ?? 0)} />
      <StatRow label="Output" value={compactNumber(status.tokens.output)} />
      {(status.tokens.reasoning ?? 0) > 0 && <StatRow label="Reasoning" value={compactNumber(status.tokens.reasoning ?? 0)} />}
    </section>

    <section className="model-list"><p>By model</p>
      {models.length ? models.map(([model, usage]) => {
        const percent = status.tokens.total > 0 ? Math.round(usage.total / status.tokens.total * 100) : 0;
        return <div className="model-item" key={model}><strong>{modelLabel(model)}</strong><div><i style={{ width: `${percent}%`, transition: reducedMotion ? "none" : undefined }} /></div><b>{compactNumber(usage.total)}</b></div>;
      }) : <span className="model-empty">No local token events found today.</span>}
    </section>
    <details className="pricing-details">
      <summary>Token pricing <span>{status.pricing.version}</span></summary>
      <p>Cost = (uncached input * input rate + cached input * cache rate + output * output rate) / 1,000,000. Rates below are USD per 1M tokens.</p>
      <p>Cached input is part of input. Reasoning is part of output, so neither is charged twice.</p>
      {(status.pricing.breakdown ?? []).map((row) => <article className="model-price" key={row.model}>
        <div><strong>{modelLabel(row.model)}</strong><b>{row.value == null ? "Price unknown" : currency(row.value)}</b></div>
        {row.rates ? <>
          <dl><div><dt>Input</dt><dd>{rateCurrency(row.rates.inputPerMillion)}</dd><small>{compactNumber(row.usage.input - Math.min(row.usage.cachedInput ?? 0, row.usage.input))} tokens</small></div>
            <div><dt>Cached</dt><dd>{row.rates.cachedInputPerMillion == null ? "Input rate" : rateCurrency(row.rates.cachedInputPerMillion)}</dd><small>{compactNumber(Math.min(row.usage.cachedInput ?? 0, row.usage.input))} tokens</small></div>
            <div><dt>Output</dt><dd>{rateCurrency(row.rates.outputPerMillion)}</dd><small>{compactNumber(row.usage.output)} tokens</small></div>
          </dl>
          {row.rates.cacheWritePerMillion != null && <small>Cache writes: {rateCurrency(row.rates.cacheWritePerMillion)}/1M. Not included: logs do not identify writes.</small>}
          {row.longContext && <small>Higher rates apply above {compactNumber(row.longContext.inputThreshold)} input tokens per request.</small>}
        </> : <small>Tokens are tracked. Cost is excluded until a price is published.</small>}
      </article>)}
      <p>{status.pricing.assumptions?.join(" ") ?? "Estimated at standard API rates. This is an informational equivalent, not your subscription bill."}</p>
      <span className="pricing-source">{status.pricing.catalogSource === "remote" ? "Downloaded prices" : status.pricing.catalogSource === "cached" ? "Saved prices" : "Built-in prices"}
        {status.pricing.lastCheckedAt ? ` \u00b7 Checked ${new Date(status.pricing.lastCheckedAt).toLocaleDateString()}` : ""}
      </span>
    </details>
    </div>
  </main>;
}
