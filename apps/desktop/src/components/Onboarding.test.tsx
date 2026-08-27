import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  it("exposes an explicit window close action", () => {
    const onClose = vi.fn();

    const { container } = render(<Onboarding onEnable={() => {}} onClose={onClose} busy={false} />);
    expect(container.querySelector("[data-tauri-drag-region]")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close CodexHalo" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
