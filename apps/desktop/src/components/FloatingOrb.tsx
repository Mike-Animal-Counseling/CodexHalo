import { useRef, type MouseEvent, type PointerEvent } from "react";
import type { CSSProperties } from "react";
import type { DashboardStatus } from "../types";
import { primaryQuotaWindow, quotaName, quotaTone, remaining } from "../lib/format";
import { dashboardViewState } from "../lib/viewState";

export function FloatingOrb({ status, refreshing, reducedMotion, quotaWindowMinutes, dragging = false, dragEnabled = true, action = "expand", onExpand, onStartDrag }: {
  status: DashboardStatus;
  refreshing: boolean;
  reducedMotion: boolean;
  quotaWindowMinutes?: number | null;
  dragging?: boolean;
  dragEnabled?: boolean;
  action?: "expand" | "collapse";
  onExpand: () => void;
  onStartDrag: () => Promise<boolean>;
}) {
  const focusedWindow = primaryQuotaWindow(status.windows, quotaWindowMinutes);
  const focusedRemaining = focusedWindow ? remaining(focusedWindow) : null;
  const safe = focusedRemaining == null ? null : Math.round(focusedRemaining);
  const quotaLabel = focusedWindow ? quotaName(focusedWindow.durationMinutes).toLowerCase() : "Codex";
  const quotaId = focusedWindow?.id ?? "unavailable";
  const tone = ({ ok: "high", warn: "medium", low: "low" } as const)[quotaTone(safe)];
  const viewState = dashboardViewState(status);
  const stateLabel = viewState === "disconnected" ? "CONNECT"
    : viewState === "connecting" ? "CHECKING"
    : viewState === "error" ? "RETRY"
    : "NO DATA";
  const stateClass = viewState === "disconnected" ? "is-disconnected"
    : viewState === "connecting" ? "is-connecting"
    : viewState === "error" ? "is-error"
    : "is-empty";
  const stateDescription = viewState === "disconnected" ? "Codex isn't connected yet"
    : viewState === "connecting" ? "Checking the Codex connection"
    : viewState === "error" ? "Codex could not be refreshed"
    : "Codex quota is not available yet";
  const interaction = useRef(0);

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if (!dragEnabled) return;
    event.preventDefault();
    if (action === "collapse") {
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const cleanup = () => {
        window.removeEventListener("pointermove", pointerMove, true);
        window.removeEventListener("pointerup", pointerUp, true);
        window.removeEventListener("pointercancel", pointerCancel, true);
      };
      const pointerMove = (moveEvent: globalThis.PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return;
        cleanup();
        const interactionId = ++interaction.current;
        void onStartDrag().then((moved) => {
          if (interaction.current !== interactionId) return;
          if (!moved) onExpand();
        }).catch(() => {});
      };
      const pointerUp = (upEvent: globalThis.PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        cleanup();
        ++interaction.current;
        onExpand();
      };
      const pointerCancel = (cancelEvent: globalThis.PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return;
        cleanup();
      };
      window.addEventListener("pointermove", pointerMove, true);
      window.addEventListener("pointerup", pointerUp, true);
      window.addEventListener("pointercancel", pointerCancel, true);
      return;
    }
    const interactionId = ++interaction.current;
    void onStartDrag().then((moved) => {
      if (interaction.current !== interactionId) return;
      if (!moved) onExpand();
    }).catch(() => {});
  };
  const activate = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0 && dragEnabled) onExpand();
  };

  return <button className={`floating-orb tech-capsule tech-capsule--${tone} ${safe == null ? stateClass : ""} ${refreshing ? "is-refreshing" : ""} ${dragging ? "is-dragging" : ""}`}
    onPointerDown={pointerDown}
    onClick={activate}
    aria-label={`CodexHalo - ${focusedRemaining == null ? stateDescription : `${Math.round(focusedRemaining)}% ${quotaLabel} quota remaining`}. Click to ${action}.`}>
    <span className="floating-orb__surface" aria-hidden="true" />
    <span className="tech-capsule__status" aria-hidden="true" />
    <span className="tech-capsule__brand">CODEX</span>
    {safe == null ? <span className="tech-capsule__state">{stateLabel}</span> : <>
      <span className="tech-capsule__track"><i data-quota={quotaId} style={{ width: `${safe}%`, transition: reducedMotion ? "none" : undefined }} /></span>
      <span className="tech-capsule__expanded-progress" aria-hidden="true">
        <span><i style={{ "--quota": `${safe}%`, transition: reducedMotion ? "none" : undefined } as CSSProperties} /></span>
      </span>
      <span className="tech-capsule__value">{safe}<small>%</small></span>
    </>}
  </button>;
}
