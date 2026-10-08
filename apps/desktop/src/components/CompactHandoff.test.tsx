import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../types";
import { CompactHandoff, type CompactHandoffPayload } from "./CompactHandoff";

const events = vi.hoisted(() => ({ receive: undefined as undefined | ((event: { payload: CompactHandoffPayload }) => void), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_name, callback) => { events.receive = callback; return events.unlisten; }) }));

const payload = (sequence: number): CompactHandoffPayload => ({
  sequence, settings: { ...defaultSettings, codexEnabled: true, theme: "dark" }, refreshing: false,
  status: { connection: "ready", windows: [{ id: "test", durationMinutes: 300, usedPercent: 25 }] },
});
const emit = (next: CompactHandoffPayload) => act(() => events.receive?.({ payload: next }));

afterEach(() => { cleanup(); events.receive = undefined; vi.clearAllMocks(); });

describe("handoff data lifecycle", () => {
  it("drops the capsule on completion or revocation and rejects delayed old payloads", async () => {
    const { container } = render(<CompactHandoff />);
    await waitFor(() => expect(events.receive).toBeDefined());
    emit(payload(1));
    expect(container.querySelector("button")).not.toBeNull();
    emit({ ...payload(2), status: null });
    expect(container).toBeEmptyDOMElement();
    emit(payload(1));
    expect(container).toBeEmptyDOMElement();
    emit(payload(3));
    expect(container.querySelector("button")).not.toBeNull();
    emit({ ...payload(4), status: null, settings: { ...defaultSettings, codexEnabled: false } });
    emit(payload(3));
    expect(container).toBeEmptyDOMElement();
    emit(payload(5));
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("rejects disabled payloads and unsubscribes when unmounted", async () => {
    const { container, unmount } = render(<CompactHandoff />);
    await waitFor(() => expect(events.receive).toBeDefined());
    emit({ ...payload(1), settings: { ...defaultSettings, codexEnabled: false } });
    expect(container).toBeEmptyDOMElement();
    unmount();
    expect(events.unlisten).toHaveBeenCalledOnce();
  });
});
