import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardStatus } from "../types";
import { ExpandedPanel } from "./ExpandedPanel";

const now = Math.floor(Date.now() / 1000);
const status: DashboardStatus = {
  connection: "ready",
  windows: [
    { id: "primary", durationMinutes: 300, usedPercent: 68, resetsAt: now + 7200 },
    { id: "secondary", durationMinutes: 10080, usedPercent: 57, resetsAt: now + 172800 },
  ],
  tokens: { input: 100, cachedInput: 50, output: 20, reasoning: 0, total: 170, byModel: {} },
  pricing: { value: 0.01, unavailableModels: [], version: "test" },
  updatedAt: Date.now(),
};

describe("ExpandedPanel quota windows", () => {
  afterEach(cleanup);

  it("keeps Weekly primary and renders the 5-hour window with its own reset", () => {
    render(<ExpandedPanel status={status} refreshing={false} reducedMotion={false} onRefresh={vi.fn()} onSettings={vi.fn()} />);

    const weekly = screen.getByRole("region", { name: "Weekly quota" });
    const fiveHour = screen.getByRole("region", { name: "5 hour quota" });
    expect(within(weekly).getByText("43% left")).toBeInTheDocument();
    expect(within(fiveHour).getByText("32% left")).toBeInTheDocument();
    expect(within(fiveHour).getByText(/^Resets /)).toBeInTheDocument();
    expect(fiveHour.querySelector<HTMLElement>('[data-quota="5h"]')?.style.width).toBe("32%");
  });

  it("puts 5 hour first and uses it for the main ring when selected", () => {
    const { container } = render(<ExpandedPanel status={status} refreshing={false} reducedMotion={false} quotaFocus="fiveHour" onRefresh={vi.fn()} onSettings={vi.fn()} />);
    expect(screen.getByRole("img", { name: "5 hour 32% remaining" })).toBeInTheDocument();
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".quota-stack > .quota-row"));
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["5 hour quota", "Weekly quota"]);
  });

  it("uses the warning color for a selected 5-hour window below 70 percent", () => {
    const warningStatus = {
      ...status,
      windows: status.windows.map((window) => window.durationMinutes === 300 ? { ...window, usedPercent: 45 } : window),
    };
    const { container } = render(<ExpandedPanel status={warningStatus} refreshing={false} reducedMotion={false} quotaFocus="fiveHour" onRefresh={vi.fn()} onSettings={vi.fn()} />);
    expect(screen.getByRole("img", { name: "5 hour 55% remaining" })).toHaveClass("quota-ring--warn");
    expect(container.querySelector('.quota-row [data-quota="5h"]')).toHaveClass("warn");
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
