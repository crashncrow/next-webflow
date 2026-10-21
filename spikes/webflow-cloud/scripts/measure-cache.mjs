// Measures the deployed spike's data cache: HITs across requests/isolates, then how long a
// revalidateTag takes to show fresh data (KV is eventually consistent), and whether stale data
// comes back afterwards. Usage: npm run measure [-- https://<site>.webflow.io/spike]
// Reads SPIKE_SECRET from local.env (never printed).
const BASE = (process.argv[2] ?? "https://next-webflow-d8ce88.webflow.io/spike").replace(/\/$/, "");
const SECRET = process.env.SPIKE_SECRET;
if (!SECRET) throw new Error("Set SPIKE_SECRET in local.env");

// A fresh tag per run, so earlier runs' cache entries don't interfere.
const TAG = `spike-measure-${Date.now()}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A real Webflow call changes `x-ratelimit-remaining` (or `date`); a cache HIT returns the stored pair. */
const fingerprint = (result) => `${result.fetchedAt}|${result.rateLimitRemaining}`;

async function probe() {
  const response = await fetch(`${BASE}/api/probe-node?tag=${TAG}`, { cache: "no-store" });
  if (!response.ok) return { error: `HTTP ${response.status}` };
  return response.json();
}

async function revalidate() {
  const response = await fetch(`${BASE}/api/revalidate-node`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: SECRET, tag: TAG }),
  });
  return `${response.status} ${await response.text()}`;
}

console.log(`Base ${BASE}, tag ${TAG}\n`);

// 1. Warm up, then check whether later requests (any isolate) get the stored response.
const warm = [];
for (let i = 0; i < 12; i++) {
  warm.push(await probe());
  await sleep(500);
}
const first = fingerprint(warm[0]);
const hits = warm.slice(1).filter((result) => fingerprint(result) === first).length;
const isolates = new Set(warm.map((result) => result.isolate));
console.log("1. Cache persistence");
for (const result of warm) {
  console.log(`   isolate ${result.isolate}  fetchedAt ${result.fetchedAt}  remaining ${result.rateLimitRemaining}  ${result.durationMs} ms${result.error ? `  ${result.error}` : ""}`);
}
console.log(`   → ${hits}/${warm.length - 1} later requests returned the first response; ${isolates.size} isolates\n`);

// 2. Revalidate after >1 s (fetchedAt has 1 s resolution), then poll until the fingerprint changes.
await sleep(1500);
const before = fingerprint(warm.at(-1));
const revalidatedAt = Date.now();
console.log(`2. revalidateTag → ${await revalidate()}`);
let freshAfterMs = null;
const polls = [];
while (Date.now() - revalidatedAt < 120_000) {
  const result = await probe();
  const elapsed = Date.now() - revalidatedAt;
  polls.push({ elapsed, fingerprint: fingerprint(result), isolate: result.isolate });
  if (freshAfterMs === null && fingerprint(result) !== before) {
    freshAfterMs = elapsed;
    break;
  }
  await sleep(250);
}
console.log(`   → fresh data after ${freshAfterMs === null ? "NEVER (120 s timeout)" : `${freshAfterMs} ms`} (${polls.length} polls)\n`);

// 3. After the first fresh response, do requests keep agreeing, or does the old entry come back?
const fresh = polls.at(-1)?.fingerprint;
const after = [];
for (let i = 0; i < 20; i++) {
  const result = await probe();
  after.push({ fingerprint: fingerprint(result), isolate: result.isolate });
  await sleep(500);
}
const counts = after.reduce((map, { fingerprint: value }) => map.set(value, (map.get(value) ?? 0) + 1), new Map());
console.log("3. Consistency after revalidation (20 requests, 0.5 s apart)");
for (const [value, count] of counts) {
  const label = value === before ? "STALE (pre-revalidate)" : value === fresh ? "first fresh" : "other";
  console.log(`   ${count}× ${value}  ${label}`);
}
console.log(`   isolates: ${new Set(after.map((entry) => entry.isolate)).size}`);
