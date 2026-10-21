// Stage 5b: fills the "load-test" collection of the TEST site (creating it if missing) with N items
// queued for the next site publish (`isDraft: false`), in bulk requests of up to 100.
// Refuses to exceed the plan's CMS item limit (LOAD_TEST_ITEM_LIMIT, default 50 = Starter).
// Usage: npm run seed [-- 35]. Kept afterwards for regression tests.
const API = "https://api.webflow.com/v2";
const { WEBFLOW_WRITE_TOKEN: token, WEBFLOW_SITE_ID: siteId, SEED_CONFIRM_SITE_ID: confirm } = process.env;
const COLLECTION_SLUG = "load-test";
const PLAN_ITEM_LIMIT = Number(process.env.LOAD_TEST_ITEM_LIMIT ?? 50);
const count = Number(process.argv[2] ?? 35);

if (!token || !siteId) throw new Error("Set WEBFLOW_WRITE_TOKEN (seed.env) and WEBFLOW_SITE_ID (local.env)");
if (confirm !== siteId) {
  throw new Error("Refusing to write: SEED_CONFIRM_SITE_ID must equal WEBFLOW_SITE_ID (test site only).");
}

async function api(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    });
    if (response.status === 429 && attempt < 5) {
      const wait = Number(response.headers.get("retry-after") ?? 60) * 1000;
      console.log(`429, waiting ${wait / 1000}s…`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }
}

const { collections } = await api(`/sites/${siteId}/collections`);
const authors = collections.find((candidate) => candidate.slug === "authors");

// Plan headroom: every staged item of every collection counts.
let total = 0;
for (const candidate of collections) total += (await api(`/collections/${candidate.id}/items?limit=1`)).pagination.total;
if (total + count > PLAN_ITEM_LIMIT) {
  throw new Error(`Site has ${total} items; ${count} more would exceed the plan limit of ${PLAN_ITEM_LIMIT}.`);
}

let collection = collections.find((candidate) => candidate.slug === COLLECTION_SLUG);
if (!collection) {
  collection = await api(`/sites/${siteId}/collections`, {
    method: "POST",
    body: JSON.stringify({
      displayName: "Load Test",
      singularName: "Load Test Item",
      slug: COLLECTION_SLUG,
      fields: [
        { type: "RichText", displayName: "Body", slug: "body" },
        { type: "PlainText", displayName: "Summary", slug: "summary" },
        { type: "Number", displayName: "Rank", slug: "rank" },
        { type: "Option", displayName: "Tier", slug: "tier", metadata: { options: [{ name: "Gold" }, { name: "Silver" }, { name: "Bronze" }] } },
        ...(authors ? [{ type: "Reference", displayName: "Author", slug: "author", metadata: { collectionId: authors.id } }] : []),
      ],
    }),
  });
  console.log(`Created collection "${COLLECTION_SLUG}" (${collection.id}).`);
  collection = await api(`/collections/${collection.id}`);
} else {
  collection = await api(`/collections/${collection.id}`);
}

const tiers = collection.fields.find((field) => field.slug === "tier")?.validations?.options ?? [];
const authorIds = authors ? (await api(`/collections/${authors.id}/items/live`)).items.map((item) => item.id) : [];
const start = (await api(`/collections/${collection.id}/items?limit=1`)).pagination.total;
console.log(`Site has ${total} items (limit ${PLAN_ITEM_LIMIT}); "${COLLECTION_SLUG}" has ${start}; creating ${count}…`);

// ~2 KB of rich text per item, close to the "posts" bodies.
const paragraph = "Load test content for pagination and payload size measurements. ".repeat(6);
const body = (n) => `<h2>Item ${n}</h2>${`<p>${paragraph}</p>`.repeat(5)}`;

let created = 0;
for (let offset = 0; offset < count; offset += 100) {
  const items = Array.from({ length: Math.min(100, count - offset) }, (_, index) => {
    const n = start + offset + index + 1;
    return {
      isDraft: false, // queued for the next site publish
      fieldData: {
        name: `Load test item ${n}`,
        slug: `load-test-item-${n}`,
        body: body(n),
        summary: `Summary of load test item ${n}.`,
        rank: n,
        ...(tiers.length && { tier: tiers[n % tiers.length].id }),
        ...(authorIds.length && { author: authorIds[n % authorIds.length] }),
      },
    };
  });
  const response = await api(`/collections/${collection.id}/items/insert`, { method: "POST", body: JSON.stringify({ items }) });
  created += (response.items ?? []).length;
  console.log(`created ${created}/${count}`);
}
console.log('Done. Publish the site to make them live (isDraft: false queues them).');
