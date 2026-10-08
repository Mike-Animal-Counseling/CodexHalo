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
  it("supports a custom reset reminder lead and zero minutes at reset", () => {
    const onChange = vi.fn();
    render(<SettingsSheet settings={{ ...defaultSettings, resetReminderEnabled: true }} windows={windows} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    const lead = screen.getByRole("spinbutton", { name: "Minutes before reset" });
    fireEvent.change(lead, { target: { value: "47" } });
    fireEvent.blur(lead);
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultSettings, resetReminderEnabled: true, resetReminderMinutes: 47 });
    fireEvent.change(lead, { target: { value: "0" } });
    fireEvent.keyDown(lead, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultSettings, resetReminderEnabled: true, resetReminderMinutes: 0 });
  });

  it("bounds reminder lead and restores an empty draft", () => {
    const onChange = vi.fn();
    render(<SettingsSheet settings={{ ...defaultSettings, resetReminderEnabled: true }} windows={windows} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    const lead = screen.getByRole("spinbutton", { name: "Minutes before reset" });
    fireEvent.change(lead, { target: { value: "99999" } }); fireEvent.blur(lead);
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultSettings, resetReminderEnabled: true, resetReminderMinutes: 10080 });
    onChange.mockClear();
    fireEvent.change(lead, { target: { value: "" } }); fireEvent.blur(lead);
    expect(onChange).not.toHaveBeenCalled(); expect(lead).toHaveValue(15);
  });

  it("lets offline users disable automatic public price checks", () => {
    const onChange = vi.fn();
    render(<SettingsSheet settings={defaultSettings} windows={windows} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Prices" }));
    fireEvent.click(screen.getByRole("switch", { name: /Update prices automatically/ }));
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, autoSyncPricing: false });
  });
  it("navigates independent settings pages without exposing unrelated controls", () => {
    const { container } = render(<SettingsSheet settings={{ ...defaultSettings, resetReminderEnabled: true }} windows={windows}
      onChange={vi.fn()} onDisable={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Startup behavior" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Minutes before reset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Update prices automatically/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    expect(container.querySelector(".settings-content")).toHaveAttribute("data-page", "reminders");
    expect(screen.getByRole("button", { name: "Reminders" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("spinbutton", { name: "Minutes before reset" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Startup behavior" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prices" }));
    expect(screen.getByRole("switch", { name: /Update prices automatically/ })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Notify before reset/ })).not.toBeInTheDocument();
    expect(screen.getByText(/App upgrades use the GitHub installer/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByRole("button", { name: "Disable Codex" })).toBeInTheDocument();
  });

  it("keeps price-sync feedback when switching settings pages", async () => {
    const onSyncPricing = vi.fn().mockResolvedValue("Prices are up to date.");
    render(<SettingsSheet settings={defaultSettings} windows={windows} onChange={vi.fn()}
      onDisable={vi.fn()} onClose={vi.fn()} onSyncPricing={onSyncPricing} />);
    fireEvent.click(screen.getByRole("button", { name: "Prices" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for price updates" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Prices are up to date.");
    expect(onSyncPricing).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prices" }));
    expect(screen.getByRole("status")).toHaveTextContent("Prices are up to date.");
  });

  it("keeps reminder feedback when switching settings pages", async () => {
    const onTestReminder = vi.fn().mockResolvedValue(undefined);
    render(<SettingsSheet settings={{ ...defaultSettings, resetReminderEnabled: true }} windows={windows} onChange={vi.fn()}
      onDisable={vi.fn()} onClose={vi.fn()} onTestReminder={onTestReminder} />);
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    fireEvent.click(screen.getByRole("button", { name: "Send test reminder" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Test sent. Check Windows notifications.");
    expect(onTestReminder).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Prices" }));
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    expect(screen.getByRole("status")).toHaveTextContent("Test sent. Check Windows notifications.");
  });

  it("keeps future quota windows selectable without adding more rows", () => {
    const onChange = vi.fn();
    const manyWindows = [...windows,
      { id: "burst", durationMinutes: 60, usedPercent: 8 },
      { id: "monthly", durationMinutes: 43200, usedPercent: 4 },
    ];
    render(<SettingsSheet settings={defaultSettings} windows={manyWindows} onChange={onChange} onDisable={vi.fn()} onClose={vi.fn()} />);
    const selector = screen.getByRole("combobox", { name: "Primary limit" });
    expect(selector.querySelectorAll("option")).toHaveLength(4);
    fireEvent.change(selector, { target: { value: "60" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultSettings, quotaWindowMinutes: 60 });
  });
});
