import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { bridge, isTauri, type DockEdge, type SurfaceLayout, type WindowSurface } from "./lib/bridge";
import { shouldRetractEdge } from "./lib/edgeHide";
import { defaultSettings, emptyUsage, type DashboardStatus, type Settings } from "./types";
import { FloatingOrb } from "./components/FloatingOrb";
import { EdgeRevealHandle } from "./components/EdgeRevealHandle";
import { ExpandedPanel } from "./components/ExpandedPanel";
import { SettingsSheet } from "./components/SettingsSheet";
import { Onboarding } from "./components/Onboarding";
import { CompactHandoff } from "./components/CompactHandoff";
import { CloseIcon } from "./components/Icons";
import { completeCompactTransition } from "./lib/compactTransition";
import "./styles.css";

const disabledStatus: DashboardStatus = {
  connection: "disabled", windows: [], tokens: emptyUsage,
  pricing: { unavailableModels: [], version: "2026-08-23" },
};
const defaultLayout: SurfaceLayout = { orbX: 66, orbY: 0, panelX: 4, panelY: 31, placement: "below", edge: null };
type ExpansionPhase = "closed" | "opening" | "open" | "closing";
type SurfaceReflow = { layout: SurfaceLayout; offsetX: number; offsetY: number; active: boolean };
const afterNextPaint = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
});

