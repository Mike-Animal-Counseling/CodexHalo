import { describe, expect, it } from "vitest";
import { freshness, quotaLabel, remaining, timeUntil } from "./format";

describe("quota formatting", () => {
  it("converts used to unambiguous remaining percent", () => {
    expect(remaining({ id: "five-hour", durationMinutes: 300, usedPercent: 28 })).toBe(72);
  });

  it("clamps malformed percentages", () => {
    expect(remaining({ id: "bad", durationMinutes: 300, usedPercent: 140 })).toBe(0);
  });

  it("labels known and future windows", () => {
    expect(quotaLabel(300)).toBe("5H");
    expect(quotaLabel(10080)).toBe("WEEK");
    expect(quotaLabel(1440)).toBe("1D");
  });
});

describe("relative time", () => {
  const now = new Date("2026-08-23T12:00:00Z").getTime();
  it("formats reset countdowns", () => {
    expect(timeUntil(now / 1000 + 8040, now)).toBe("Resets in 2h 14m");
  });
  it("formats freshness", () => {
    expect(freshness(now - 18_000, now)).toBe("Updated 18s ago");
  });
});
