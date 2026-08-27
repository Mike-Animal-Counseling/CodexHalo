import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../types";
import { SettingsSheet } from "./SettingsSheet";

describe("SettingsSheet", () => {
  afterEach(cleanup);

  it("lets the user explicitly choose the primary quota window", () => {
    const onChange = vi.fn();
    render(<SettingsSheet settings={defaultSettings} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "5H" }));
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, quotaFocus: "fiveHour" });
  });

  it("returns to the details panel from the header control", () => {
    const onClose = vi.fn();
    render(<SettingsSheet settings={defaultSettings} onChange={vi.fn()} onDisable={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to details" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sends an explicit appearance choice", () => {
    const onChange = vi.fn();
    render(<SettingsSheet settings={defaultSettings} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, theme: "light" });
  });

  it("defaults startup behavior to off and persists an explicit selection", () => {
    const onChange = vi.fn();
    render(<SettingsSheet settings={defaultSettings} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Startup behavior" })).toHaveValue("off");
    fireEvent.change(screen.getByRole("combobox", { name: "Startup behavior" }), { target: { value: "showWhenCodexStarts" } });
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, startupBehavior: "showWhenCodexStarts" });
  });
});
