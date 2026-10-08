import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultSettings, emptyUsage, type DashboardStatus } from "./types";
import App from "./App";

const mock = vi.hoisted(() => ({
  bridge: { getSettings: vi.fn(), setCodexEnabled: vi.fn(), refresh: vi.fn(),
    setSurface: vi.fn().mockResolvedValue(null), isWindowVisible: vi.fn().mockResolvedValue(true) },
}));
vi.mock("./lib/bridge", () => ({ bridge: mock.bridge, isTauri: () => false }));
vi.mock("./components/FloatingOrb", () => ({ FloatingOrb: ({ status, onExpand }: { status: DashboardStatus; onExpand: () => void }) =>
  <button onClick={onExpand}>Open quota {status.tokens.total}</button> }));
vi.mock("./components/ExpandedPanel", () => ({ ExpandedPanel: ({ onSettings }: { onSettings: () => void }) =>
  <button onClick={onSettings}>Open settings</button> }));
vi.mock("./components/SettingsSheet", () => ({ SettingsSheet: ({ onDisable }: { onDisable: () => void }) =>
  <button onClick={onDisable}>Disable access</button> }));
vi.mock("./components/Onboarding", () => ({ Onboarding: ({ onEnable }: { onEnable: () => void }) =>
  <button onClick={onEnable}>Enable access</button> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("ignores an old refresh that arrives after disable and re-enable", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1; });
  const old = deferred<DashboardStatus>();
  const current = deferred<DashboardStatus>();
  mock.bridge.getSettings.mockResolvedValue({ ...defaultSettings, codexEnabled: true });
  mock.bridge.setCodexEnabled.mockImplementation(async (enabled: boolean) => ({ ...defaultSettings, codexEnabled: enabled }));
  mock.bridge.refresh.mockReturnValueOnce(old.promise).mockReturnValue(current.promise);
  render(<App />);
  await waitFor(() => expect(mock.bridge.refresh).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Open quota 0" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Disable access" }));
  fireEvent.click(await screen.findByRole("button", { name: "Enable access" }));
  await waitFor(() => expect(mock.bridge.refresh).toHaveBeenCalledTimes(2));
  const status: DashboardStatus = { connection: "ready", windows: [], tokens: { ...emptyUsage, total: 999 },
    pricing: { unavailableModels: [], version: "test" } };
  await act(async () => old.resolve(status));
  expect(screen.getByRole("button", { name: "Open quota 0" })).toBeInTheDocument();
  await act(async () => current.resolve({ ...status, tokens: { ...emptyUsage, total: 123 } }));
  expect(screen.getByRole("button", { name: "Open quota 123" })).toBeInTheDocument();
});
