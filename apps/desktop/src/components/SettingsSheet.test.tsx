import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../types";
import { SettingsSheet } from "./SettingsSheet";

const windows = [
  { id: "short", durationMinutes: 240, usedPercent: 28 },
  { id: "long", durationMinutes: 4320, usedPercent: 57 },
];

describe("SettingsSheet", () => {
  afterEach(cleanup);

  it("lets the user explicitly choose the primary quota window", () => {
    const onChange = vi.fn();
    render(<SettingsSheet settings={defaultSettings} windows={windows} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "4H" }));
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, quotaWindowMinutes: 240 });
  });

  it("hides the primary selector when Codex returns fewer than two windows", () => {
    render(<SettingsSheet settings={defaultSettings} windows={[windows[0]]} onChange={vi.fn()} onDisable={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("Primary limit")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "3D" })).not.toBeInTheDocument();
  });

  it("returns to the details panel from the header control", () => {
    const onClose = vi.fn();
    render(<SettingsSheet settings={defaultSettings} windows={windows} onChange={vi.fn()} onDisable={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to details" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sends an explicit appearance choice", () => {
    const onChange = vi.fn();
    render(<SettingsSheet settings={defaultSettings} windows={windows} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, theme: "light" });
  });

  it("defaults startup behavior to off and persists an explicit selection", () => {
    const onChange = vi.fn();
    render(<SettingsSheet settings={defaultSettings} windows={windows} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Startup behavior" })).toHaveValue("off");
    fireEvent.change(screen.getByRole("combobox", { name: "Startup behavior" }), { target: { value: "showWhenCodexStarts" } });
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, startupBehavior: "showWhenCodexStarts" });
  });
});
