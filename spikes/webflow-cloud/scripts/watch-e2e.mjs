// Stage 4 end-to-end watcher. Polls the deployed spike every 2 s and prints a timeline:
// - webhooks received by /api/webflow (from the D1 log): trigger, status, items, flag spellings
// - changes in /library (getItems("posts"), cached + invalidated only by webhooks)
// - optional slug lookups: npm run watch -- --slug cms-trends-2023-5 --slug new-slug
// Raw webhook bodies are saved to e2e-output/ (git-ignored) to become test fixtures.
// Reads SPIKE_SECRET from local.env (never printed). Stop with Ctrl+C.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "https://next-webflow-d8ce88.webflow.io/spike" },
    slug: { type: "string", multiple: true, default: [] },
    interval: { type: "string", default: "2000" },
  },
});
const BASE = values.base.replace(/\/$/, "");
const SECRET = process.env.SPIKE_SECRET;
if (!SECRET) throw new Error("Set SPIKE_SECRET in local.env");
const OUT = new URL("../e2e-output/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const time = () => new Date().toISOString().slice(11, 23);
const log = (kind, message) => console.log(`${time()}  ${kind.padEnd(8)} ${message}`);

const decode = (html) =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The JSON the /library page renders in <h2>Result</h2><pre>…</pre>. */
async function libraryResult(query = "") {
  const html = await (await fetch(`${BASE}/library${query}`, { cache: "no-store" })).text();
  const match = /<h2>Result<\/h2><pre>([\s\S]*?)<\/pre>/.exec(html);
  if (!match) return { error: "no result block" };
  try {
    return JSON.parse(decode(match[1]));
  } catch {
    return { error: "unparsable result" };
  }
}

const summarize = (item) =>
  item && typeof item === "object" && item.fieldData
    ? `${item.fieldData.slug} | ${item.fieldData.name} | ${item.fieldData.category?.name ?? "-"}`
    : JSON.stringify(item);

let listState = new Map();
const slugState = new Map();
let lastLogId = 0;
let started = false;

async function pollList() {
  const result = await libraryResult();
  if (!Array.isArray(result)) return log("LIST", `error ${JSON.stringify(result).slice(0, 120)}`);
  const next = new Map(result.map((item) => [item.id, summarize(item)]));
  if (started) {
    for (const [id, summary] of next) {
      if (!listState.has(id)) log("LIST +", `${id} ${summary}`);
      else if (listState.get(id) !== summary) log("LIST ~", `${id} ${listState.get(id)}  →  ${summary}`);
    }
    for (const [id, summary] of listState) if (!next.has(id)) log("LIST -", `${id} ${summary}`);
  } else {
    log("LIST", `${next.size} live items`);
  }
  listState = next;
}

async function pollSlugs() {
  for (const slug of values.slug) {
    const summary = summarize(await libraryResult(`?slug=${encodeURIComponent(slug)}`));
    if (slugState.get(slug) !== summary)
      log("SLUG", `${slug}: ${slugState.has(slug) ? `${slugState.get(slug)} → ` : ""}${summary}`);
    slugState.set(slug, summary);
  }
}

function describeWebhook(row) {
  let body;
  try {
    body = JSON.parse(row.raw_body);
  } catch {
    return `${row.trigger_type} status ${row.status} (unparsable body)`;
  }
  const payload = body.payload ?? {};
  const items = Array.isArray(payload.items) ? payload.items : payload.id ? [payload] : [];
  const flagKeys = [
    ...new Set(items.flatMap((item) => Object.keys(item).filter((key) => /archived|draft/i.test(key)))),
  ];
  const ids = items.map((item) => `${item.id}${item.fieldData?.slug ? `(${item.fieldData.slug})` : ""}`).join(", ");
  const shape = Array.isArray(payload.items) ? "items[]" : payload.id ? "flat" : Object.keys(payload).join(",");
  let revalidated = "";
  try {
    revalidated = JSON.parse(row.response).revalidated?.join(", ") ?? row.response;
  } catch {
    revalidated = row.response;
  }
  return `${body.triggerType} → ${row.status}${row.signed ? "" : " UNSIGNED"} | payload ${shape} | flags ${flagKeys.join("/") || "-"} | ${ids || "-"} | revalidated: ${revalidated || "-"}`;
}

async function pollWebhooks() {
  const response = await fetch(`${BASE}/api/webhook-log?since=${lastLogId}`, {
    headers: { "x-spike-secret": SECRET },
    cache: "no-store",
  });
  if (!response.ok) return log("HOOK", `log unavailable (${response.status})`);
  const { rows } = await response.json();
  for (const row of rows) {
    lastLogId = Math.max(lastLogId, row.id);
    if (!started) continue; // only report webhooks received while watching
    writeFileSync(new URL(`webhook-${row.id}-${row.trigger_type ?? "unknown"}.json`, OUT), `${row.raw_body}\n`);
    log("HOOK", `#${row.id} (received ${row.received_at.slice(11, 23)}) ${describeWebhook(row)}`);
  }
}

async function tick() {
  await Promise.all([pollList(), pollSlugs(), pollWebhooks()]).catch((error) => log("ERROR", String(error)));
}

console.log(`Watching ${BASE} every ${values.interval} ms. Raw webhooks → ${OUT.pathname}`);
await tick();
started = true;
log("READY", "perform the next action now");
setInterval(tick, Number(values.interval));
