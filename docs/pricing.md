# Public token-price catalog

CodexHalo shows an API-equivalent estimate in USD using published Standard text-token prices. This is an informational comparison, not a Codex subscription charge, invoice, or conversion of account quota into money.

Prices are separate from app binaries in [data/pricing.json](../data/pricing.json). The bundled catalog was checked against [official OpenAI pricing](https://developers.openai.com/api/docs/pricing) on October 5, 2026. Current GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol, and GPT-6 Luna prices are included. Legacy Codex identities absent from the main table retain individually verified prices from their official model pages.

## How tokens become an estimate

For each model, let I be input tokens, C be cached-input tokens, and O be output tokens. Cached input is part of input, so clamp C to I:

    uncached input = I - min(C, I)
    estimate USD = (uncached input * input rate
                  + min(C, I) * cached-input rate
                  + O * output rate) / 1,000,000

Rates are USD per million tokens. Reasoning tokens are already included in output tokens and are not charged a second time. If cached counts are unavailable, all input is treated as ordinary input. If a model has no cached-input rate, cached input uses its ordinary input rate.

For example, GPT-6.1 Sol at Standard short-context rates has $2 input, $0.10 cached input, and $10 output per million tokens. One million input tokens including 500,000 cached tokens, plus 100,000 output tokens, yields an estimate of $2.05.

The current logs do not identify each request's service tier, long-context tier, or cache-write counters. CodexHalo uses Standard short-context rates and explains these assumptions in the dashboard. A day's combined input exceeding 272,000 tokens does not mean each request used long-context pricing. The catalog stores published long-context rates and cache-write rates for inspection; the estimate cannot reliably apply their premiums from aggregate logs. Tools, regional surcharges, and other fees are outside this token estimate.

Exact model identities and explicitly reviewed aliases determine rates. Future family prefixes never inherit an older model's price. Unknown models are listed without a fabricated value; a mixed-model result is visibly a subtotal of known prices. If all used models lack prices, the estimate is unavailable.

## Refresh and offline behavior

With Codex access and automatic price sync enabled, the app checks a fixed public HTTPS URL at most once every 24 hours:

    https://raw.githubusercontent.com/Mike-Animal-Counseling/CodexHalo/main/data/pricing.json

A manual refresh is also available. The request carries no usage counters, model names, Codex files, account credentials, or subscription information. The response is bounded to 256 KiB, has a 12-second timeout, permits no redirects, and must pass schema, identity, currency, finite-rate, and publication-date validation.

Verified downloaded catalogs are saved in the app's configuration directory. Offline or failed downloads keep the last valid cached catalog; otherwise the app uses bundled prices. The dashboard reports the actual source, last check, and download errors. An unpublished remote file is reported as unavailable, never as a successful sync. The public JSON file must first be published on the repository's main branch before remote sync can work. A catalog older than the current bundled or cached publication date cannot replace it.

## Updating prices without an app release

Run:

    node --test scripts/update-pricing.test.mjs
    node scripts/update-pricing.mjs
    cargo test -p codexhalo-pricing

The updater fetches the official pricing page's Markdown and extracts Standard prices and specialized Codex rows. It keeps Standard separate from Batch and Fast, retains context tiers, accepts newly published exact model IDs, and preserves explicitly reviewed legacy entries and aliases. It fails on unexpected table or price formats. If prices did not change, the version and publication date remain stable.

Review the JSON diff against the cited official documentation, then publish the catalog change through the repository's normal review process. Installed apps pick up the published JSON on their next daily or manual refresh; no application release is needed. Add dated model snapshots only when official documentation establishes that exact identity's rates.

[The scheduled check](../.github/workflows/check-pricing.yml) runs daily and on manual dispatch. Its permissions are read-only; it produces a catalog and diff artifact for review and does not commit or push changes. Fully unattended publication would require an explicitly authorized repository-write workflow.

Schema version 1 accepts only USD Standard rates, unique exact model identities, bounded nonnegative finite prices, a publication date, and the official OpenAI pricing source. Future model rows can be added without changing the schema or Rust code. A future change to the pricing schema itself requires an application update.
