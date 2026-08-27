import { describe, expect, it } from "vitest";
import { shouldRetractEdge } from "./edgeHide";

const base = {
  dockedEdge: "right" as const,
  dragging: false,
  expanded: false,
  visibilityMode: "autoHide" as const,
  edgeAutoHide: true,
};

describe("shouldRetractEdge", () => {
  it("only retracts a settled compact orb at a real edge", () => {
    expect(shouldRetractEdge(base)).toBe(true);
    expect(shouldRetractEdge({ ...base, dockedEdge: undefined })).toBe(false);
    expect(shouldRetractEdge({ ...base, expanded: true })).toBe(false);
    expect(shouldRetractEdge({ ...base, dragging: true })).toBe(false);
  });

  it("respects visibility preferences", () => {
    expect(shouldRetractEdge({ ...base, visibilityMode: "always" })).toBe(false);
    expect(shouldRetractEdge({ ...base, edgeAutoHide: false })).toBe(false);
  });
});
