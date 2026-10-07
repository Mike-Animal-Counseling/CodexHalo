import { describe, expect, it } from "vitest";
import type { PricingEstimate, TokenUsage } from "../types";
import { buildUsageTrend, offsetCalendarDay, type UsageHistoryDay } from "./history";

function day(date: string, total: number, model = "gpt-test", pricing?: PricingEstimate): UsageHistoryDay {
  const usage = { input: total, output: 0, total };
  const tokens: TokenUsage = { ...usage, byModel: { [model]: usage } };
  return { date, tokens, pricing };
}

const published = (value: number): PricingEstimate => ({ value, unavailableModels: [], version: "test" });

describe("usage history calendar ranges", () => {
  it("fills missing local dates and keeps only the selected period", () => {
    const result = buildUsageTrend([
      day("2026-10-05", 20), day("2026-09-28", 900), day("2026-10-01", 10),
      day("2026-02-30", 800),
    ], "7d");
    expect(result.startDate).toBe("2026-09-29");
    expect(result.endDate).toBe("2026-10-05");
    expect(result.buckets.map((bucket) => bucket.tokens.total)).toEqual([0, 0, 10, 0, 0, 0, 20]);
    expect(result.tokens.total).toBe(30);
    expect(result.tokens.byModel["gpt-test"].input).toBe(30);
    expect(result.tokens.cachedInput).toBeUndefined();
  });

  it("keeps one bucket per date through spring and autumn DST boundaries", () => {
    expect(offsetCalendarDay("2026-03-08", 1)).toBe("2026-03-09");
    expect(offsetCalendarDay("2026-11-01", 1)).toBe("2026-11-02");
    const spring = buildUsageTrend([day("2026-03-10", 1)], "7d");
    expect(spring.buckets.map((bucket) => bucket.startDate)).toEqual([
      "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10",
    ]);
    const autumn = buildUsageTrend([day("2026-11-03", 1)], "7d");
    expect(autumn.buckets).toHaveLength(7);
    expect(autumn.buckets[4].startDate).toBe("2026-11-01");
  });

  it("puts the full leap year into 12 calendar-month buckets exactly once", () => {
    const history: UsageHistoryDay[] = [];
    for (let date = "2023-03-02"; date <= "2024-03-01"; date = offsetCalendarDay(date, 1)) history.push(day(date, 1));
    const result = buildUsageTrend(history, "1y");
    expect(result.dayCount).toBe(366);
    expect(result.buckets).toHaveLength(12);
    expect(result.tokens.total).toBe(366);
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.tokens.total, 0)).toBe(366);
    expect(result.buckets[0].startDate).toBe("2023-03-02");
    expect(result.buckets[11].endDate).toBe("2024-03-01");
    result.buckets.slice(1).forEach((bucket, index) => {
      expect(bucket.startDate).toBe(offsetCalendarDay(result.buckets[index].endDate, 1));
    });
  });

  it("clamps month endings without dropping dates from the yearly summary", () => {
    const result = buildUsageTrend([day("2025-03-01", 1), day("2025-03-31", 2)], "1y");
    expect(result.startDate).toBe("2024-04-01");
    expect(result.buckets[11].startDate).toBe("2025-03-01");
    expect(result.buckets[11].tokens.total).toBe(3);
    expect(result.tokens.total).toBe(3);
    const leapEnding = buildUsageTrend([day("2024-02-29", 1)], "1y");
    expect(leapEnding.startDate).toBe("2023-03-01");
    expect(leapEnding.dayCount).toBe(366);
  });
});

describe("usage history price summaries", () => {
  it("keeps unknown models in token totals and marks their API subtotal partial", () => {
    const result = buildUsageTrend([
      day("2026-10-01", 10, "gpt-test", published(1.25)),
      day("2026-10-05", 20, "gpt-future", { unavailableModels: ["gpt-future"], version: "test" }),
    ], "7d");
    expect(result.tokens.total).toBe(30);
    expect(result.pricing.value).toBe(1.25);
    expect(result.pricing.unavailableModels).toEqual(["gpt-future"]);
    expect(result.tokens.byModel["gpt-future"].total).toBe(20);
  });

  it("does not turn unavailable prices into a zero-dollar estimate using empty days", () => {
    const result = buildUsageTrend([
      day("2026-10-04", 10, "gpt-future"), day("2026-10-05", 0, "gpt-test", published(0)),
    ], "7d");
    expect(result.pricing.value).toBeUndefined();
    expect(result.pricing.unavailableModels).toEqual(["gpt-future"]);
    expect(buildUsageTrend([], "7d", "2026-10-05").pricing.value).toBe(0);
  });

  it("preserves cached, reasoning and model counters when combining daily usage", () => {
    const first = day("2026-10-04", 20, "gpt-test", published(.02));
    first.tokens.cachedInput = 8;
    first.tokens.reasoning = 2;
    first.tokens.byModel["gpt-test"].cachedInput = 8;
    first.tokens.byModel["gpt-test"].reasoning = 2;
    const second = day("2026-10-05", 30, "gpt-test", published(.03));
    const result = buildUsageTrend([first, second], "7d");
    expect(result.tokens.cachedInput).toBe(8);
    expect(result.tokens.reasoning).toBe(2);
    expect(result.tokens.byModel["gpt-test"].total).toBe(50);
    expect(result.pricing.value).toBeCloseTo(.05);
  });
});
