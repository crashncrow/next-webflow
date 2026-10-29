// The public surface, pinned: adding or removing a runtime export must be a deliberate change here.
// (Types are checked by `tsc` and the example; this covers values.)
import { describe, expect, it } from "vitest";

const names = (module: object) => Object.keys(module).sort();

describe("public runtime exports", () => {
  it("next-webflow", async () => {
    expect(names(await import("../src/index"))).toEqual([
      "SITE_TAG",
      "WebflowApiError",
      "WebflowBadRequestError",
      "WebflowConfigError",
      "WebflowConflictError",
      "WebflowError",
      "WebflowForbiddenError",
      "WebflowNetworkError",
      "WebflowNotFoundError",
      "WebflowRateLimitError",
      "WebflowServerError",
      "WebflowUnauthorizedError",
      "collectionTag",
      "createWebflow",
      "createWebflowCms",
      "itemTag",
      "unsafeStagedCache",
    ]);
  });

  it("next-webflow/webhook", async () => {
    expect(names(await import("../src/webhook"))).toEqual([
      "DEFAULT_WEBHOOK_EVENTS",
      "POST",
      "createWebhookHandler",
      "parseWebhookEvent",
      "tagsForEvent",
      "verifyWebflowSignature",
    ]);
  });

  it("next-webflow/draft", async () => {
    expect(names(await import("../src/draft"))).toEqual([
      "createDraftHandler",
      "createPreviewUrl",
      "nextBasePath",
      "requireBasicAuth",
    ]);
  });

  it("next-webflow/components", async () => {
    expect(names(await import("../src/components"))).toEqual(["DraftModeBanner", "WebflowImage", "WebflowRichText"]);
  });

  it("next-webflow/components/client", async () => {
    expect(names(await import("../src/components/exit-preview-link"))).toEqual(["ExitPreviewLink"]);
  });
});
