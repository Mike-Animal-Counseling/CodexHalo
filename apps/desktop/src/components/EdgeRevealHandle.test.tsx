import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EdgeRevealHandle } from "./EdgeRevealHandle";

describe("EdgeRevealHandle", () => {
  afterEach(cleanup);

  it.each(["left", "right", "top", "bottom"] as const)("adapts to the %s screen edge", (edge) => {
    render(<EdgeRevealHandle edge={edge} visible onReveal={() => {}} />);
    expect(screen.getByRole("button", { name: /reveal codexhalo/i })).toHaveClass(`edge-reveal-handle--${edge}`);
  });

  it("reveals from pointer, keyboard focus, or click", () => {
    const onReveal = vi.fn();
    render(<EdgeRevealHandle edge="left" visible onReveal={onReveal} />);
    const handle = screen.getByRole("button");
    fireEvent.pointerEnter(handle);
    fireEvent.focus(handle);
    fireEvent.click(handle);
    expect(onReveal).toHaveBeenCalledTimes(3);
  });

  it("leaves an inactive handle out of the tab order", () => {
    render(<EdgeRevealHandle edge="right" visible={false} onReveal={() => {}} />);
    const handle = screen.getByRole("button", { hidden: true });
    expect(handle).toHaveAttribute("tabindex", "-1");
    expect(handle).toHaveAttribute("aria-hidden", "true");
  });
});
