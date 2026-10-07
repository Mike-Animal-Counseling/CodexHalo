import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EdgeRevealHandle } from "./EdgeRevealHandle";

describe("EdgeRevealHandle", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each(["left", "right", "top", "bottom"] as const)("adapts to the %s screen edge", (edge) => {
    render(<EdgeRevealHandle edge={edge} visible onReveal={() => {}} />);
    expect(screen.getByRole("button", { name: /reveal codexhalo/i })).toHaveClass(`edge-reveal-handle--${edge}`);
  });

  it("reveals after a brief deliberate hover, once per hidden session", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    render(<EdgeRevealHandle edge="left" visible onReveal={onReveal} />);
    const handle = screen.getByRole("button");
    fireEvent.pointerEnter(handle);
    act(() => { vi.advanceTimersByTime(119); });
    expect(onReveal).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onReveal).toHaveBeenCalledOnce();
    fireEvent.focus(handle);
    fireEvent.click(handle);
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("ignores a passing pointer and cancels its pending reveal", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    render(<EdgeRevealHandle edge="right" visible onReveal={onReveal} />);
    fireEvent.pointerEnter(screen.getByRole("button"));
    act(() => { vi.advanceTimersByTime(60); });
    fireEvent.pointerLeave(screen.getByRole("button"));
    act(() => { vi.advanceTimersByTime(200); });
    expect(onReveal).not.toHaveBeenCalled();
  });

  it.each(["focus", "click"] as const)("reveals immediately from %s", (interaction) => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    render(<EdgeRevealHandle edge="left" visible onReveal={onReveal} />);
    const handle = screen.getByRole("button");
    fireEvent.pointerEnter(handle);
    fireEvent[interaction](handle);
    expect(onReveal).toHaveBeenCalledOnce();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("cancels hover when hidden and permits another reveal after hiding again", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const { rerender } = render(<EdgeRevealHandle edge="top" visible onReveal={onReveal} />);
    fireEvent.pointerEnter(screen.getByRole("button"));
    rerender(<EdgeRevealHandle edge="top" visible={false} onReveal={onReveal} />);
    act(() => { vi.advanceTimersByTime(200); });
    expect(onReveal).not.toHaveBeenCalled();
    rerender(<EdgeRevealHandle edge="top" visible onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onReveal).toHaveBeenCalledOnce();
    rerender(<EdgeRevealHandle edge="top" visible={false} onReveal={onReveal} />);
    rerender(<EdgeRevealHandle edge="top" visible onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onReveal).toHaveBeenCalledTimes(2);
  });

  it("cancels pending reveal on unmount", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const { unmount } = render(<EdgeRevealHandle edge="bottom" visible onReveal={onReveal} />);
    fireEvent.pointerEnter(screen.getByRole("button"));
    unmount();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onReveal).not.toHaveBeenCalled();
  });

  it("leaves an inactive handle disabled and out of the tab order", () => {
    const onReveal = vi.fn();
    render(<EdgeRevealHandle edge="right" visible={false} onReveal={onReveal} />);
    const handle = screen.getByRole("button", { hidden: true });
    expect(handle).toHaveAttribute("tabindex", "-1");
    expect(handle).toHaveAttribute("aria-hidden", "true");
    expect(handle).toBeDisabled();
    fireEvent.click(handle);
    expect(onReveal).not.toHaveBeenCalled();
  });
});
