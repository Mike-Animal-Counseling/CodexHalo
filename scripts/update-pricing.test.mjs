import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog, parsePricingMarkdown } from "./update-pricing.mjs";

const simpleHeader = "| gpt-future | $1 | $5 | $0.1 |\n";

// Current official layout: a short/long-context table followed by a legacy table without cache writes.
const fixture = (rows) => [
  "### Standard pricing data",
  "| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  rows,
  "",
  "| Model | Input | Output | Cached input |",
  "| --- | --- | --- | --- |",
  "| gpt-legacy | $2 | $10 | $0.2 |",
  "",
  "### Batch pricing data",
  simpleHeader,
  "### Grouped Pricing Table data",
  "| Category | Model | Input | Output | Cached input |",
  "| --- | --- | --- | --- | --- |",
  "| Codex | gpt-codex-future | $3 | $12 | $0.3 |",
  "| Codex | gpt-codex-future | $6 | $24 | $0.6 |",
].join("\n");

// Pre-October-2026 official layout, kept for a stale page mirror.
const legacyFixture = [
  "### Standard pricing data",
  "| Model | Input | Cached | Writes | Output | Long input | Long cached | Long writes | Long output |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| gpt-past | $2 | $0.2 | $2.5 | $10 | $4 | $0.4 | $5 | $15 |",
  "",
  "### Batch pricing data",
].join("\n");

test("takes Standard rates, keeps long-context tiers, and excludes Batch/Fast", () => {
  const models = parsePricingMarkdown(fixture("| gpt-future | $2 | $10 | $0.2 | $2.5 | $4.25 | $4 | $15 | $0.4 | $5 | $8.5 |"));
  const model = models.find(candidate => candidate.id === "gpt-future");
  assert.deepEqual(model.rates, { inputPerMillion: 2, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5, outputPerMillion: 10 });
  assert.equal(model.longContext.rates.outputPerMillion, 15);
  assert.equal(model.longContext.rates.cacheWritePerMillion, 5);
  assert.equal(models.find(candidate => candidate.id === "gpt-codex-future").rates.inputPerMillion, 3);
  assert.equal(models.find(candidate => candidate.id === "gpt-codex-future").rates.outputPerMillion, 12);
  assert.equal(models.find(candidate => candidate.id === "gpt-codex-future").rates.cachedInputPerMillion, 0.3);
});

test("reads the legacy table without cache-write rates and the older nine-column layout", () => {
  const models = parsePricingMarkdown(fixture("| gpt-future | $2 | $10 | $0.2 | $2.5 | $4.25 | $4 | $15 | $0.4 | $5 | $8.5 |"));
  const legacy = models.find(candidate => candidate.id === "gpt-legacy");
  assert.deepEqual(legacy.rates, { inputPerMillion: 2, cachedInputPerMillion: 0.2, outputPerMillion: 10 });
  assert.equal(legacy.longContext, undefined);
  const past = parsePricingMarkdown(legacyFixture).find(candidate => candidate.id === "gpt-past");
  assert.equal(past.rates.cacheWritePerMillion, 2.5);
  assert.equal(past.longContext.rates.outputPerMillion, 15);
});

test("accepts an unknown future exact identity without guessing an alias", () => {
  const models = parsePricingMarkdown(fixture("| gpt-9.2-sample | $7 | $21 | - | - | - | - | - | - | - | - |"));
  const model = models.find(candidate => candidate.id === "gpt-9.2-sample");
  assert.equal(model.rates.inputPerMillion, 7);
  assert.equal(model.rates.cachedInputPerMillion, null);
  assert.equal(model.longContext, undefined);
  assert.equal(model.aliases, undefined);
});

test("strips the documented long-context suffix from the model identity", () => {
  const models = parsePricingMarkdown(fixture("| gpt-5.5 (<272K context length) | $5 | $30 | $0.5 | - | - | $10 | $45 | $1 | - | - |"));
  assert.ok(models.some(candidate => candidate.id === "gpt-5.5"));
});

test("fails when the official table changes shape or emits unsafe rates", () => {
  assert.throws(() => parsePricingMarkdown("No Standard pricing table"));
  assert.throws(() => parsePricingMarkdown(fixture("| gpt-future | $2 | $0.2 | $10 |")));
  assert.throws(() => parsePricingMarkdown(fixture("| gpt-future | ?2 | $10 | - | - | - | - | - | - | - | - |")));
  assert.throws(() => parsePricingMarkdown(fixture("| gpt-future | $999999 | $10 | - | - | - | - | - | - | - | - |")));
  assert.throws(() => parsePricingMarkdown(fixture("| gpt-future | $2 | $10 | ?0.2 | - | - | - | - | - | - | - |")));
  assert.throws(() => parsePricingMarkdown(fixture("| gpt-future | $2 | $10 | - | - | - | $5 | - | - | - |")));
  const renamed = fixture("| gpt-future | $2 | $10 | - | - | - | - | - | - | - | - |")
    .replace("| Short context cached input |", "| Cache read |");
  assert.throws(() => parsePricingMarkdown(renamed));
  const duplicated = fixture("| gpt-future | $2 | $10 | - | - | - | - | - | - | - | - |");
  assert.throws(() => parsePricingMarkdown(duplicated.replace("| gpt-legacy |", "| gpt-future |")));
});

test("keeps timestamps stable for unchanged prices and retains reviewed legacy aliases", () => {
  const published = parsePricingMarkdown(fixture("| gpt-future | $2 | $10 | $0.2 | - | - | - | - | - | - | - |"));
  const existing = { models: [...published, { id: "legacy-codex", aliases: ["legacy-codex-2026-01-01"],
    rates: { inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 3 } }] };
  const next = buildCatalog(existing, published, "2026-10-05");
  assert.ok(next.models.find(model => model.id === "legacy-codex"));
  assert.equal(buildCatalog(next, published, "2026-10-06"), next);
});
