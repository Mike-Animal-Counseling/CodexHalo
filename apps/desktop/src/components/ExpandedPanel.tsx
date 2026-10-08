import { useEffect, useRef, useState } from "react";
import type { DashboardStatus, RateLimitWindow } from "../types";
import { compactNumber, currency, freshness, orderedQuotaWindows, quotaName, quotaTone, remaining, timeUntil } from "../lib/format";
import { dashboardViewState, type DashboardViewState } from "../lib/viewState";
import { BackIcon, ChevronIcon, HistoryIcon, InfoIcon, RefreshIcon, SlidersIcon } from "./Icons";
import { QuotaRing } from "./QuotaRing";
import { UsageTrend } from "./UsageTrend";

export type PanelPage = "overview" | "history" | "pricing";

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


function PageControls({ page, pages, label, onChange }: {
  page: number; pages: number; label: string; onChange: (page: number) => void;
}) {
  return <nav className="page-controls" aria-label={label}>
    <button disabled={page === 0} onClick={() => onChange(page - 1)} aria-label={"Previous " + label}><BackIcon size={11} /></button>
    <span>{page + 1}/{pages}</span>
    <button disabled={page === pages - 1} onClick={() => onChange(page + 1)} aria-label={"Next " + label}><BackIcon size={11} /></button>
  </nav>;
}

function TokenPricing({ status }: { status: DashboardStatus }) {
  const [selectedPage, setSelectedPage] = useState(0);
  const rows = status.pricing.breakdown ?? Object.entries(status.tokens.byModel).map(([model, usage]) => ({ model, usage }));
  const pages = Math.max(1, Math.ceil(rows.length / 2));
  const page = Math.min(selectedPage, pages - 1);
  const visibleRows = rows.slice(page * 2, page * 2 + 2);
  const modelLabel = (model: string) => model === "unknown-codex" ? "Codex \u00b7 unclassified" : model;
  return <section className="pricing-details" aria-label="Token prices">
    <div className="pricing-page-label"><span>Today's models</span>
      {pages > 1 && <PageControls page={page} pages={pages} label="priced models" onChange={setSelectedPage} />}</div>
    {visibleRows.map((entry) => {
      const row = entry as NonNullable<DashboardStatus["pricing"]["breakdown"]>[number];
      return <article className="model-price" key={row.model}>
        <div><strong title={modelLabel(row.model)}>{modelLabel(row.model)}</strong><b>{row.value == null ? "Unknown" : currency(row.value)}</b></div>
        {row.rates ? <dl>
          <div><dt>Input</dt><dd>{rateCurrency(row.rates.inputPerMillion)}</dd><small>{compactNumber(row.usage.input - Math.min(row.usage.cachedInput ?? 0, row.usage.input))} tokens</small></div>
          <div><dt>Cached</dt><dd>{row.rates.cachedInputPerMillion == null ? "Input rate" : rateCurrency(row.rates.cachedInputPerMillion)}</dd><small>{compactNumber(Math.min(row.usage.cachedInput ?? 0, row.usage.input))} tokens</small></div>
          <div><dt>Output</dt><dd>{rateCurrency(row.rates.outputPerMillion)}</dd><small>{compactNumber(row.usage.output)} tokens</small></div>
        </dl> : <p>Price unavailable. Tokens are still counted.</p>}
      </article>;
    })}
    {!rows.length && <p className="pricing-empty">No model usage today.</p>}
    <footer className="pricing-footer">
      <p>API estimate only. Your subscription is unchanged.</p>
      <div><span>{status.pricing.catalogSource === "remote" ? "Downloaded catalog" : status.pricing.catalogSource === "cached" ? "Saved catalog" : "Built-in catalog"}</span>
        <b>{status.pricing.version}</b></div>
    </footer>
  </section>;
}


