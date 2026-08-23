import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, isTauri } from "./lib/bridge";
import { defaultSettings, emptyUsage, type DashboardStatus, type Settings } from "./types";
import { Capsule } from "./components/Capsule";
import { ExpandedPanel } from "./components/ExpandedPanel";
import { Onboarding } from "./components/Onboarding";
import "./styles.css";

const disabledStatus: DashboardStatus = {
  connection: "disabled",
  windows: [],
  tokens: emptyUsage,
  pricing: { unavailableModels: [], version: "2026-08-23" },
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<DashboardStatus>(disabledStatus);
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [edgeHidden, setEdgeHidden] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!settings.codexEnabled) return;
    setRefreshing(true);
    try {
      setStatus(await bridge.refresh());
    } catch (error) {
      setStatus((current) => ({
        ...current,
        connection: current.updatedAt ? "offline" : "error",
        message: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setRefreshing(false);
    }
  }, [settings.codexEnabled]);

  useEffect(() => {
    bridge.getSettings().then((loaded) => {
      setSettings(loaded);
      setReady(true);
      if (loaded.codexEnabled) {
        setStatus((current) => ({ ...current, connection: "connecting" }));
      }
    });
  }, []);

  useEffect(() => {
    if (!ready || !settings.codexEnabled) return;
    refresh();
    const interval = window.setInterval(refresh, 90_000);
    return () => window.clearInterval(interval);
  }, [ready, settings.codexEnabled, refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty("--hud-opacity", String(settings.opacity));
  }, [settings.theme, settings.opacity]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) {
        setSettingsOpen(false);
        setExpanded(false);
        bridge.resize(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (!isTauri()) return;
    const disposers: Array<() => void> = [];
    import("@tauri-apps/api/event").then(({ listen }) =>
      Promise.all([
        listen("halo://refresh", refresh),
        listen("halo://settings", () => { setExpanded(true); setSettingsOpen(true); bridge.resize(true); }),
      ]).then((items) => disposers.push(...items))
    );
    bridge.trackPosition().then((unlisten) => disposers.push(unlisten));
    return () => disposers.forEach((dispose) => dispose());
  }, [refresh]);

  const enable = async () => {
    setStatus((current) => ({ ...current, connection: "connecting" }));
    const saved = await bridge.setCodexEnabled(true);
    setSettings(saved);
  };

  const disable = async () => {
    const saved = await bridge.setCodexEnabled(false);
    setSettings(saved);
    setStatus(disabledStatus);
    setExpanded(false);
    setSettingsOpen(false);
    await bridge.resize(false);
  };

  const updateSettings = async (next: Settings) => {
    setSettings(next);
    setSettings(await bridge.saveSettings(next));
  };

  const setPanelExpanded = async (value: boolean) => {
    setExpanded(value);
    if (!value) setSettingsOpen(false);
    setEdgeHidden(false);
    await bridge.resize(value);
  };

  const scheduleHide = () => {
    if (settings.visibilityMode !== "autoHide" || expanded) return;
    hideTimer.current = window.setTimeout(() => setEdgeHidden(true), 2200);
  };
  const reveal = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    setEdgeHidden(false);
  };

  if (!ready) return <div className="boot-orbit" aria-label="Loading CodexHalo"><i /><i /></div>;
  if (!settings.codexEnabled) return <Onboarding onEnable={enable} busy={status.connection === "connecting"} />;

  if (status.connection === "unauthenticated") {
    return <main className="auth-state">
      <div className="wordmark"><span>CODEX</span><strong>HALO</strong></div>
      <h2>Codex isn't connected.</h2>
      <p>Sign in through the official Codex flow, then refresh this HUD.</p>
      <button className="enable-button" onClick={async () => {
        const url = await bridge.startLogin();
        if (url) await bridge.openExternal(url);
      }}>Sign in with Codex</button>
      <button className="text-button" onClick={disable}>Disable Codex</button>
    </main>;
  }

  return (
    <div className={`hud-shell ${expanded ? "is-expanded" : ""} ${edgeHidden ? "is-edge-hidden" : ""}`}
      onMouseEnter={reveal} onMouseLeave={scheduleHide}>
      {!expanded && <span className="edge-handle" aria-hidden="true" />}
      {expanded ? (
        <ExpandedPanel status={status} settings={settings} settingsOpen={settingsOpen} refreshing={refreshing}
          onClose={() => setPanelExpanded(false)} onRefresh={refresh} onSettings={() => setSettingsOpen((value) => !value)}
          onSettingsChange={updateSettings} onDisable={disable} />
      ) : (
        <div data-tauri-drag-region>
          <Capsule status={status} style={settings.hudStyle} refreshing={refreshing} onExpand={() => setPanelExpanded(true)} />
        </div>
      )}
    </div>
  );
}
