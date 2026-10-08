import { useMemo, useRef, useState } from "react";
import { compactNumber, currency } from "../lib/format";
import { buildUsageTrend, calendarDateLabel, type UsageHistoryDay, type UsageRange, type UsageTrendBucket } from "../lib/history";
import type { PricingEstimate } from "../types";
import "./UsageTrend.css";

const periods: { value: UsageRange; label: string; name: string }[] = [
  { value: "7d", label: "7d", name: "Last 7 days" },
  { value: "30d", label: "30d", name: "Last 30 days" },
  { value: "1y", label: "1y", name: "Last year" },
];

function priceLabel(pricing: PricingEstimate) {
  return pricing.value == null ? "Unavailable" : "≈" + currency(pricing.value);
}

function bucketLabel(bucket: UsageTrendBucket) {
  return bucket.startDate === bucket.endDate ? bucket.label
    : calendarDateLabel(bucket.startDate) + " – " + calendarDateLabel(bucket.endDate);
}

export function UsageTrend({ history, reducedMotion = false, showApiEquivalent = true, onRangeChange }: {
  history: UsageHistoryDay[];
  reducedMotion?: boolean;
  showApiEquivalent?: boolean;
  onRangeChange?: (range: UsageRange) => void;
}) {
  const [range, setRange] = useState<UsageRange>("7d");
  const [selected, setSelected] = useState<number | null>(null);
  const pointButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const data = useMemo(() => buildUsageTrend(history, range), [history, range]);
  const activeIndex = Math.min(selected ?? data.buckets.length - 1, data.buckets.length - 1);
  const activeBucket = data.buckets[activeIndex];
  const maxTokens = Math.max(1, ...data.buckets.map((bucket) => bucket.tokens.total));
  const periodName = periods.find((period) => period.value === range)!.name;
  const partial = data.pricing.unavailableModels.length > 0 && data.pricing.value != null;
  const pricingTip = data.pricing.unavailableModels.length
    ? "Pricing unavailable for: " + data.pricing.unavailableModels.join(", ") + ". Their tokens are included in usage."
    : "Estimated at published API token rates. This is informational and not an additional charge.";

  return <section className={"usage-trend" + (reducedMotion ? " usage-trend--still" : "")} aria-label="Usage history">
    <header className="usage-trend__header">
      <strong>Activity</strong>
      <div className="usage-trend__periods" role="group" aria-label="Usage period">
        {periods.map((period) => <button key={period.value} type="button" aria-label={period.name}
          aria-pressed={range === period.value} onClick={() => {
            setRange(period.value);
            setSelected(null);
            onRangeChange?.(period.value);
          }}>{period.label}</button>)}
      </div>
    </header>
    {!history.length ? <p className="usage-trend__empty">Use Codex to start your activity history.</p> : <>
      <div className="usage-trend__summary">
        <div><strong>{compactNumber(data.tokens.total)}<small> tokens</small></strong><span>{periodName}</span></div>
        {showApiEquivalent && <div className="usage-trend__cost" title={pricingTip}>
          <strong>{priceLabel(data.pricing)}</strong><span>API equivalent{partial ? " · partial" : ""}</span>
        </div>}
      </div>
      <div className="usage-trend__chart" role="group" aria-label={range === "1y" ? "Monthly token usage" : "Daily token usage"}
        onMouseLeave={() => { if (!pointButtons.current.includes(document.activeElement as HTMLButtonElement)) setSelected(null); }}>
        <span className="usage-trend__ceiling" aria-hidden="true">{compactNumber(maxTokens === 1 && data.tokens.total === 0 ? 0 : maxTokens)}</span>
        <div className="usage-trend__bars">
          {data.buckets.map((bucket, index) => <button key={bucket.endDate} type="button"
            ref={(element) => { pointButtons.current[index] = element; }}
            className={"usage-trend__point" + (index === activeIndex ? " is-selected" : "") + (bucket.tokens.total === 0 ? " is-empty" : "")}
            aria-label={bucketLabel(bucket) + ": " + bucket.tokens.total.toLocaleString("en") + " tokens" +
              (showApiEquivalent ? ", API equivalent " + priceLabel(bucket.pricing) + (bucket.pricing.unavailableModels.length && bucket.pricing.value != null ? ", partial" : "") : "")}
            tabIndex={index === activeIndex ? 0 : -1}
            onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
              else if (event.key === "ArrowRight") next = Math.min(data.buckets.length - 1, index + 1);
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = data.buckets.length - 1;
              else return;
              event.preventDefault();
              pointButtons.current[next]?.focus();
            }}>
            <i style={{ height: Math.max(0, bucket.tokens.total) / maxTokens * 100 + "%" }} />
          </button>)}
        </div>
      </div>
      <div className="usage-trend__axis" aria-hidden="true">
        <span>{calendarDateLabel(data.startDate)}</span><span>{calendarDateLabel(data.endDate)}</span>
      </div>
      <div className="usage-trend__detail" aria-live="polite" aria-atomic="true">
        <span>{bucketLabel(activeBucket)}</span><strong>{compactNumber(activeBucket.tokens.total)} tokens</strong>
      </div>
      <dl className="usage-trend__tokens" aria-label="Selected period token breakdown">
        <div><dt>Input</dt><dd>{compactNumber(activeBucket.tokens.input)}</dd></div>
        <div><dt>Cached</dt><dd>{compactNumber(activeBucket.tokens.cachedInput ?? 0)}</dd></div>
        <div><dt>Output</dt><dd>{compactNumber(activeBucket.tokens.output)}</dd></div>
      </dl>
      <p className="usage-trend__note">Local session history.{showApiEquivalent ? " Values use current catalog prices." : ""}</p>
    </>}
  </section>;
}
