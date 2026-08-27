import type { DockEdge } from "../lib/bridge";

export function EdgeRevealHandle({ edge, visible, onReveal }: {
  edge: DockEdge;
  visible: boolean;
  onReveal: () => void;
}) {
  return <button
    type="button"
    className={`edge-reveal-handle edge-reveal-handle--${edge} ${visible ? "is-visible" : ""}`}
    aria-label="Reveal CodexHalo"
    aria-hidden={!visible}
    tabIndex={visible ? 0 : -1}
    onPointerEnter={visible ? onReveal : undefined}
    onFocus={visible ? onReveal : undefined}
    onClick={onReveal}
  >
    <span aria-hidden="true" />
  </button>;
}
