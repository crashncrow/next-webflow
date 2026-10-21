import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./msw";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  // Unit tests never use real credentials, even if a local .env file defines them.
  vi.stubEnv("WEBFLOW_API_TOKEN", "");
  vi.stubEnv("WEBFLOW_SITE_ID", "");
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());
