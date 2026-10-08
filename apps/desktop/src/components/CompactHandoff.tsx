import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { DashboardStatus, Settings } from "../types";
import { FloatingOrb } from "./FloatingOrb";

export interface CompactHandoffPayload {
  sequence: number;
  status: Pick<DashboardStatus, "connection" | "windows" | "updatedAt"> | null;
  settings: Settings;
  refreshing: boolean;
}

export function CompactHandoff() {
  const [payload, setPayload] = useState<CompactHandoffPayload>();

  const sequence = useRef(0);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<CompactHandoffPayload>("halo://compact-handoff", ({ payload: next }) => {
      if (disposed || next.sequence <= sequence.current) return;
      sequence.current = next.sequence;
      if (!next.status || !next.settings.codexEnabled) { setPayload(undefined); return; }
      document.documentElement.dataset.theme = next.settings.theme;
      document.documentElement.dataset.resolvedTheme = next.settings.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
        : next.settings.theme;
      document.documentElement.dataset.motion = "reduced";
      document.documentElement.style.setProperty("--hud-opacity", String(next.settings.opacity));
      setPayload(next);
    }).then((dispose) => {
      if (disposed) dispose(); else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!payload?.status) return null;
  return <div className="hud-shell hud-shell--compact compact-handoff-shell" aria-hidden="true">
    <FloatingOrb status={payload.status} refreshing={payload.refreshing} reducedMotion quotaWindowMinutes={payload.settings.quotaWindowMinutes}
      dragEnabled={false} action="expand" onExpand={() => {}} onStartDrag={async () => false} />
  </div>;
}
