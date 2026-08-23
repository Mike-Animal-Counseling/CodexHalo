import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HaloMeter } from "./HaloMeter";

describe("HaloMeter", () => {
  it("exposes both quota values to assistive technology", () => {
    render(<HaloMeter primary={72} secondary={43} />);
    expect(screen.getByRole("img", { name: /5 hour 72% remaining, week 43% remaining/i })).toBeInTheDocument();
  });
});
