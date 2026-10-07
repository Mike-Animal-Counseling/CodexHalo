import { useEffect, useState } from "react";
import type { RateLimitWindow, Settings } from "../types";
import { primaryQuotaWindow, quotaLabel } from "../lib/format";
import { BackIcon } from "./Icons";

const modes: Array<{ id: Settings["visibilityMode"]; label: string; description: string }> = [
  { id: "always", label: "Always visible", description: "Stays on screen." },
  { id: "autoHide", label: "Edge auto-hide", description: "Retracts at a screen edge." },
  { id: "tray", label: "Tray only", description: "Restore from the tray icon." },
];

export function SettingsSheet({ settings, windows, onChange, onDisable, onClose, onSyncPricing, onTestReminder, pricingStatus }: {
  settings: Settings;
  windows: RateLimitWindow[];
  onChange: (settings: Settings) => void;
  onDisable: () => void;
  onClose: () => void;
  onSyncPricing?: () => Promise<string>;
  onTestReminder?: () => Promise<void>;
  pricingStatus?: string;
}) {
  const [leadDraft, setLeadDraft] = useState(String(settings.resetReminderMinutes));
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [reminderFeedback, setReminderFeedback] = useState("");
  useEffect(() => setLeadDraft(String(settings.resetReminderMinutes)), [settings.resetReminderMinutes]);
  const commitLead = () => {
    const parsed = Number(leadDraft);
    if (leadDraft.trim() === "" || !Number.isFinite(parsed)) {
      setLeadDraft(String(settings.resetReminderMinutes)); return;
    }
    const value = Math.max(0, Math.min(10_080, Math.round(parsed)));
    setLeadDraft(String(value));
    if (value !== settings.resetReminderMinutes) onChange({ ...settings, resetReminderMinutes: value });
  };
  const syncPrices = async () => {
    if (!onSyncPricing || syncing) return;
    setSyncing(true); setFeedback("");
    try { setFeedback(await onSyncPricing()); }
    catch { setFeedback("Could not check prices. Saved prices remain available."); }
    finally { setSyncing(false); }
  };
  const testReminder = async () => {
    try { await onTestReminder?.(); setReminderFeedback("Test sent. Check Windows notifications."); }
    catch { setReminderFeedback("Could not send notification. Check Windows notification settings."); }
  };
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  const quotaOptions = windows.filter((window, index) =>
    windows.findIndex((candidate) => candidate.durationMinutes === window.durationMinutes) === index);
  const activeQuota = primaryQuotaWindow(quotaOptions, settings.quotaWindowMinutes);
  return <section className="panel settings-sheet" role="dialog" aria-label="Settings">
      <header><h2>Settings</h2><button onClick={onClose} aria-label="Back to details"><BackIcon /></button></header>
      <div className="settings-content">
      <p className="settings-label">Visibility</p>
      <div className="mode-list">{modes.map((mode) => <button key={mode.id} className={settings.visibilityMode === mode.id ? "active" : ""} onClick={() => update("visibilityMode", mode.id)}>
        <i /><span><strong>{mode.label}</strong><small>{mode.description}</small></span>
      </button>)}</div>

      <button className="settings-switch-row" role="switch" aria-checked={settings.reducedMotion} onClick={() => update("reducedMotion", !settings.reducedMotion)}>
        <span><strong>Reduced motion</strong><small>Minimize transitions and spins.</small></span>
        <i className={settings.reducedMotion ? "active" : ""}><b /></i>
      </button>

      <div className="settings-appearance"><strong>Appearance</strong>
        <nav>{(["system", "light", "dark"] as const).map((theme) => <button key={theme} className={settings.theme === theme ? "active" : ""} onClick={() => update("theme", theme)}>{theme}</button>)}</nav>
      </div>

      {quotaOptions.length > 1 && <div className="settings-quota-focus"><strong>Primary limit</strong>
        <nav style={{ gridTemplateColumns: `repeat(${quotaOptions.length}, minmax(0, 1fr))` }}>{quotaOptions.map((window) => <button key={window.id}
          className={activeQuota?.durationMinutes === window.durationMinutes ? "active" : ""}
          onClick={() => update("quotaWindowMinutes", window.durationMinutes)}>
          {quotaLabel(window.durationMinutes)}
        </button>)}</nav>
      </div>}

      <label className="settings-startup"><strong>Startup behavior</strong>
        <select aria-label="Startup behavior" value={settings.startupBehavior}
          onChange={(event) => update("startupBehavior", event.target.value as Settings["startupBehavior"])}>
          <option value="off">Off</option>
          <option value="startWithWindows">Start with Windows</option>
          <option value="showWhenCodexStarts">Show when Codex starts</option>
        </select>
      </label>

      <p className="settings-label">Reset reminders</p>
      <button className="settings-switch-row" role="switch" aria-checked={settings.resetReminderEnabled}
        onClick={() => update("resetReminderEnabled", !settings.resetReminderEnabled)}>
        <span><strong>Notify before reset</strong><small>Works while the HUD is hidden.</small></span>
        <i className={settings.resetReminderEnabled ? "active" : ""}><b /></i>
      </button>
      {settings.resetReminderEnabled && <div className="settings-reminder">
        <label htmlFor="reset-lead">Minutes before reset</label>
        <input id="reset-lead" type="number" min={0} max={10_080} step={1} value={leadDraft}
          onChange={(event) => setLeadDraft(event.target.value)} onBlur={commitLead}
          onKeyDown={(event) => { if (event.key === "Enter") commitLead(); }} />
        <small>0 = at reset. Keep CodexHalo running.</small>
        {onTestReminder && <button className="settings-inline-action" onClick={() => void testReminder()}>Send test reminder</button>}
        {reminderFeedback && <small className="settings-feedback" role="status">{reminderFeedback}</small>}
      </div>}
      <p className="settings-label">Model prices</p>
      <button className="settings-switch-row" role="switch" aria-checked={settings.autoSyncPricing}
        onClick={() => update("autoSyncPricing", !settings.autoSyncPricing)}>
        <span><strong>Update prices automatically</strong><small>Checks the public price table daily.</small></span>
        <i className={settings.autoSyncPricing ? "active" : ""}><b /></i>
      </button>
      <div className="settings-pricing">
        <small>{pricingStatus ?? "Built-in prices available offline."}</small>
        {onSyncPricing && <button className="settings-inline-action" disabled={syncing} onClick={() => void syncPrices()}>
          {syncing ? "Checking prices..." : "Check for price updates"}
        </button>}
        <small>Only the public price file is downloaded.</small>
      </div>
      {feedback && <p className="settings-feedback" role="status">{feedback}</p>}
      <div className="settings-shortcut"><span>Toggle visibility</span><kbd>Ctrl + Shift + H</kbd></div>
      <button className="settings-disable" onClick={onDisable}>Disable Codex</button>
      </div>
  </section>;
}
