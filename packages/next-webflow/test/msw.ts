import { http, HttpResponse } from "msw/http";
import { setupServer } from "msw/node";
import collectionsJson from "./fixtures/api/collections.json";

export const DATA_API = "https://api.webflow.com/v2";
export const CDN_API = "https://api-cdn.webflow.com/v2";

/** Fake token: tests never use a real one. */
export const TEST_TOKEN = "test-token";

/**
 * Default handler (kept by `server.resetHandlers()`): `GET /collections/{id}` answers with the
 * real test-site collection, as the live Option names lookup reads it. Tests override it with
 * `server.use` when they need a changed or failing schema.
 */
const realCollection = http.get(`${DATA_API}/collections/:collectionId`, ({ params }) => {
  const found = collectionsJson.find((collection) => collection.id === params.collectionId);
  return found
    ? HttpResponse.json(found)
    : HttpResponse.json({ code: "resource_not_found", message: "Collection not found" }, { status: 404 });
});

export const server = setupServer(realCollection);
