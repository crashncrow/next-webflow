// Stage 5b: cold-cache getItems on the deployed spike for both sources. For each run: revalidate
// the collection tag (so the Next data cache is cold), wait for it to apply, then call
// /api/measure-items. Prints time, requests, bytes and rate limit used. Raw results → e2e-output/.
// Usage: npm run measure-load [-- <collectionId>]. Reads SPIKE_SECRET from local.env.
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://next-webflow-d8ce88.webflow.io/spike";
const COLLECTION_ID = process.argv[2] ?? "6ad8fd8ec7f36839f0d31230";
const SECRET = process.env.SPIKE_SECRET;
if (!SECRET) throw new Error("Set SPIKE_SECRET in local.env");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RUNS = [
  { mode: "library", source: "data" },
  { mode: "library", source: "cdn" },
  ...[35, 10, 5, 1].flatMap((pageSize) => ["data", "cdn"].map((source) => ({ mode: "pages", source, pageSize }))),
  { mode: "pages", source: "data", pageSize: 1, c: 6 },
  { mode: "pages", source: "data", pageSize: 1, c: 12 },
];

const results = [];
for (const run of RUNS) {
  await fetch(`${BASE}/api/revalidate-node`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: SECRET, tag: `webflow:collection:${COLLECTION_ID}` }),
  });
  await sleep(2000);
  const query = new URLSearchParams({
    collection: "load-test",
    mode: run.mode,
    source: run.source,
    ...(run.pageSize && { pageSize: String(run.pageSize) }),
    c: String(run.c ?? 4),
  });
  const result = await (
    await fetch(`${BASE}/api/measure-items?${query}`, { headers: { "x-spike-secret": SECRET } })
  ).json();
  results.push({ run, result });
  const requests = result.requests ?? [];
  const remaining = requests
    .filter((request) => request.rateLimitRemaining !== null)
    .map((request) => Number(request.rateLimitRemaining));
  const ms = requests.map((request) => request.ms).sort((a, b) => a - b);
  console.log(
    `${run.mode.padEnd(7)} ${run.source.padEnd(4)} page ${String(run.pageSize ?? 100).padStart(3)} c=${run.c ?? 4}` +
      ` → ${result.ok ? "OK" : `FAIL ${result.error}`} ${result.items ?? "-"} items, ${requests.length} req, ${result.ms} ms total` +
      ` | per req ${ms[0]}–${ms.at(-1)} ms (p50 ${ms[Math.floor(ms.length / 2)]})` +
      ` | ${Math.round(requests.reduce((sum, request) => sum + request.bytes, 0) / 1024)} KB` +
      ` | rate limit remaining ${remaining.length ? `${Math.max(...remaining)}→${Math.min(...remaining)}` : "n/a"}` +
      ` | cdn cache ${[...new Set(requests.map((request) => request.cdnCache).filter(Boolean))].join("/") || "-"}`,
  );
}
mkdirSync(new URL("../e2e-output/", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../e2e-output/measure-load-${Date.now()}.json`, import.meta.url),
  JSON.stringify(results, null, 2),
);
