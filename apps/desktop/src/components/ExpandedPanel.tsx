import type { DashboardStatus, Settings } from "../types";
import { compactNumber, currency, freshness, remaining, timeUntil } from "../lib/format";
import { CloseIcon, RefreshIcon, SlidersIcon } from "./Icons";
import { HaloMeter } from "./HaloMeter";
import { SettingsPanel } from "./SettingsPanel";

export function ExpandedPanel({ status, settings, settingsOpen, refreshing, onClose, onRefresh, onSettings, onSettingsChange, onDisable }: {
  status: DashboardStatus;
  settings: Settings;
  settingsOpen: boolean;
  refreshing: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSettings: () => void;
  onSettingsChange: (settings: Settings) => void;
  onDisable: () => void;
}) {
  const primary = status.windows.find((window) => window.durationMinutes === 300) ?? status.windows[0];
  const weekly = status.windows.find((window) => window.durationMinutes === 10080) ?? status.windows[1];
  const models = Object.entries(status.tokens.byModel).sort((a, b) => b[1].total - a[1].total);
  return (
    <main className="panel">
      <header className="panel__header" data-tauri-drag-region>
        <div className="wordmark wordmark--small"><span>CODEX</span><strong>HALO</strong>{status.preview && <em>PREVIEW</em>}</div>
        <nav>
          <button className={refreshing ? "icon-button is-spinning" : "icon-button"} onClick={onRefresh} aria-label="Refresh now"><RefreshIcon /></button>
          <button className={settingsOpen ? "icon-button active" : "icon-button"} onClick={onSettings} aria-label="Settings"><SlidersIcon /></button>
          <button className="icon-button" onClick={onClose} aria-label="Collapse"><CloseIcon /></button>
        </nav>
      </header>
      {settingsOpen ? <SettingsPanel settings={settings} onChange={onSettingsChange} onDisable={onDisable} /> : (
        <>
          <section className="quota-hero">
            <HaloMeter primary={remaining(primary)} secondary={remaining(weekly)} />
            <div className="quota-hero__week">
              <small>WEEK LEFT</small>
              <strong>{Math.round(remaining(weekly))}<i>%</i></strong>
              <span>{weekly ? timeUntil(weekly.resetsAt) : "Weekly window unavailable"}</span>
            </div>
          </section>
          <section className="reset-strip">
            <span className="reset-strip__tick" />
            <div><small>CURRENT WINDOW</small><strong>{primary ? timeUntil(primary.resetsAt) : "Reset unavailable"}</strong></div>
            <span className="reset-strip__duration">{primary?.durationMinutes === 300 ? "05:00" : "--"}</span>
          </section>
          <section className="usage">
            <p className="section-label">TODAY / LOCAL SESSIONS</p>
            <div className="usage__headline">
              <strong>{compactNumber(status.tokens.total)}</strong>
              <span>TOKENS</span>
              {settings.showApiEquivalent && <div className="value-pill">
                <small>API EQUIVALENT</small>
                <b>{status.pricing.value == null ? "Unavailable" : `~ ${currency(status.pricing.value)}`}</b>
              </div>}
            </div>
            <div className="token-breakdown">
              <span><small>INPUT</small><b>{compactNumber(status.tokens.input)}</b></span>
              <span><small>CACHED</small><b>{compactNumber(status.tokens.cachedInput ?? 0)}</b></span>
              <span><small>OUTPUT</small><b>{compactNumber(status.tokens.output)}</b></span>
            </div>
          </section>
          <section className="models">
            <p className="section-label">MODEL SIGNAL</p>
            {models.length ? models.slice(0, 3).map(([model, usage], index) => (
              <div className="model-row" key={model}>
                <span className={`model-dot model-dot--${index}`} />
                <strong>{model}</strong>
                <div><i style={{ width: `${Math.max(8, usage.total / status.tokens.total * 100)}%` }} /></div>
                <b>{compactNumber(usage.total)}</b>
              </div>
            )) : <p className="empty-models">No local token events found today.</p>}
          </section>
          <footer className="panel__footer">
            <span className={`status-pip status-pip--${status.connection}`} />
            <span>{status.connection === "ready" ? freshness(status.updatedAt) : status.message ?? status.connection}</span>
            <button onClick={onRefresh}>Refresh now</button>
          </footer>
        </>
      )}
    </main>
  );
}
