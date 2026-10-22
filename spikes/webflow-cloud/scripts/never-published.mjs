// Stage 5b (never-published collections): creates the "never-published" collection on the TEST site
// with one item queued for the next site publish, so a page can be prerendered while its live list
// still answers 404. Refuses to exceed the plan's CMS item limit (LOAD_TEST_ITEM_LIMIT, default 50).
// Usage: npm run never-published
const API = "https://api.webflow.com/v2";
const { WEBFLOW_WRITE_TOKEN: token, WEBFLOW_SITE_ID: siteId, SEED_CONFIRM_SITE_ID: confirm } = process.env;
const SLUG = "never-published";
const PLAN_ITEM_LIMIT = Number(process.env.LOAD_TEST_ITEM_LIMIT ?? 50);

if (!token || !siteId) throw new Error("Set WEBFLOW_WRITE_TOKEN (seed.env) and WEBFLOW_SITE_ID (local.env)");
if (confirm !== siteId)
  throw new Error("Refusing to write: SEED_CONFIRM_SITE_ID must equal WEBFLOW_SITE_ID (test site only).");

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const { collections } = await api(`/sites/${siteId}/collections`);
if (collections.some((collection) => collection.slug === SLUG)) throw new Error(`"${SLUG}" already exists.`);
let total = 0;
for (const collection of collections)
  total += (await api(`/collections/${collection.id}/items?limit=1`)).pagination.total;
if (total + 1 > PLAN_ITEM_LIMIT) throw new Error(`Site has ${total} items; the plan limit is ${PLAN_ITEM_LIMIT}.`);

const collection = await api(`/sites/${siteId}/collections`, {
  method: "POST",
  body: JSON.stringify({ displayName: "Never Published", singularName: "Never Published Item", slug: SLUG }),
});
await api(`/collections/${collection.id}/items/insert`, {
  method: "POST",
  body: JSON.stringify({ items: [{ isDraft: false, fieldData: { name: "First item", slug: "first-item" } }] }),
});
const live = await fetch(`${API}/collections/${collection.id}/items/live`, {
  headers: { authorization: `Bearer ${token}` },
});
console.log(
  `Created "${SLUG}" (${collection.id}) with 1 queued item; /items/live → ${live.status}. Site total: ${total + 1}.`,
);
