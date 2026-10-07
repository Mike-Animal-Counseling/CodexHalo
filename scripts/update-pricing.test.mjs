import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog, parsePricingMarkdown } from "./update-pricing.mjs";

const fixture = (rows) => "### Standard pricing data\n| Model | Input | Cached | Writes | Output | Long input | Long cached | Long writes | Long output |\n" + rows + "\n### Batch pricing data\n| gpt-future | $1 | $0.1 | $1.25 | $5 | - | - | - | - |\n| Codex | gpt-codex-future | $3 | $0.3 | $12 |\n| Codex | gpt-codex-future | $6 | $0.6 | $24 |\n";

test("takes Standard rates, keeps long-context tiers, and excludes Batch/Fast", () => {
  const models = parsePricingMarkdown(fixture("| gpt-future | $2 | $0.2 | $2.5 | $10 | $4 | $0.4 | $5 | $15 |"));
  assert.equal(models.find(model => model.id === "gpt-future").rates.inputPerMillion, 2);
  assert.equal(models.find(model => model.id === "gpt-future").longContext.rates.outputPerMillion, 15);
  assert.equal(models.find(model => model.id === "gpt-codex-future").rates.inputPerMillion, 3);
});

test("accepts an unknown future exact identity without guessing an alias", () => {
  const models = parsePricingMarkdown(fixture("| gpt-9.2-sample | $7 | - | - | $21 | - | - | - | - |"));
  const model = models.find(model => model.id === "gpt-9.2-sample");
  assert.equal(model.rates.inputPerMillion, 7);
  assert.equal(model.rates.cachedInputPerMillion, null);
  assert.equal(model.aliases, undefined);
});

test("fails when the official table changes shape or emits unsafe rates", () => {
  assert.throws(() => parsePricingMarkdown("No Standard pricing table"));
  assert.throws(() => parsePricingMarkdown(fixture("| gpt-future | $2 | $0.2 | $10 |")));
  assert.throws(() => parsePricingMarkdown(fixture("| gpt-future | ?2 | - | - | $10 | - | - | - | - |")));
  assert.throws(() => parsePricingMarkdown(fixture("| gpt-future | $999999 | - | - | $10 | - | - | - | - |")));
  assert.throws(() => parsePricingMarkdown(fixture("| gpt-future | $2 | ?0.2 | - | $10 | - | - | - | - |")));
});

test("keeps timestamps stable for unchanged prices and retains reviewed legacy aliases", () => {
  const published = parsePricingMarkdown(fixture("| gpt-future | $2 | $0.2 | - | $10 | - | - | - | - |"));
  const existing = { models: [...published, { id: "legacy-codex", aliases: ["legacy-codex-2026-01-01"], rates: { inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 3 } }] };
  const next = buildCatalog(existing, published, "2026-10-05");
  assert.ok(next.models.find(model => model.id === "legacy-codex"));
  assert.equal(buildCatalog(next, published, "2026-10-06"), next);
});
