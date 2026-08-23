# Data model

`RateLimitWindow` stores a stable id, duration in minutes, used percentage, and optional reset epoch. The UI derives remaining percentage and labels 300 minutes as 5H and 10080 minutes as WEEK.

`TokenUsage` stores input, cached input, output, reasoning, total, and a per-model map. The parser aggregates only `last_token_usage` deltas so cumulative session totals are not double-counted.

`PricingEstimate` is versioned separately. Cached input is subtracted from normal input before each price component is calculated. Any used model absent from the local table makes the whole displayed estimate unavailable.
