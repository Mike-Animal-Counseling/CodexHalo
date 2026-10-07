import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const officialUrl = "https://developers.openai.com/api/docs/pricing";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(root, "data", "pricing.json");
const maxBytes = 256 * 1024;

function rate(text) {
  if (text === "-") return null;
  if (!/^\$\d+(?:\.\d+)?$/.test(text)) throw new Error("Unexpected official token price: " + text);
  const value = Number(text.slice(1));
  if (!Number.isFinite(value) || value < 0 || value > 100_000) throw new Error("Token price is outside catalog bounds");
  return value;
}

function rates(cells) {
  const [input, cached, writes, output] = cells.map(rate);
  if (input === null || output === null) throw new Error("Input and output prices are required");
  return {
    inputPerMillion: input,
    cachedInputPerMillion: cached,
    ...(writes === null ? {} : { cacheWritePerMillion: writes }),
    outputPerMillion: output,
  };
}

export function parsePricingMarkdown(markdown) {
  const start = markdown.indexOf("### Standard pricing data");
  const end = markdown.indexOf("### Batch pricing data", start);
  if (start < 0 || end < start) throw new Error("Official Standard pricing table was not found");
  const models = new Map();
  for (const line of markdown.slice(start, end).split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
    if (cells[0] === "Model" || /^-+$/.test(cells[0])) continue;
    if (cells.length !== 9) throw new Error("Unexpected official Standard table shape");
    const id = cells[0].replace(/\s*\(<272K context length\)$/, "");
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) throw new Error("Unexpected official model identifier: " + id);
    if (models.has(id)) throw new Error("Duplicate model in Standard pricing table");
    const entry = { id, rates: rates(cells.slice(1, 5)) };
    if (cells[5] !== "-") entry.longContext = { inputThreshold: 272_000, rates: rates(cells.slice(5, 9)) };
    models.set(id, entry);
  }
  // Specialized Codex pricing has a Standard table followed by a Fast table.
  // Keep the first published row for each exact identity, never a family-prefix guess.
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
    if (cells.length !== 5 || cells[0] !== "Codex") continue;
    const id = cells[1].replaceAll("\x60", "");
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) throw new Error("Unexpected official Codex identifier");
    if (!models.has(id)) models.set(id, { id, rates: rates([cells[2], cells[3], "-", cells[4]]) });
  }
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
