import { HaloMeter } from "./HaloMeter";

export function Onboarding({ onEnable, busy }: { onEnable: () => void; busy: boolean }) {
  return (
    <main className="onboarding">
      <div className="onboarding__halo" aria-hidden="true"><HaloMeter primary={78} secondary={54} size={118} /></div>
      <div className="wordmark"><span>CODEX</span><strong>HALO</strong></div>
      <h1>Codex status,<br />always in sight.</h1>
      <p>See your current limits and local token usage without opening another dashboard.</p>
      <button className="enable-button" onClick={onEnable} disabled={busy}>
        <span className="enable-button__orb" />
        {busy ? "Connecting to Codex&" : "Enable Codex"}
      </button>
      <div className="privacy-note">
        <span>LOCAL ONLY</span>
        <i />
        <span>NO API KEY</span>
        <i />
        <span>NO COOKIES</span>
      </div>
    </main>
  );
}
