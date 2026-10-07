# Data model

RateLimitWindow stores a stable identifier, duration in minutes, used
percentage, and optional reset epoch. The backend preserves every valid
structured quota window and does not assume that a particular duration will
exist forever. The v1 UI renders only returned windows. When multiple durations
are present, an optional duration preference chooses the primary display; if it
is missing or stale, the longest currently available returned window is used.
No second window is invented when Codex reports only one.

TokenUsage stores input, cached input, output, reasoning output, total, and a
per-model map. The parser uses turn_context.payload.model as authoritative
per-turn metadata, with structured token-record model fields as a fallback.
Unknown future model IDs are preserved verbatim; unknown-codex is used only when
no reliable model metadata exists.

Rollout records from all selected active and archived files are grouped by
thread, ordered by timestamp and ordinal, and deduplicated before cumulative
snapshots are converted to deltas. Baselines advance across file boundaries and
days, so resumed sessions count only new work. Counter resets start a new epoch,
independent threads remain independent, and inherited subagent history advances
the child baseline without being counted twice.

PricingEstimate is versioned independently from model identity. Cached input is
subtracted from normal input before each published base-rate component is
calculated. The displayed value is the subtotal for models with known prices;
used models without a published price remain named in unavailableModels and do
not turn into Unclassified. Zero usage produces a zero estimate.

API equivalent is informational, not an invoice or the user's subscription
bill. Aggregate counters cannot reliably apply request-specific long-context,
service-tier, regional, or tool charges.

UsageHistoryDay holds a local calendar date, TokenUsage, and PricingEstimate.
A trailing calendar year is read with one cross-file deduplication pass and
gap-filled daily buckets. Historical days are cached for five minutes; today
refreshes with the live dashboard. The frontend shows 7 or 30 daily bars and
12 rolling monthly intervals for the year. All rows in a dashboard refresh
use one captured pricing catalog and one local date. Historical API equivalents
are recalculated at the selected catalog rates, not stored past invoices.

PricingEstimate also includes per-model TokenUsage/rates/value components,
unknown-model coverage, estimation assumptions, catalog origin, and last-check
metadata. Model matching is exact or uses reviewed explicit aliases. All-unknown
usage yields an unavailable value; mixed usage yields a marked subtotal.
