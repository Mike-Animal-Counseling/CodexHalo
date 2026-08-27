import type { DockEdge } from "./bridge";
import type { VisibilityMode } from "../types";

export function shouldRetractEdge({
  dockedEdge,
  dragging,
  expanded,
  visibilityMode,
  edgeAutoHide,
}: {
  dockedEdge?: DockEdge;
  dragging: boolean;
  expanded: boolean;
  visibilityMode: VisibilityMode;
  edgeAutoHide: boolean;
}) {
  return Boolean(dockedEdge)
    && !dragging
    && !expanded
    && visibilityMode === "autoHide"
    && edgeAutoHide;
}
