import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardStatus } from "../types";
import { FloatingOrb } from "./FloatingOrb";

const status: DashboardStatus = {
  connection: "ready",
  windows: [
    { id: "primary", durationMinutes: 300, usedPercent: 28 },
    { id: "secondary", durationMinutes: 10080, usedPercent: 57 },
  ],
  tokens: { input: 0, cachedInput: 0, output: 0, reasoning: 0, total: 0, byModel: {} },
  pricing: { unavailableModels: [], version: "test" },
};

describe("FloatingOrb", () => {
  afterEach(cleanup);

  it("keeps quota information minimal and accessible", () => {
    const { container } = render(<FloatingOrb status={status} refreshing={false} reducedMotion={false} onExpand={() => {}} onStartDrag={async () => false} />);
    expect(screen.getByRole("button", { name: /43% weekly quota remaining/i })).toBeInTheDocument();
    expect(screen.queryByText(/tokens/i)).not.toBeInTheDocument();
    const progress = container.querySelector<HTMLElement>('[data-quota="weekly"]');
    expect(progress?.style.width).toBe("43%");
    const expandedProgress = container.querySelector<HTMLElement>(".tech-capsule__expanded-progress i");
    expect(expandedProgress?.style.getPropertyValue("--quota")).toBe("43%");
  });

  it("hands pointerdown to native dragging immediately and uses its result to distinguish a click", async () => {
    const onExpand = vi.fn();
    const onStartDrag = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { getByRole } = render(<FloatingOrb status={status} refreshing={false} reducedMotion={false} onExpand={onExpand} onStartDrag={onStartDrag} />);
    const orb = getByRole("button");

    fireEvent.pointerDown(orb, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await waitFor(() => expect(onStartDrag).toHaveBeenCalledOnce());
    expect(onExpand).not.toHaveBeenCalled();

    fireEvent.pointerDown(orb, { button: 0, pointerId: 2, clientX: 12, clientY: 12 });
    await waitFor(() => expect(onStartDrag).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onExpand).toHaveBeenCalledOnce());
  });

  it("keeps keyboard activation independent from pointer dragging", () => {
    const onExpand = vi.fn();
    render(<FloatingOrb status={status} refreshing={false} reducedMotion={false} onExpand={onExpand} onStartDrag={async () => false} />);
    fireEvent.click(screen.getByRole("button"), { detail: 0 });
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it("shows the contained flow treatment only while dragging", () => {
    const { rerender } = render(<FloatingOrb status={status} refreshing={false} reducedMotion={false} dragging onExpand={() => {}} onStartDrag={async () => true} />);
    expect(screen.getByRole("button")).toHaveClass("is-dragging");
    rerender(<FloatingOrb status={status} refreshing={false} reducedMotion={false} dragging={false} onExpand={() => {}} onStartDrag={async () => true} />);
    expect(screen.getByRole("button")).not.toHaveClass("is-dragging");
  });

  it("keeps native dragging enabled while its click action is collapse", async () => {
    const onStartDrag = vi.fn().mockResolvedValue(true);
    render(<FloatingOrb status={status} refreshing={false} reducedMotion={false} action="collapse" onExpand={() => {}} onStartDrag={onStartDrag} />);
    const orb = screen.getByRole("button", { name: /click to collapse/i });
    fireEvent.pointerDown(orb, { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 14, clientY: 10 });
    await waitFor(() => expect(onStartDrag).toHaveBeenCalledOnce());
  });

  it("collapses on a click without entering the native drag surface handoff", () => {
    const onExpand = vi.fn();
    const onStartDrag = vi.fn().mockResolvedValue(false);
    render(<FloatingOrb status={status} refreshing={false} reducedMotion={false} action="collapse" onExpand={onExpand} onStartDrag={onStartDrag} />);
    const orb = screen.getByRole("button", { name: /click to collapse/i });
    fireEvent.pointerDown(orb, { button: 0, pointerId: 8, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { button: 0, pointerId: 8, clientX: 10, clientY: 10 });
    expect(onStartDrag).not.toHaveBeenCalled();
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it("does not wait for pointer movement while native dragging owns the gesture", async () => {
    let finishDrag!: (moved: boolean) => void;
    const onExpand = vi.fn();
    const onStartDrag = vi.fn(() => new Promise<boolean>((resolve) => { finishDrag = resolve; }));
    render(<FloatingOrb status={status} refreshing={false} reducedMotion={false} onExpand={onExpand} onStartDrag={onStartDrag} />);
    const orb = screen.getByRole("button");
    fireEvent.pointerDown(orb, { button: 0, pointerId: 4, clientX: 10, clientY: 10 });
    expect(onStartDrag).toHaveBeenCalledOnce();
    expect(onExpand).not.toHaveBeenCalled();
    finishDrag(true);
  });

  it("keeps click-to-expand after native dragging emits pointercancel", async () => {
    let finishDrag!: (moved: boolean) => void;
    const onExpand = vi.fn();
    const onStartDrag = vi.fn(() => new Promise<boolean>((resolve) => { finishDrag = resolve; }));
    render(<FloatingOrb status={status} refreshing={false} reducedMotion={false} onExpand={onExpand} onStartDrag={onStartDrag} />);
    const orb = screen.getByRole("button");
    fireEvent.pointerDown(orb, { button: 0, pointerId: 5, clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(orb, { pointerId: 5 });
    finishDrag(false);
    await waitFor(() => expect(onExpand).toHaveBeenCalledOnce());
  });

  it("renders a truthful unavailable state when weekly quota is absent", () => {
    render(<FloatingOrb status={{ ...status, windows: [] }} refreshing={false} reducedMotion={false} onExpand={() => {}} onStartDrag={async () => false} />);
    expect(screen.getByRole("button", { name: /weekly quota unavailable/i })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("syncs capsule styling to the safe, warning, and critical thresholds", () => {
    const withRemaining = (remainingPercent: number): DashboardStatus => ({
      ...status,
      windows: status.windows.map((window) => window.durationMinutes === 10080
        ? { ...window, usedPercent: 100 - remainingPercent }
        : window),
    });
    const { rerender } = render(<FloatingOrb status={withRemaining(70)} refreshing={false} reducedMotion={false} onExpand={() => {}} onStartDrag={async () => false} />);
    expect(screen.getByRole("button")).toHaveClass("tech-capsule--high");
    rerender(<FloatingOrb status={withRemaining(69)} refreshing={false} reducedMotion={false} onExpand={() => {}} onStartDrag={async () => false} />);
    expect(screen.getByRole("button")).toHaveClass("tech-capsule--medium");
    rerender(<FloatingOrb status={withRemaining(29)} refreshing={false} reducedMotion={false} onExpand={() => {}} onStartDrag={async () => false} />);
    expect(screen.getByRole("button")).toHaveClass("tech-capsule--low");
  });

  it("uses the manually selected 5-hour window for the compact capsule", () => {
    const { container } = render(<FloatingOrb status={status} refreshing={false} reducedMotion={false} quotaFocus="fiveHour" onExpand={() => {}} onStartDrag={async () => false} />);
    expect(screen.getByRole("button", { name: /72% 5-hour quota remaining/i })).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('[data-quota="5h"]')?.style.width).toBe("72%");
    expect(container.querySelector<HTMLElement>(".tech-capsule__expanded-progress i")?.style.getPropertyValue("--quota")).toBe("72%");
    expect(screen.getByRole("button")).toHaveClass("tech-capsule--high");
  });

});
