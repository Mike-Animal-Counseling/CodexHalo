import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const officialUrl = "https://developers.openai.com/api/docs/pricing";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(root, "data", "pricing.json");
const maxBytes = 256 * 1024;
const identityPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

// Current official table: short-context rates have two cache-write tiers (30m/12h),
// followed by a long-context tier above the 272K input threshold.
const shortContextColumns = {
  input: "Short context input",
  output: "Short context output",
  cached: "Short context cached input",
  write: "Short context 30m write",
  write12h: "Short context 12h write",
  longInput: "Long context input",
  longOutput: "Long context output",
  longCached: "Long context cached input",
  longWrite: "Long context 30m write",
  longWrite12h: "Long context 12h write",
};

// Pre-October-2026 official table, kept so a stale mirror of the page still parses.
const legacyColumns = {
  input: "Input",
  cached: "Cached",
  write: "Writes",
  output: "Output",
  longInput: "Long input",
  longCached: "Long cached",
  longWrite: "Long writes",
  longOutput: "Long output",
};

// Older models are published in a separate table without cache-write rates.
const simpleColumns = { input: "Input", output: "Output", cached: "Cached input" };

function rate(text) {
  if (text === "-") return null;
  if (!/^\$\d+(?:\.\d+)?$/.test(text)) throw new Error("Unexpected official token price: " + text);
  const value = Number(text.slice(1));
  if (!Number.isFinite(value) || value < 0 || value > 100_000) throw new Error("Token price is outside catalog bounds");
  return value;
}

function pricing(input, cached, write, output) {
  if (input === null || output === null) throw new Error("Input and output prices are required");
  return {
    inputPerMillion: input,
    cachedInputPerMillion: cached,
    ...(write === null ? {} : { cacheWritePerMillion: write }),
    outputPerMillion: output,
  };
}

function modelId(cell) {
  const id = cell.replace(/\s*\(<272K context length\)$/, "");
  if (!identityPattern.test(id)) throw new Error("Unexpected official model identifier: " + id);
  return id;
}

// Every markdown table in the page, as its header cells and its body rows.
function tables(markdown) {
  const split = (line) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  const groups = [];
  let group = [];
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("|")) group.push(line);
    else if (group.length) {
      groups.push(group);
      group = [];
    }
  }
  if (group.length) groups.push(group);
  return groups.map((lines) => {
    const header = split(lines[0]);
    const rows = lines.slice(1).map(split).filter((row) => !row.every((cell) => /^-+$/.test(cell)));
    for (const row of rows) if (row.length !== header.length) throw new Error("Unexpected official pricing table shape");
    return { header, rows };
  });
}

// Resolve the columns we depend on by header name so a reordered table is never misread.
function columns(header, labels) {
  const positions = new Map(header.map((label, position) => [label, position]));
  if (positions.size !== header.length) throw new Error("Duplicate column in official pricing table");
  return Object.fromEntries(Object.entries(labels).map(([key, label]) => {
    const position = positions.get(label);
    if (position === undefined) throw new Error("Official pricing table is missing the " + label + " column");
    return [key, position];
  }));
}

function standardRows(table, models) {
  const { header, rows } = table;
  if (header[0] !== "Model") throw new Error("Unexpected official pricing table");
  const shape = header.includes("Short context input") ? "short" : header.includes("Long input") ? "legacy" : "simple";
  for (const row of rows) {
    const id = modelId(row[0]);
    if (models.has(id)) throw new Error("Duplicate model in Standard pricing table");
    if (shape === "short") {
      if (header.length !== 11) throw new Error("Unexpected official Standard table shape");
      const at = columns(header, shortContextColumns);
      // The catalog records one cache-write rate, so the 12h tier is validated but not stored.
      rate(row[at.write12h]);
      const entry = { id, rates: pricing(rate(row[at.input]), rate(row[at.cached]), rate(row[at.write]), rate(row[at.output])) };
      if (row[at.longInput] !== "-") {
        rate(row[at.longWrite12h]);
        entry.longContext = { inputThreshold: 272_000,
          rates: pricing(rate(row[at.longInput]), rate(row[at.longCached]), rate(row[at.longWrite]), rate(row[at.longOutput])) };
      }
      models.set(id, entry);
    } else if (shape === "legacy") {
      if (header.length !== 9) throw new Error("Unexpected official Standard table shape");
      const at = columns(header, legacyColumns);
      const entry = { id, rates: pricing(rate(row[at.input]), rate(row[at.cached]), rate(row[at.write]), rate(row[at.output])) };
      if (row[at.longInput] !== "-") {
        entry.longContext = { inputThreshold: 272_000,
          rates: pricing(rate(row[at.longInput]), rate(row[at.longCached]), rate(row[at.longWrite]), rate(row[at.longOutput])) };
      }
      models.set(id, entry);
    } else {
      if (header.length !== 4) throw new Error("Unexpected official Standard table shape");
      const at = columns(header, simpleColumns);
      models.set(id, { id, rates: pricing(rate(row[at.input]), rate(row[at.cached]), null, rate(row[at.output])) });
    }
  }
}

