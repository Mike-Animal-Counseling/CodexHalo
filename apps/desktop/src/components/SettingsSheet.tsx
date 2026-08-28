import type { RateLimitWindow, Settings } from "../types";
import { primaryQuotaWindow, quotaLabel } from "../lib/format";
import { BackIcon } from "./Icons";

const modes: Array<{ id: Settings["visibilityMode"]; label: string; description: string }> = [
  { id: "always", label: "Always visible", description: "Stays on screen." },
  { id: "autoHide", label: "Edge auto-hide", description: "Retracts at a screen edge." },
  { id: "tray", label: "Tray only", description: "Restore from the tray icon." },
];

export function SettingsSheet({ settings, windows, onChange, onDisable, onClose }: {
  settings: Settings;
  windows: RateLimitWindow[];
  onChange: (settings: Settings) => void;
  onDisable: () => void;
  onClose: () => void;
}) {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  const quotaOptions = windows.filter((window, index) =>
    windows.findIndex((candidate) => candidate.durationMinutes === window.durationMinutes) === index);
  const activeQuota = primaryQuotaWindow(quotaOptions, settings.quotaWindowMinutes);
  return <section className="panel settings-sheet" role="dialog" aria-label="Settings">
      <header><h2>Settings</h2><button onClick={onClose} aria-label="Back to details"><BackIcon /></button></header>
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

      <div className="settings-shortcut"><span>Toggle visibility</span><kbd>Ctrl + Shift + H</kbd></div>
      <button className="settings-disable" onClick={onDisable}>Disable Codex</button>
  </section>;
}
