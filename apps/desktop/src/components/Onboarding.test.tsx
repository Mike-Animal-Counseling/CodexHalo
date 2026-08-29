import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  afterEach(cleanup);

  it("uses explicit consent-neutral copy", () => {
    render(<Onboarding onEnable={() => {}} onClose={() => {}} busy={false} />);
    expect(screen.getByText(/Codex access is off by default/)).toBeInTheDocument();
    expect(screen.getByText("Your choice will be remembered for future launches.")).toBeInTheDocument();
    expect(screen.queryByText(/refresh automatically/i)).not.toBeInTheDocument();
  });

  it("exposes an explicit window hide action", () => {
    const onClose = vi.fn();

    const { container } = render(<Onboarding onEnable={() => {}} onClose={onClose} busy={false} />);
    expect(container.querySelector("[data-tauri-drag-region]")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide CodexHalo" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