function codexRows(table, models) {
  const { header, rows } = table;
  if (!header.includes("Category") || header.length !== 5) return;
  const at = columns(header, { category: "Category", model: "Model", ...simpleColumns });
  for (const row of rows) {
    if (row[at.category] !== "Codex") continue;
    // Specialized Codex pricing has a Standard table and then a Fast table.
    // Keep the first published row for each exact identity, never a family-prefix guess.
    const id = row[at.model].replaceAll("\x60", "");
    if (!identityPattern.test(id)) throw new Error("Unexpected official Codex identifier");
    if (!models.has(id)) models.set(id, { id, rates: pricing(rate(row[at.input]), rate(row[at.cached]), null, rate(row[at.output])) });
  }
}

export function parsePricingMarkdown(markdown) {
  const start = markdown.indexOf("### Standard pricing data");
  const end = markdown.indexOf("### Batch pricing data", start);
  if (start < 0 || end < start) throw new Error("Official Standard pricing table was not found");
  const models = new Map();
  for (const table of tables(markdown.slice(start, end))) standardRows(table, models);
  for (const table of tables(markdown)) codexRows(table, models);
  if (models.size === 0 || models.size > 1024) throw new Error("Invalid official model count");
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
}

export function buildCatalog(existing, published, day) {
  const publishedIds = new Set(published.map(model => model.id));
  // Preserve explicitly reviewed legacy identities no longer in the main price table.
  // Their prices can be edited directly when official legacy model docs change.
  const legacy = (existing.models ?? []).filter(model => !publishedIds.has(model.id));
  const aliases = new Map((existing.models ?? []).map(model => [model.id, model.aliases]));
  const models = [...published.map(model => aliases.get(model.id)?.length
    ? { ...model, aliases: aliases.get(model.id) } : model), ...legacy]
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  if (JSON.stringify(models) === JSON.stringify(existing.models)) return existing;
  return { schemaVersion: 1, version: day, publishedAt: day, currency: "USD",
    pricingMode: "standard", sourceUrl: officialUrl, models };
}

async function update() {
  const existing = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const response = await fetch(officialUrl + ".md", {
    signal: AbortSignal.timeout(15_000), redirect: "error",
    headers: { "User-Agent": "CodexHalo-Pricing-Catalog/1" },
  });
  if (!response.ok) throw new Error("Official pricing fetch failed: HTTP " + response.status);
  const chunks = [];
  let pageBytes = 0;
  for await (const chunk of response.body) {
    pageBytes += chunk.byteLength;
    if (pageBytes > 1024 * 1024) throw new Error("Official pricing page exceeds limit");
    chunks.push(chunk);
  }
  const markdown = Buffer.concat(chunks).toString("utf8");
  const catalog = buildCatalog(existing, parsePricingMarkdown(markdown), new Date().toISOString().slice(0, 10));
  const json = JSON.stringify(catalog, null, 2) + "\n";
  if (Buffer.byteLength(json) > maxBytes) throw new Error("Price catalog exceeds limit");
  if (JSON.stringify(catalog) !== JSON.stringify(existing)) {
    await fs.writeFile(catalogPath, json);
    console.log("Updated price catalog " + catalog.version + " (" + catalog.models.length + " exact model identities)");
  } else console.log("Published token rates are unchanged");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await update();
}
