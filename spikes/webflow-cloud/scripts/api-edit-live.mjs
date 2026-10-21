// Stage 4 E2E: edit a LIVE item through the API (PATCH /collections/{id}/items/live), the case
// where Webflow may send only `collection_item_changed`. TEST SITE ONLY.
// Usage: npm run api-edit-live -- <item-slug> "<new name>"
const API = "https://api.webflow.com/v2";
const { WEBFLOW_WRITE_TOKEN: token, WEBFLOW_SITE_ID: siteId, SEED_CONFIRM_SITE_ID: confirm } = process.env;
const [slug, name] = process.argv.slice(2);

if (!slug || !name) throw new Error('Usage: npm run api-edit-live -- <item-slug> "<new name>"');
if (!token || !siteId) throw new Error("Set WEBFLOW_WRITE_TOKEN (seed.env) and WEBFLOW_SITE_ID (local.env)");
if (confirm !== siteId) throw new Error("Refusing to write: SEED_CONFIRM_SITE_ID must equal WEBFLOW_SITE_ID (test site only).");

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
const posts = collections.find((collection) => collection.slug === "posts");
if (!posts) throw new Error('No "posts" collection');
const { items } = await api(`/collections/${posts.id}/items/live?slug=${encodeURIComponent(slug)}`);
const item = items[0];
if (!item) throw new Error(`No live item with slug "${slug}"`);

const sentAt = new Date().toISOString();
await api(`/collections/${posts.id}/items/live`, {
  method: "PATCH",
  body: JSON.stringify({ items: [{ id: item.id, fieldData: { name } }] }),
});
console.log(`${sentAt}  PATCH live ${item.id} (${slug}): name "${item.fieldData.name}" → "${name}"`);
