import { CloseIcon } from "./Icons";
import { QuotaRing } from "./QuotaRing";

export function Onboarding({ onEnable, onClose, busy }: { onEnable: () => void; onClose: () => void; busy: boolean }) {
  return <main className="onboarding-reference">
    <div className="onboarding-reference__drag" data-tauri-drag-region aria-hidden="true" />
    <button className="onboarding-reference__close" onClick={onClose} aria-label="Hide CodexHalo"><CloseIcon /></button>
    <div className="onboarding-reference__ring"><QuotaRing value={100} size={72} stroke={5} showCenter={false} /></div>
    <h1>CodexHalo</h1>
    <p>A floating monitor for your Codex usage. Codex access is off by default. Nothing reads your local Codex data until you enable it.</p>
    <button className="onboarding-reference__enable" onClick={onEnable} disabled={busy}>{busy ? "Connecting..." : "Enable Codex"}</button>
    <small>Your choice will be remembered for future launches.</small>
  </main>;
}
