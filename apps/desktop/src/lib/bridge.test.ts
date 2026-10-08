import { afterEach, expect, it, vi } from "vitest";
import { bridge } from "./bridge";
import { emptyUsage, type DashboardStatus } from "../types";
const calls = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: calls.invoke }));
afterEach(() => { delete window.__TAURI_INTERNALS__; vi.clearAllMocks(); });
it("sends only capsule fields across the handoff IPC boundary", async () => {
  window.__TAURI_INTERNALS__ = {};
  const status: DashboardStatus = { connection: "ready", windows: [], updatedAt: 123,
    tokens: { ...emptyUsage, total: 987 }, pricing: { version: "test", unavailableModels: [] },
    history: [{ date: "2026-10-08", tokens: emptyUsage }], message: "private detail" };
  await bridge.commitCompactSurface(status, false);
  expect(calls.invoke).toHaveBeenCalledWith("commit_compact_surface", {
    status: { connection: "ready", windows: [], updatedAt: 123 }, refreshing: false,
  });
});
