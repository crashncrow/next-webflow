// Creates and publishes N items in the "bulk-items" collection of the TEST site, so pagination
// needs more pages than Cloudflare's 6 concurrent requests. Usage: npm run seed [-- 650]
const API = "https://api.webflow.com/v2";
const { WEBFLOW_WRITE_TOKEN: token, WEBFLOW_SITE_ID: siteId, SEED_CONFIRM_SITE_ID: confirm } = process.env;
const COLLECTION_SLUG = "bulk-items";
const count = Number(process.argv[2] ?? 650);

if (!token || !siteId) throw new Error("Set WEBFLOW_WRITE_TOKEN and WEBFLOW_SITE_ID in .env.local");
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
const collection = collections.find((candidate) => candidate.slug === COLLECTION_SLUG);
if (!collection) throw new Error(`Create a "${COLLECTION_SLUG}" collection on the test site first.`);

const existing = await api(`/collections/${collection.id}/items?limit=1`);
const start = existing.pagination.total;
console.log(`"${COLLECTION_SLUG}" has ${start} items; creating ${count} more…`);

const ids = [];
for (let offset = 0; offset < count; offset += 100) {
  const batch = Array.from({ length: Math.min(100, count - offset) }, (_, index) => {
    const n = start + offset + index + 1;
    return { fieldData: { name: `Bulk item ${n}`, slug: `bulk-item-${n}` } };
  });
  const created = await api(`/collections/${collection.id}/items`, {
    method: "POST",
    body: JSON.stringify({ items: batch }),
  });
  const createdItems = created.items ?? (created.id ? [created] : []);
  if (createdItems.length === 0) throw new Error(`Unexpected bulk create response: ${JSON.stringify(created)}`);
  ids.push(...createdItems.map((item) => item.id));
  console.log(`created ${ids.length}/${count}`);
}

for (let offset = 0; offset < ids.length; offset += 100) {
  await api(`/collections/${collection.id}/items/publish`, {
    method: "POST",
    body: JSON.stringify({ itemIds: ids.slice(offset, offset + 100) }),
  });
  console.log(`published ${Math.min(offset + 100, ids.length)}/${ids.length}`);
}
console.log("Done.");
