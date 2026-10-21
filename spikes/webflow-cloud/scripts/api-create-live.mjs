// Stage 4 E2E: create a LIVE item through the API (POST /collections/{id}/items/live), to capture
// the `collection_item_created` it fires. TEST SITE ONLY.
// Usage: npm run api-create-live -- <slug> "<name>"
const API = "https://api.webflow.com/v2";
const { WEBFLOW_WRITE_TOKEN: token, WEBFLOW_SITE_ID: siteId, SEED_CONFIRM_SITE_ID: confirm } = process.env;
const [slug, name] = process.argv.slice(2);

if (!slug || !name) throw new Error('Usage: npm run api-create-live -- <slug> "<name>"');
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

const sentAt = new Date().toISOString();
const created = await api(`/collections/${posts.id}/items/live`, {
  method: "POST",
  // `body` is the collection's only required custom field.
  body: JSON.stringify({ isDraft: false, isArchived: false, fieldData: { name, slug, body: `<p>${name}</p>` } }),
});
console.log(`${sentAt}  POST live → ${created.id} (${slug}) "${name}"`);
