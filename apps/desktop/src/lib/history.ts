import type { ModelUsage, PricingEstimate, TokenUsage } from "../types";

export type UsageRange = "7d" | "30d" | "1y";

export interface UsageHistoryDay {
  /** A local calendar date returned by the usage reader, not a UTC instant. */
  date: string;
  tokens: TokenUsage;
  pricing?: PricingEstimate;
}

export interface UsageTrendBucket {
  startDate: string;
  endDate: string;
  label: string;
  tokens: TokenUsage;
  pricing: PricingEstimate;
}

export interface UsageTrendData {
  buckets: UsageTrendBucket[];
  tokens: TokenUsage;
  pricing: PricingEstimate;
  startDate: string;
  endDate: string;
  dayCount: number;
}

const blankTokens = (): TokenUsage => ({ input: 0, output: 0, total: 0, byModel: {} });
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && dateKey(date) === value ? date : undefined;
}

export function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

/** Use UTC only as a calendar arithmetic container, so DST cannot skip a date. */
export function offsetCalendarDay(value: string, offset: number) {
  const date = calendarDate(value);
  if (!date) throw new Error("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() + offset);
  return dateKey(date);
}

function offsetCalendarMonth(value: string, offset: number) {
  const date = calendarDate(value)!;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return dateKey(date);
}

export function calendarDateLabel(value: string, monthOnly = false) {
  const date = calendarDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("en", monthOnly
    ? { month: "short", year: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

const optionalSum = (left?: number, right?: number) =>
  left == null && right == null ? undefined : (left ?? 0) + (right ?? 0);

function addUsage(target: ModelUsage, source: ModelUsage) {
  target.input += source.input;
  target.output += source.output;
  target.total += source.total;
  target.cachedInput = optionalSum(target.cachedInput, source.cachedInput);
  target.reasoning = optionalSum(target.reasoning, source.reasoning);
}

function summarize(days: UsageHistoryDay[]) {
  const tokens = blankTokens();
  const unavailable = new Set<string>();
  const estimated = new Set<string>();
  let knownValue = 0;
  let hasKnownValue = false;
  let hasUsage = false;
  let version = "unavailable";
  for (const day of days) {
    addUsage(tokens, day.tokens);
    for (const [model, usage] of Object.entries(day.tokens.byModel)) {
      const modelTokens = tokens.byModel[model] ??= { input: 0, output: 0, total: 0 };
      addUsage(modelTokens, usage);
    }
    hasUsage ||= day.tokens.total > 0;
    if (day.pricing) {
      version = day.pricing.version;
      day.pricing.unavailableModels.forEach((model) => unavailable.add(model));
      day.pricing.estimatedModels?.forEach((model) => estimated.add(model));
      if (day.pricing.value != null) {
        knownValue += day.pricing.value;
        hasKnownValue ||= day.tokens.total > 0;
      }
    } else if (day.tokens.total > 0) {
      const models = Object.keys(day.tokens.byModel);
      (models.length ? models : ["unknown-codex"]).forEach((model) => unavailable.add(model));
    }
  }
  const pricing: PricingEstimate = {
    value: hasKnownValue || !hasUsage ? knownValue : undefined,
    unavailableModels: [...unavailable].sort(),
    estimatedModels: [...estimated].sort(),
    version,
  };
  return { tokens, pricing };
}

export function buildUsageTrend(history: UsageHistoryDay[], range: UsageRange, through?: string): UsageTrendData {
  const sorted = history.filter((day) => calendarDate(day.date)).sort((left, right) => left.date.localeCompare(right.date));
  const endDate = through && calendarDate(through) ? through : sorted.at(-1)?.date ?? localDateKey();
  const startDate = range === "1y"
    ? offsetCalendarDay(offsetCalendarMonth(endDate, -12), 1)
    : offsetCalendarDay(endDate, range === "7d" ? -6 : -29);
  const byDate = new Map(sorted.map((day) => [day.date, day]));
  const days: UsageHistoryDay[] = [];
  for (let date = startDate; date <= endDate; date = offsetCalendarDay(date, 1)) {
    days.push(byDate.get(date) ?? { date, tokens: blankTokens() });
  }
  const buckets: UsageTrendBucket[] = [];
  if (range === "1y") {
    for (let month = 11; month >= 0; month--) {
      const end = offsetCalendarMonth(endDate, -month);
      const start = offsetCalendarDay(offsetCalendarMonth(endDate, -month - 1), 1);
      buckets.push({ startDate: start, endDate: end, label: calendarDateLabel(end, true),
        ...summarize(days.filter((day) => day.date >= start && day.date <= end)) });
    }
  } else {
    days.forEach((day) => buckets.push({ startDate: day.date, endDate: day.date,
      label: calendarDateLabel(day.date), ...summarize([day]) }));
  }
  return { buckets, ...summarize(days), startDate, endDate, dayCount: days.length };
}
