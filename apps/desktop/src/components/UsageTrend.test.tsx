import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageHistoryDay } from "../lib/history";
import { UsageTrend } from "./UsageTrend";

const history: UsageHistoryDay[] = [
  { date: "2026-10-04", tokens: { input: 100, output: 0, total: 100, byModel: { "gpt-test": { input: 100, output: 0, total: 100 } } },
    pricing: { value: .2, unavailableModels: [], version: "test" } },
  { date: "2026-10-05", tokens: { input: 200, output: 0, total: 200, byModel: { "gpt-future": { input: 200, output: 0, total: 200 } } },
    pricing: { unavailableModels: ["gpt-future"], version: "test" } },
];

describe("UsageTrend", () => {
  afterEach(cleanup);

  it("switches between daily and monthly periods while keeping the full token subtotal", () => {
    const onRangeChange = vi.fn();
    const { container } = render(<UsageTrend history={history} onRangeChange={onRangeChange} />);
    expect(within(screen.getByRole("group", { name: "Daily token usage" })).getAllByRole("button")).toHaveLength(7);
    expect(container.querySelector(".usage-trend__summary")?.textContent).toContain("300 tokens");
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(within(screen.getByRole("group", { name: "Daily token usage" })).getAllByRole("button")).toHaveLength(30);
    fireEvent.click(screen.getByRole("button", { name: "Last year" }));
    expect(within(screen.getByRole("group", { name: "Monthly token usage" })).getAllByRole("button")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Last year" })).toHaveAttribute("aria-pressed", "true");
    expect(onRangeChange).toHaveBeenLastCalledWith("1y");
    expect(container.querySelector(".usage-trend__summary")?.textContent).toContain("300 tokens");
  });

  it("lets keyboard users inspect daily values with arrows, Home and End", () => {
    render(<UsageTrend history={history} />);
    const points = within(screen.getByRole("group", { name: "Daily token usage" })).getAllByRole("button");
    expect(points[6]).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(points[6], { key: "ArrowLeft" });
    expect(points[5]).toHaveFocus();
    expect(points[5]).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(points[5], { key: "Home" });
    expect(points[0]).toHaveFocus();
    fireEvent.keyDown(points[0], { key: "End" });
    expect(points[6]).toHaveFocus();
  });

  it("labels a partial API estimate and respects the cost visibility preference", () => {
    const { container, rerender } = render(<UsageTrend history={history} reducedMotion />);
    expect(screen.getByText("API equivalent · partial")).toBeInTheDocument();
    expect(screen.getByText("≈$0.20")).toBeInTheDocument();
    expect(container.querySelector(".usage-trend")).toHaveClass("usage-trend--still");
    rerender(<UsageTrend history={history} showApiEquivalent={false} />);
    expect(screen.queryByText(/API equivalent · partial/)).not.toBeInTheDocument();
    expect(screen.queryByText("≈$0.20")).not.toBeInTheDocument();
  });

  it("explains an empty local history without suggesting unavailable model prices are zero", () => {
    render(<UsageTrend history={[]} />);
    expect(screen.getByText("Use Codex to start your activity history.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Daily token usage" })).not.toBeInTheDocument();
  });
});
