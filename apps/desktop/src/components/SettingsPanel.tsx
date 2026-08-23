import type { Settings } from "../types";

function Toggle({ checked, onChange, label, note }: { checked: boolean; onChange: (value: boolean) => void; label: string; note?: string }) {
  return <label className="setting-row">
    <span><strong>{label}</strong>{note && <small>{note}</small>}</span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <i className="toggle" aria-hidden="true"><b /></i>
  </label>;
}

export function SettingsPanel({ settings, onChange, onDisable }: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onDisable: () => void;
}) {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  return (
    <section className="settings-panel" aria-label="Settings">
      <div className="settings-section">
        <p className="section-label">HUD FORM</p>
        <div className="segmented">
          <button className={settings.hudStyle === "capsule" ? "active" : ""} onClick={() => update("hudStyle", "capsule")}>Capsule</button>
          <button className={settings.hudStyle === "halo" ? "active" : ""} onClick={() => update("hudStyle", "halo")}>Halo</button>
        </div>
      </div>
      <div className="settings-section">
        <p className="section-label">VISIBILITY</p>
        <select value={settings.visibilityMode} onChange={(event) => update("visibilityMode", event.target.value as Settings["visibilityMode"])}>
          <option value="autoHide">Edge auto-hide</option>
          <option value="always">Always visible</option>
          <option value="tray">Tray only</option>
        </select>
        <Toggle label="Always on top" checked={settings.alwaysOnTop} onChange={(value) => update("alwaysOnTop", value)} />
        <Toggle label="API-equivalent value" checked={settings.showApiEquivalent} onChange={(value) => update("showApiEquivalent", value)} />
      </div>
      <div className="settings-section">
        <p className="section-label">APPEARANCE</p>
        <div className="segmented segmented--three">
          {(["system", "light", "dark"] as const).map((theme) =>
            <button key={theme} className={settings.theme === theme ? "active" : ""} onClick={() => update("theme", theme)}>{theme}</button>
          )}
        </div>
        <label className="opacity-row">
          <span>Opacity <b>{Math.round(settings.opacity * 100)}%</b></span>
          <input type="range" min="0.7" max="1" step="0.01" value={settings.opacity} onChange={(event) => update("opacity", Number(event.target.value))} />
        </label>
      </div>
      <div className="settings-footer">
        <span>Shortcut <kbd>Cmd/Ctrl</kbd><kbd>Shift</kbd><kbd>H</kbd></span>
        <button className="danger-link" onClick={onDisable}>Disable Codex</button>
      </div>
    </section>
  );
}