function MainApp() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<DashboardStatus>(disabledStatus);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<ExpansionPhase>("closed");
  const [layout, setLayout] = useState<SurfaceLayout>(defaultLayout);
  const [surfaceReflow, setSurfaceReflow] = useState<SurfaceReflow>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [edgeHidden, setEdgeHidden] = useState(false);
  const [surfacePending, setSurfacePending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dockedEdge, setDockedEdge] = useState<DockEdge>();
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [, setClockTick] = useState(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const dockedEdgeRef = useRef<DockEdge | undefined>(undefined);
  const expandedRef = useRef(false);
  const settingsRef = useRef(settings);
  const draggingRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const closePanelRef = useRef<() => void>(() => {});
  const appliedBaseSurfaceRef = useRef<WindowSurface | undefined>(undefined);
  const surfaceBusyRef = useRef(false);
  const layoutRef = useRef(layout);
  const expanded = phase !== "closed";
  const baseSurface: WindowSurface = !settings.codexEnabled || status.connection === "unauthenticated" ? "onboarding" : "compact";
  const reducedMotion = settings.reducedMotion || systemReducedMotion;
  dockedEdgeRef.current = dockedEdge;
  expandedRef.current = expanded;
  settingsRef.current = settings;
  reducedMotionRef.current = reducedMotion;
  layoutRef.current = layout;

  const cancelHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
  }, []);
  const finishDragging = useCallback(() => {
    draggingRef.current = false;
    setDragging(false);
  }, []);
  const markDragging = useCallback(() => {
    cancelHide();
    draggingRef.current = true;
    setDragging(true);
  }, [cancelHide]);
  const armHideTimer = useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = undefined;
      const current = settingsRef.current;
      if (!shouldRetractEdge({
        dockedEdge: dockedEdgeRef.current,
        dragging: draggingRef.current,
        expanded: expandedRef.current,
        visibilityMode: current.visibilityMode,
        edgeAutoHide: current.edgeAutoHide,
      })) {
        setEdgeHidden(false);
        return;
      }
      const edge = dockedEdgeRef.current;
      if (!edge) return;
      void bridge.setEdgeRetracted(true, edge, !reducedMotionRef.current)
        .then(() => {
          if (shouldRetractEdge({
            dockedEdge: dockedEdgeRef.current,
            dragging: draggingRef.current,
            expanded: expandedRef.current,
            visibilityMode: settingsRef.current.visibilityMode,
            edgeAutoHide: settingsRef.current.edgeAutoHide,
          })) {
            setEdgeHidden(true);
          } else {
            void bridge.setEdgeRetracted(false, edge, !reducedMotionRef.current)
              .finally(() => setEdgeHidden(false));
          }
        })
        .catch(() => setEdgeHidden(false));
    }, 2200);
  }, [cancelHide]);
  const reveal = useCallback(() => {
    cancelHide();
    void bridge.setEdgeRetracted(false, dockedEdgeRef.current ?? null, !reducedMotionRef.current)
      .finally(() => setEdgeHidden(false));
  }, [cancelHide]);

  const refresh = useCallback(async () => {
    if (!settings.codexEnabled) return;
    if (settings.startupBehavior === "showWhenCodexStarts" && !await bridge.isWindowVisible()) return;
    setRefreshing(true);
    try { setStatus(await bridge.refresh()); }
    catch (error) {
      setStatus((current) => ({ ...current, connection: current.updatedAt ? "offline" : "error", message: error instanceof Error ? error.message : String(error) }));
    } finally { setRefreshing(false); }
  }, [settings.codexEnabled, settings.startupBehavior]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setSystemReducedMotion(media.matches);
    sync(); media.addEventListener("change", sync);
    const loadSettings = () => {
      void bridge.getSettings().then((loaded) => {
        if (cancelled) return;
        setSettings(loaded); setReady(true);
        if (loaded.codexEnabled) setStatus((current) => ({ ...current, connection: "connecting" }));
      }).catch(() => {
        if (!cancelled) retryTimer = window.setTimeout(loadSettings, 80);
      });
    };
    loadSettings();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      media.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!ready || !settings.codexEnabled) return;
    refresh();
    const refreshInterval = window.setInterval(refresh, 30_000);
    const clockInterval = window.setInterval(() => setClockTick((tick) => tick + 1), 10_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(refreshInterval); window.clearInterval(clockInterval);
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, settings.codexEnabled, refresh]);

  useEffect(() => {
    const appearance = window.matchMedia("(prefers-color-scheme: light)");
    const syncAppearance = () => {
      document.documentElement.dataset.theme = settings.theme;
      document.documentElement.dataset.resolvedTheme = settings.theme === "system"
        ? appearance.matches ? "light" : "dark"
        : settings.theme;
    };
    syncAppearance();
    appearance.addEventListener("change", syncAppearance);
    document.documentElement.style.setProperty("--hud-opacity", String(settings.opacity));
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
    return () => appearance.removeEventListener("change", syncAppearance);
  }, [settings.theme, settings.opacity, reducedMotion]);

  useEffect(() => {
    if (!ready || expanded) return;
    if (appliedBaseSurfaceRef.current === baseSurface) return;
    appliedBaseSurfaceRef.current = baseSurface;
    let cancelled = false;
    setSurfacePending(true);
    void afterNextPaint()
      .then(() => bridge.setSurface(baseSurface))
      .then((next) => {
        if (!cancelled && next?.edge !== undefined) setDockedEdge(next.edge ?? undefined);
      })
      .catch(() => {
        if (!cancelled) appliedBaseSurfaceRef.current = undefined;
      })
      .finally(() => {
        if (!cancelled) setSurfacePending(false);
      });
    return () => { cancelled = true; };
  }, [ready, expanded, baseSurface]);

  const openPanel = useCallback(async (openSettings = false) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    if (phase !== "closed") { if (openSettings) setSettingsOpen(true); return; }
    if (surfaceBusyRef.current) return;
    surfaceBusyRef.current = true;
    cancelHide();
    setEdgeHidden(false); setSettingsOpen(openSettings); setSurfacePending(true);
    await afterNextPaint();
    try {
      const next = await bridge.setSurface("expanded");
      if (next) setLayout(next);
      setPhase("opening"); setSurfacePending(false);
      await afterNextPaint();
      setPhase("open");
    } catch {
      setSurfacePending(false);
    } finally {
      surfaceBusyRef.current = false;
    }
  }, [phase, cancelHide]);

  const closePanel = useCallback(() => {
    if (phase === "closed" || phase === "closing" || surfaceBusyRef.current) return;
    surfaceBusyRef.current = true;
    setSettingsOpen(false); setPhase("closing");
    closeTimer.current = window.setTimeout(async () => {
      try {
        const compact = await completeCompactTransition({
          commitCompact: () => bridge.commitCompactSurface(status, refreshing),
          showCompact: () => setPhase("closed"),
          afterCompactPaint: afterNextPaint,
          finishHandoff: bridge.finishCompactHandoff,
        });
        if (compact?.edge !== undefined) setDockedEdge(compact.edge ?? undefined);
      } catch {
        void bridge.finishCompactHandoff();
        setSurfacePending(true);
        try {
          const restored = await bridge.applyExpandedLayout(false);
          if (restored) {
            layoutRef.current = restored;
            setLayout(restored);
          }
        } catch {
          // Keep the existing recovery behavior if the native handoff itself fails.
        }
        setPhase("open");
      } finally {
        setSurfacePending(false);
        surfaceBusyRef.current = false;
      }
    }, reducedMotion ? 0 : 170);
  }, [phase, reducedMotion, status, refreshing]);
  closePanelRef.current = closePanel;

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    surfaceBusyRef.current = false;
    cancelHide();
    finishDragging();
  }, [cancelHide, finishDragging]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (settingsOpen) setSettingsOpen(false); else closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, closePanel]);

  useEffect(() => {
    if (!isTauri()) return;
    const disposers: Array<() => void> = [];
    import("@tauri-apps/api/event").then(({ listen }) => Promise.all([
      listen("halo://refresh", refresh),
      listen("halo://settings", () => { void openPanel(true); }),
      listen("halo://reveal", () => { reveal(); void refresh(); }),
    ]).then((items) => disposers.push(...items)));
    return () => disposers.forEach((dispose) => dispose());
  }, [refresh, openPanel, reveal]);

  useEffect(() => {
    if (!isTauri()) return;
    let dispose = () => {};
    bridge.trackFocus((focused) => {
      if (!focused && expandedRef.current && !draggingRef.current && !surfaceBusyRef.current) closePanelRef.current();
    }).then((unlisten) => { dispose = unlisten; });
    return () => dispose();
  }, []);

  const enable = async () => { setStatus((current) => ({ ...current, connection: "connecting" })); setSettings(await bridge.setCodexEnabled(true)); };
  const disable = async () => {
    setSettings(await bridge.setCodexEnabled(false)); setStatus(disabledStatus); setSettingsOpen(false); setPhase("closed");
  };
  const updateSettings = async (next: Settings) => { setSettings(next); setSettings(await bridge.saveSettings(next)); };
  const nativeDrag = async () => {
    if (surfaceBusyRef.current) return false;
    const wasExpanded = expandedRef.current;
    if (wasExpanded) {
      surfaceBusyRef.current = true;
      cancelHide();
      setSurfacePending(true);
      setPhase("closed");
      expandedRef.current = false;
      await afterNextPaint();
      try {
        const compact = await bridge.setSurface("compact");
        if (compact?.edge !== undefined) setDockedEdge(compact.edge ?? undefined);
      } catch {
        setPhase("open");
        expandedRef.current = true;
        setSurfacePending(false);
        surfaceBusyRef.current = false;
        return false;
      }
      setSurfacePending(false);
      surfaceBusyRef.current = false;
      await afterNextPaint();
    }
    markDragging();
    dockedEdgeRef.current = undefined;
    setDockedEdge(undefined); setEdgeHidden(false);
    try {
      const outcome = await bridge.startDragging();
      finishDragging();
      if (outcome.settled) {
        const edge = outcome.settled.edge ?? undefined;
        dockedEdgeRef.current = edge;
        setDockedEdge(edge);
        setEdgeHidden(false);
        cancelHide();
        if (edge && !wasExpanded) armHideTimer();
      }
      if (outcome.layout && expandedRef.current) {
        surfaceBusyRef.current = true;
        const current = layoutRef.current;
        const pending: SurfaceReflow = {
          layout: outcome.layout,
          offsetX: current.orbX - outcome.layout.orbX,
          offsetY: current.orbY - outcome.layout.orbY,
          active: false,
        };
        setSurfaceReflow(pending);
        await afterNextPaint();
        setSurfaceReflow({ ...pending, active: true });
        try {
          const applied = await bridge.applyExpandedLayout(!reducedMotionRef.current);
          if (applied) {
            layoutRef.current = applied;
            setLayout(applied);
          }
        } catch {
          // Keep the completed native drag even if an adaptive reflow cannot be applied.
        } finally {
          await new Promise<void>((resolve) => window.setTimeout(resolve, reducedMotionRef.current ? 0 : 104));
          setSurfaceReflow(undefined);
          surfaceBusyRef.current = false;
        }
      }
      if (wasExpanded && outcome.moved) {
        surfaceBusyRef.current = true;
        setSurfacePending(true);
        await afterNextPaint();
        try {
          const next = await bridge.setSurface("expanded");
          if (next) {
            layoutRef.current = next;
            setLayout(next);
          }
          setDockedEdge(undefined);
          setPhase("opening");
          expandedRef.current = true;
          setSurfacePending(false);
          await afterNextPaint();
          setPhase("open");
        } catch {
          setPhase("closed");
          expandedRef.current = false;
          setSurfacePending(false);
        } finally {
          surfaceBusyRef.current = false;
        }
      }
      return outcome.moved;
    } catch {
      finishDragging();
      return false;
    }
  };
  useEffect(() => {
    if (settings.visibilityMode !== "autoHide" || !settings.edgeAutoHide || !dockedEdge) {
      cancelHide();
      if (edgeHidden) reveal(); else setEdgeHidden(false);
    }
  }, [settings.visibilityMode, settings.edgeAutoHide, dockedEdge, edgeHidden, cancelHide, reveal]);

  if (!ready) return <div className="boot-orbit" aria-label="Loading CodexHalo"><i /></div>;
  if (!settings.codexEnabled) return <Onboarding onEnable={enable} onClose={() => bridge.hideWindow()} busy={status.connection === "connecting"} />;
  if (status.connection === "unauthenticated") return <main className="auth-reference">
    <button onClick={() => bridge.hideWindow()} aria-label="Hide CodexHalo"><CloseIcon /></button>
    <h2>Codex isn't connected yet</h2><p>Connect Codex to view quota and usage.</p>
    <button className="auth-reference__primary" onClick={() => void bridge.startLogin()}>Sign in with Codex</button>
    <button className="auth-reference__secondary" onClick={disable}>Disable Codex</button>
  </main>;

  if (!expanded) return <div className={`hud-shell hud-shell--compact ${dockedEdge ? `edge-${dockedEdge}` : ""} ${edgeHidden ? "is-edge-hidden" : ""} ${surfacePending ? "is-surface-pending" : ""}`}
    onMouseEnter={cancelHide} onMouseLeave={armHideTimer}>
    <FloatingOrb status={status} refreshing={refreshing} reducedMotion={reducedMotion} dragging={dragging}
      quotaWindowMinutes={settings.quotaWindowMinutes}
      onExpand={() => { void openPanel(); }} onStartDrag={nativeDrag} />
    {dockedEdge && <EdgeRevealHandle edge={dockedEdge} visible={edgeHidden} onReveal={reveal} />}
  </div>;

  const activeLayout = surfaceReflow?.layout ?? layout;
  const joinX = Math.max(24, Math.min(248, activeLayout.orbX + 74 - activeLayout.panelX));
  const joinY = Math.max(24, Math.min(400, activeLayout.orbY + 16 - activeLayout.panelY));
  const panelJoin = activeLayout.placement === "above" ? "bottom" : activeLayout.placement === "below" ? "top" : activeLayout.placement === "left" ? "right" : "left";
  const capsuleJoin = activeLayout.placement === "above" ? "top" : activeLayout.placement === "below" ? "bottom" : activeLayout.placement;
  const transformOrigin = activeLayout.placement === "above" || activeLayout.placement === "below"
    ? `${joinX}px ${panelJoin}`
    : `${panelJoin} ${joinY}px`;
  const reflowX = surfaceReflow && !surfaceReflow.active ? surfaceReflow.offsetX : 0;
  const reflowY = surfaceReflow && !surfaceReflow.active ? surfaceReflow.offsetY : 0;
  const layerTransition = surfaceReflow?.active && !reducedMotion
    ? "transform 96ms cubic-bezier(.33, 1, .68, 1)"
    : "none";
  return <div className={`hud-shell hud-shell--expanded ${surfacePending ? "is-surface-pending" : ""}`} onPointerDown={(event) => { if (event.target === event.currentTarget) closePanel(); }}>
    <div className="expanded-surface-layer" style={{
      transform: `translate3d(${reflowX}px, ${reflowY}px, 0)`,
      transition: layerTransition,
    }}>
      <div className={`panel-frame panel-frame--join-${panelJoin} ${phase === "open" ? "is-open" : ""}`} style={{ left: activeLayout.panelX, top: activeLayout.panelY, transformOrigin }}>
        {settingsOpen
          ? <SettingsSheet settings={settings} windows={status.windows} onChange={updateSettings} onDisable={disable} onClose={() => setSettingsOpen(false)} />
          : <ExpandedPanel status={status} refreshing={refreshing} reducedMotion={reducedMotion} quotaWindowMinutes={settings.quotaWindowMinutes} onRefresh={refresh} onSettings={() => setSettingsOpen(true)} />}
      </div>
      <div className={`expanded-orb expanded-orb--join-${capsuleJoin} ${phase === "open" || phase === "closing" ? "is-open" : ""} ${phase === "closing" ? "is-closing" : ""}`} style={{ left: activeLayout.orbX, top: activeLayout.orbY }}>
        <FloatingOrb status={status} refreshing={refreshing} reducedMotion={reducedMotion} dragging={dragging}
          quotaWindowMinutes={settings.quotaWindowMinutes}
          dragEnabled={phase === "open" && !surfacePending && !surfaceReflow} action="collapse"
          onExpand={closePanel} onStartDrag={nativeDrag} />
      </div>
    </div>
    <div className="compact-surface-handoff" aria-hidden="true">
      <FloatingOrb status={status} refreshing={refreshing} reducedMotion={reducedMotion} quotaWindowMinutes={settings.quotaWindowMinutes}
        dragEnabled={false} action="expand" onExpand={() => {}} onStartDrag={async () => false} />
    </div>
  </div>;
}

export default function App() {
  const handoff = isTauri()
    ? getCurrentWindow().label === "compact-handoff"
    : new URLSearchParams(window.location.search).get("surface") === "handoff";
  return handoff ? <CompactHandoff /> : <MainApp />;
}
