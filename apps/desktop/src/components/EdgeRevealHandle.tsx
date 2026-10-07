import { useCallback, useEffect, useRef } from "react";
import type { DockEdge } from "../lib/bridge";

const HOVER_REVEAL_DELAY = 120;

export function EdgeRevealHandle({ edge, visible, onReveal }: {
  edge: DockEdge;
  visible: boolean;
  onReveal: () => void;
}) {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const revealed = useRef(false);
  const cancelHover = useCallback(() => {
    if (hoverTimer.current !== undefined) clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  }, []);
  const reveal = useCallback(() => {
    cancelHover();
    if (!visible || revealed.current) return;
    revealed.current = true;
    onReveal();
  }, [cancelHover, onReveal, visible]);

  useEffect(() => {
    revealed.current = false;
    cancelHover();
    return cancelHover;
  }, [cancelHover, visible]);

  return <button
    type="button"
    className={`edge-reveal-handle edge-reveal-handle--${edge} ${visible ? "is-visible" : ""}`}
    aria-label="Reveal CodexHalo"
    title="Reveal CodexHalo"
    aria-hidden={!visible}
    tabIndex={visible ? 0 : -1}
    disabled={!visible}
    onPointerEnter={(event) => {
      if (!visible || event.pointerType === "touch" || revealed.current) return;
      cancelHover();
      hoverTimer.current = setTimeout(reveal, HOVER_REVEAL_DELAY);
    }}
    onPointerLeave={cancelHover}
    onPointerCancel={cancelHover}
    onFocus={reveal}
    onBlur={cancelHover}
    onClick={reveal}
  >
    <span className="edge-reveal-handle__grip" aria-hidden="true" />
  </button>;
}
