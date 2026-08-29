import { describe, expect, it, vi } from "vitest";
import { completeCompactTransition } from "./compactTransition";

describe("completeCompactTransition", () => {
  it("keeps the native handoff visible until the compact React surface is painted", async () => {
    const order: string[] = [];
    const result = await completeCompactTransition({
      commitCompact: async () => { order.push("native-compact"); return "layout"; },
      showCompact: () => { order.push("react-compact"); },
      afterCompactPaint: async () => { order.push("painted"); },
      finishHandoff: async () => { order.push("hide-handoff"); },
    });
    expect(result).toBe("layout");
    expect(order).toEqual(["native-compact", "react-compact", "painted", "hide-handoff"]);
  });

  it("does not reopen the panel when hiding an already-painted handoff fails", async () => {
    const showCompact = vi.fn();
    await expect(completeCompactTransition({
      commitCompact: async () => "layout",
      showCompact,
      afterCompactPaint: async () => {},
      finishHandoff: async () => { throw new Error("handoff already gone"); },
    })).resolves.toBe("layout");
    expect(showCompact).toHaveBeenCalledOnce();
  });
});
