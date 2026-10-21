import { beforeEach, describe, expect, it, vi } from "vitest";
import { webhookBodies } from "../fixtures/webhooks";
import { NOW, SECRET, webhookRequest } from "../webhook-helpers";

const revalidateTag = vi.fn();
vi.mock("next/cache.js", () => ({ revalidateTag }));

describe("next-webflow/webhook", () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    return () => vi.useRealTimers();
  });

  it("POST reads WEBFLOW_WEBHOOK_SECRET and calls revalidateTag(tag, { expire: 0 })", async () => {
    vi.stubEnv("WEBFLOW_WEBHOOK_SECRET", `whsec_other,${SECRET}`);
    const { POST } = await import("../../src/webhook");

    const response = await POST(webhookRequest(webhookBodies.site_publish));

    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("webflow", { expire: 0 });
  });

  it("createWebhookHandler passes options through", async () => {
    const { createWebhookHandler } = await import("../../src/webhook");
    const POST = createWebhookHandler({ secret: SECRET, profile: "max" });

    await POST(webhookRequest(webhookBodies.site_publish));

    expect(revalidateTag).toHaveBeenCalledWith("webflow", "max");
  });

  it("doesn't export a runtime (edge returns 500 on Webflow Cloud)", async () => {
    const module: Record<string, unknown> = await import("../../src/webhook");
    expect(module).not.toHaveProperty("runtime");
  });
});
