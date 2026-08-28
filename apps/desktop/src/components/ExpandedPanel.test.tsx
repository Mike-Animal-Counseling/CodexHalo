import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardStatus } from "../types";
import { ExpandedPanel } from "./ExpandedPanel";

const now = Math.floor(Date.now() / 1000);
const status: DashboardStatus = {
  connection: "ready",
  windows: [
    { id: "short", durationMinutes: 240, usedPercent: 68, resetsAt: now + 7200 },
    { id: "long", durationMinutes: 4320, usedPercent: 57, resetsAt: now + 172800 },
  ],
  tokens: { input: 100, cachedInput: 50, output: 20, reasoning: 0, total: 170, byModel: {} },
  pricing: { value: 0.01, unavailableModels: [], version: "test" },
  updatedAt: Date.now(),
};

describe("ExpandedPanel quota windows", () => {
  afterEach(cleanup);

  it("renders only returned windows and defaults to the longest duration", () => {
    render(<ExpandedPanel status={status} refreshing={false} reducedMotion={false} onRefresh={vi.fn()} onSettings={vi.fn()} />);

    const long = screen.getByRole("region", { name: "3 days quota" });
    const short = screen.getByRole("region", { name: "4 hours quota" });
    expect(within(long).getByText("43% left")).toBeInTheDocument();
    expect(within(short).getByText("32% left")).toBeInTheDocument();
    expect(within(short).getByText(/^Resets /)).toBeInTheDocument();
    expect(short.querySelector<HTMLElement>('[data-quota="short"]')?.style.width).toBe("32%");
    expect(screen.getByRole("img", { name: "3 days 43% remaining" })).toBeInTheDocument();
  });

  it("puts an available preferred duration first and uses it for the main ring", () => {
    const { container } = render(<ExpandedPanel status={status} refreshing={false} reducedMotion={false} quotaWindowMinutes={240} onRefresh={vi.fn()} onSettings={vi.fn()} />);
    expect(screen.getByRole("img", { name: "4 hours 32% remaining" })).toBeInTheDocument();
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".quota-stack > .quota-row"));
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["4 hours quota", "3 days quota"]);
  });

  it("uses the warning color for the selected returned window", () => {
    const warningStatus = {
      ...status,
      windows: status.windows.map((window) => window.durationMinutes === 240 ? { ...window, usedPercent: 45 } : window),
    };
    const { container } = render(<ExpandedPanel status={warningStatus} refreshing={false} reducedMotion={false} quotaWindowMinutes={240} onRefresh={vi.fn()} onSettings={vi.fn()} />);
    expect(screen.getByRole("img", { name: "4 hours 55% remaining" })).toHaveClass("quota-ring--warn");
    expect(container.querySelector('.quota-row [data-quota="short"]')).toHaveClass("warn");
  });

  it("does not invent a second row when Codex returns one window", () => {
    const single = { ...status, windows: [status.windows[0]] };
    const { container } = render(<ExpandedPanel status={single} refreshing={false} reducedMotion={false} quotaWindowMinutes={4320} onRefresh={vi.fn()} onSettings={vi.fn()} />);
    expect(screen.getByRole("region", { name: "4 hours quota" })).toBeInTheDocument();
    expect(container.querySelectorAll(".quota-stack > .quota-row")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "4 hours 32% remaining" })).toBeInTheDocument();
  });

  it("keeps every returned future window available in the fixed panel", () => {
    const future = {
      ...status,
      windows: [
        ...status.windows,
        { id: "burst", durationMinutes: 60, usedPercent: 12, resetsAt: now + 1800 },
      ],
    };
    const { container } = render(<ExpandedPanel status={future} refreshing={false} reducedMotion={false} onRefresh={vi.fn()} onSettings={vi.fn()} />);
    expect(container.querySelectorAll(".quota-stack > .quota-row")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "1 hour quota" })).toBeInTheDocument();
    expect(container.querySelector(".panel")).toHaveClass("panel--many-quotas");
  });

  it("renders a generic unavailable ring and no phantom rows when no window exists", () => {
    const empty = { ...status, windows: [] };
    const { container } = render(<ExpandedPanel status={empty} refreshing={false} reducedMotion={false} quotaWindowMinutes={300} onRefresh={vi.fn()} onSettings={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Codex quota unavailable" })).toBeInTheDocument();
    expect(container.querySelectorAll(".quota-stack > .quota-row")).toHaveLength(0);
  });

  it("displays an unknown future model ID and excludes it from the priced subtotal", () => {
    const futureStatus: DashboardStatus = {
      ...status,
      tokens: {
        input: 500_000,
        cachedInput: 0,
        output: 0,
        reasoning: 0,
        total: 500_000,
        byModel: {
          "gpt-5.7-example": { input: 500_000, cachedInput: 0, output: 0, reasoning: 0, total: 500_000 },
        },
      },
      pricing: { value: 0, unavailableModels: ["gpt-5.7-example"], version: "test" },
    };
    render(<ExpandedPanel status={futureStatus} refreshing={false} reducedMotion={false} onRefresh={vi.fn()} onSettings={vi.fn()} />);
    expect(screen.getByText("gpt-5.7-example")).toBeInTheDocument();
    expect(screen.queryByText(/unclassified/i)).not.toBeInTheDocument();
    expect(screen.getByText("≈ $0.00")).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /API equivalent/i }));
    expect(screen.getByText(/Excludes models without a published price: gpt-5.7-example/)).toBeInTheDocument();
  });

  it("shows a zero API equivalent when usage is empty and pricing is known", () => {
    const emptyStatus: DashboardStatus = {
      ...status,
      tokens: { input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0, byModel: {} },
      pricing: { value: 0, unavailableModels: [], version: "test" },
    };
    render(<ExpandedPanel status={emptyStatus} refreshing={false} reducedMotion={false} onRefresh={vi.fn()} onSettings={vi.fn()} />);
    expect(screen.getByText("≈ $0.00")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });
});