export function ExpandedPanel({ status, refreshing, reducedMotion, quotaWindowMinutes, showApiEquivalent = true, page, onNavigate, onRefresh, onSettings }: {
  status: DashboardStatus;
  refreshing: boolean;
  reducedMotion: boolean;
  quotaWindowMinutes?: number | null;
  showApiEquivalent?: boolean;
  page?: PanelPage;
  onNavigate?: (page: PanelPage) => void;
  onRefresh: () => void;
  onSettings: () => void;
}) {
  const [showTip, setShowTip] = useState(false);
  const [quotaPage, setQuotaPage] = useState(0);
  const [modelPage, setModelPage] = useState(0);
  const [localPage, setLocalPage] = useState<PanelPage>("overview");
  const activePage = page ?? localPage;
  const navigate = (next: PanelPage) => { setShowTip(false); setLocalPage(next); onNavigate?.(next); };
  const previousPage = useRef<PanelPage | null>(null);
  const pageTitleRef = useRef<HTMLHeadingElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const pricingButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (previousPage.current === activePage) return;
    if (activePage === "overview" && previousPage.current !== null) {
      (previousPage.current === "history" ? historyButtonRef : pricingButtonRef).current?.focus();
    } else if (activePage !== "overview") pageTitleRef.current?.focus();
    previousPage.current = activePage;
  }, [activePage]);
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
  const quotaPages = Math.max(1, Math.ceil(quotaWindows.length / 2));
  const activeQuotaPage = Math.min(quotaPage, quotaPages - 1);
  const modelPages = Math.max(1, Math.ceil(models.length / 2));
  const activeModelPage = Math.min(modelPage, modelPages - 1);

  if (activePage !== "overview") return <main className={`panel panel--subpage panel--${activePage}`} role="dialog"
    aria-label={activePage === "history" ? "CodexHalo history" : "CodexHalo pricing"}>
    <header className="panel-page-header">
      <button className="panel-icon" onClick={() => navigate("overview")} aria-label="Back to overview"><BackIcon size={14} /></button>
      <div><h2 ref={pageTitleRef} tabIndex={-1}>{activePage === "history" ? "History" : "Token pricing"}</h2>
        <span>{activePage === "history" ? "Your local activity" : "USD per million tokens"}</span></div>
      <button className="panel-icon" onClick={onSettings} aria-label="Settings"><SlidersIcon size={14} /></button>
    </header>
    <div className="panel-content" key={activePage}>
      {activePage === "history"
        ? <UsageTrend history={status.history ?? []} reducedMotion={reducedMotion} showApiEquivalent={showApiEquivalent} />
        : <TokenPricing status={status} />}
    </div>
  </main>;

  return <main className={`panel panel--dashboard ${manyQuotas ? "panel--many-quotas" : ""}`} role="dialog" aria-label="CodexHalo details">
    <header className="panel-header">
      <QuotaRing value={focusedRemaining} label={focusedWindow ? quotaName(focusedWindow.durationMinutes) : "Codex"}
        quotaId={focusedWindow?.id ?? "unavailable"} size={48} stroke={2.25} reducedMotion={reducedMotion} />
      <div className="panel-identity"><div><strong>CodexHalo</strong><i className={`connection-dot connection-dot--${status.connection}`} /></div>
        <span>{freshness(status.updatedAt)}{status.preview ? " · Preview" : ""}</span></div>
      <nav aria-label="Dashboard actions">
        <button className="panel-icon" ref={historyButtonRef} onClick={() => navigate("history")} aria-label="History" title="History"><HistoryIcon size={14} /></button>
        <button className={refreshing ? "panel-icon is-spinning" : "panel-icon"} onClick={onRefresh} aria-label="Refresh Codex data"><RefreshIcon size={14} /></button>
        <button className="panel-icon" onClick={onSettings} aria-label="Settings"><SlidersIcon size={14} /></button>
      </nav>
    </header>

    <div className="panel-content">
    {quotaPages > 1 && <div className="quota-page-label"><span>Quota windows</span><PageControls page={activeQuotaPage} pages={quotaPages} label="quota windows" onChange={setQuotaPage} /></div>}
    <div className="quota-stack">
      {quotaWindows.slice(activeQuotaPage * 2, activeQuotaPage * 2 + 2).map((window, index) =>
        <QuotaWindowRow key={window.id} window={window} reducedMotion={reducedMotion} secondary={index > 0} />)}
    </div>

    <div className="panel-divider" />
    <section className="usage-headline">
      <div><span>Today</span><strong>{compactNumber(status.tokens.total)}<small>tokens</small></strong></div>
      {showApiEquivalent && <div className="api-value">
        <button onMouseEnter={() => setShowTip(true)} onMouseLeave={() => setShowTip(false)} onFocus={() => setShowTip(true)} onBlur={() => setShowTip(false)}>
          API equivalent <InfoIcon size={12} />
        </button>
        <strong>{apiAvailable ? `≈ ${currency(status.pricing.value!)}` : "Unavailable"}</strong>
        {showTip && <div className="api-tooltip">Estimated using published API token pricing. This is informational and not an additional charge.{status.pricing.unavailableModels.length ? ` Excludes models without a published price: ${status.pricing.unavailableModels.join(", ")}.` : ""}</div>}
      </div>}
    </section>

    {showApiEquivalent && status.pricing.unavailableModels.length > 0 && <p className="price-incomplete" title={status.pricing.unavailableModels.join(", ")}>Partial estimate: some model prices are unavailable.</p>}
    <section className="token-box">
      <StatRow label="Input" value={compactNumber(status.tokens.input)} />
      <StatRow label="Cached input" value={compactNumber(status.tokens.cachedInput ?? 0)} />
      <StatRow label="Output" value={compactNumber(status.tokens.output)} />
      {(status.tokens.reasoning ?? 0) > 0 && <StatRow label="Reasoning" value={compactNumber(status.tokens.reasoning ?? 0)} />}
    </section>

    <section className="model-list"><div className="model-list__header"><p>By model</p>
      {modelPages > 1 && <PageControls page={activeModelPage} pages={modelPages} label="model usage" onChange={setModelPage} />}</div>
      {models.length ? models.slice(activeModelPage * 2, activeModelPage * 2 + 2).map(([model, usage]) => {
        const percent = status.tokens.total > 0 ? Math.round(usage.total / status.tokens.total * 100) : 0;
        return <div className="model-item" key={model}><strong>{modelLabel(model)}</strong><div><i style={{ width: `${percent}%`, transition: reducedMotion ? "none" : undefined }} /></div><b>{compactNumber(usage.total)}</b></div>;
      }) : <span className="model-empty">No local token events found today.</span>}
    </section>
    <button className="pricing-entry" onClick={() => navigate("pricing")} ref={pricingButtonRef}>
      <span>Token pricing</span><ChevronIcon size={12} />
    </button>
    </div>
  </main>;
}
