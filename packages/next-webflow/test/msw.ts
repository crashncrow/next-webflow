import { setupServer } from "msw/node";

export const server = setupServer();

export const DATA_API = "https://api.webflow.com/v2";
export const CDN_API = "https://api-cdn.webflow.com/v2";

/** Fake token: tests never use a real one. */
export const TEST_TOKEN = "test-token";
