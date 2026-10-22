import { describe, expect, it, vi } from "vitest";
import {
  UNSIGNED_WEBHOOK_MESSAGE,
  createWebhookRequestHandler,
  type RevalidateProfile,
  type WebhookHandlerOptions,
} from "../../src/core";
import { POSTS_ID } from "../fixtures/schema";
import { IDS, webhookBodies } from "../fixtures/webhooks";
import { NOW, SECRET, webhookRequest } from "../webhook-helpers";

function setup(options: WebhookHandlerOptions = {}) {
  const revalidated: Array<[string, RevalidateProfile]> = [];
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  const handler = createWebhookRequestHandler(
    { secret: SECRET, logger, ...options },
    { revalidate: (tag, profile) => void revalidated.push([tag, profile]), now: () => NOW },
  );
  return { handler, revalidated, logger };
}

const readJson = async (response: Response) => [response.status, await response.json()] as const;

describe("webhook handler", () => {
  it("verifies, revalidates every tag with { expire: 0 } and answers 200", async () => {
    const { handler, revalidated } = setup();

    const [status, body] = await readJson(await handler(webhookRequest(webhookBodies.collection_item_unpublished)));

    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      triggerType: "collection_item_unpublished",
      revalidated: [`webflow:collection:${POSTS_ID}`, `webflow:item:${IDS.UNPUBLISHED}`],
    });
    expect(revalidated).toEqual([
      [`webflow:collection:${POSTS_ID}`, { expire: 0 }],
      [`webflow:item:${IDS.UNPUBLISHED}`, { expire: 0 }],
    ]);
  });

  it("answers 200 without revalidating for staged-only events", async () => {
    const { handler, revalidated } = setup();
    const [status, body] = await readJson(await handler(webhookRequest(webhookBodies.collection_item_changed)));
    expect([status, body.revalidated]).toEqual([200, []]);
    expect(revalidated).toEqual([]);
  });

  it("is idempotent: Webflow's retries revalidate the same tags again", async () => {
    const { handler, revalidated } = setup();
    await handler(webhookRequest(webhookBodies.site_publish));
    await handler(webhookRequest(webhookBodies.site_publish));
    expect(revalidated).toEqual([
      ["webflow", { expire: 0 }],
      ["webflow", { expire: 0 }],
    ]);
  });

  it("reads several comma-separated secrets from WEBFLOW_WEBHOOK_SECRET", async () => {
    vi.stubEnv("WEBFLOW_WEBHOOK_SECRET", "whsec_a, whsec_b ,whsec_c");
    const { handler } = setup({ secret: undefined });

    const response = await handler(webhookRequest(webhookBodies.site_publish, { secret: "whsec_b" }));
    expect(response.status).toBe(200);
  });

  describe("rejections", () => {
    it("rejects unsigned requests by default, explaining the register command", async () => {
      const { handler, revalidated, logger } = setup();
      const [status, body] = await readJson(
        await handler(webhookRequest(webhookBodies.site_publish, { signed: false })),
      );

      expect(status).toBe(401);
      expect(body.error).toBe(UNSIGNED_WEBHOOK_MESSAGE);
      expect(body.error).toMatch(/npx next-webflow webhooks register --url/);
      expect(body.error).toMatch(/allowUnsigned/);
      expect(revalidated).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("accepts unsigned requests only with allowUnsigned, and warns", async () => {
      const { handler, revalidated, logger } = setup({ allowUnsigned: true, secret: undefined });
      const response = await handler(webhookRequest(webhookBodies.site_publish, { signed: false }));

      expect(response.status).toBe(200);
      expect(revalidated).toEqual([["webflow", { expire: 0 }]]);
      expect(logger.warn.mock.calls[0]?.[0]).toMatch(/insecure/);
    });

    it("still verifies signed requests when allowUnsigned is set", async () => {
      const { handler } = setup({ allowUnsigned: true });
      const response = await handler(webhookRequest(webhookBodies.site_publish, { secret: "whsec_wrong" }));
      expect(response.status).toBe(401);
    });

    it("rejects an invalid signature with 401", async () => {
      const { handler, revalidated } = setup();
      const [status, body] = await readJson(
        await handler(webhookRequest(webhookBodies.site_publish, { secret: "whsec_wrong" })),
      );
      expect([status, body.error]).toEqual([401, expect.stringMatching(/Invalid signature/)]);
      expect(revalidated).toEqual([]);
    });

    it("rejects an expired timestamp with 401", async () => {
      const { handler } = setup();
      const response = await handler(webhookRequest(webhookBodies.site_publish, { timestamp: NOW - 6 * 60 * 1000 }));
      expect(response.status).toBe(401);
      expect((await response.json()).error).toMatch(/too old/);
    });

    it("rejects malformed headers with 400", async () => {
      const { handler } = setup();
      const response = await handler(
        webhookRequest(webhookBodies.site_publish, { headers: { "x-webflow-signature": "not-hex" } }),
      );
      expect(response.status).toBe(400);
    });

    it("answers 500 (so Webflow retries) when no secret is configured", async () => {
      vi.stubEnv("WEBFLOW_WEBHOOK_SECRET", "");
      const { handler, logger } = setup({ secret: undefined });
      const [status, body] = await readJson(await handler(webhookRequest(webhookBodies.site_publish)));
      expect(status).toBe(500);
      expect(body.error).toMatch(/WEBFLOW_WEBHOOK_SECRET/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("rejects bodies that aren't JSON or aren't webhooks (after verifying them)", async () => {
      const { handler } = setup();
      expect((await handler(webhookRequest("not json"))).status).toBe(400);
      expect((await handler(webhookRequest({ hello: "world" }))).status).toBe(400);
    });
  });

  describe("options", () => {
    it("uses a custom revalidation profile", async () => {
      const { handler, revalidated } = setup({ profile: "max" });
      await handler(webhookRequest(webhookBodies.site_publish));
      expect(revalidated).toEqual([["webflow", "max"]]);
    });

    it("adds extra tags", async () => {
      const { handler, revalidated } = setup({
        extraTags: (event) => (event.triggerType === "site_publish" ? ["my-navigation"] : []),
      });
      await handler(webhookRequest(webhookBodies.site_publish));
      expect(revalidated.map(([tag]) => tag)).toEqual(["webflow", "my-navigation"]);
    });

    it("replaces the tag list with `tags`", async () => {
      const { handler, revalidated } = setup({
        tags: (_event, defaults) => defaults.filter((tag) => tag.startsWith("webflow:item:")),
      });
      await handler(webhookRequest(webhookBodies.collection_item_deleted));
      expect(revalidated.map(([tag]) => tag)).toEqual([`webflow:item:${IDS.DELETED}`]);
    });

    it("invalidates on staged changes when opted in", async () => {
      const { handler, revalidated } = setup({ invalidateOnStagedChanges: true });
      await handler(webhookRequest(webhookBodies.collection_item_changed));
      expect(revalidated.map(([tag]) => tag)).toEqual([`webflow:collection:${POSTS_ID}`, `webflow:item:${IDS.POST_A}`]);
    });

    it("calls onEvent with the parsed event and the tags", async () => {
      const onEvent = vi.fn();
      const { handler } = setup({ onEvent });
      await handler(webhookRequest(webhookBodies.collection_item_published));

      const [event, tags] = onEvent.mock.calls[0] ?? [];
      expect(event.triggerType).toBe("collection_item_published");
      expect(event.items).toHaveLength(3);
      expect(tags).toHaveLength(5);
    });

    it("answers 500 when onEvent throws (after revalidating)", async () => {
      const { handler, revalidated, logger } = setup({
        onEvent: () => {
          throw new Error("downstream failed");
        },
      });
      const [status, body] = await readJson(await handler(webhookRequest(webhookBodies.site_publish)));
      expect([status, body.error]).toEqual([500, "downstream failed"]);
      expect(revalidated).toHaveLength(1);
      expect(logger.error).toHaveBeenCalled();
    });

    it("logs successful events through logger.info", async () => {
      const { handler, logger } = setup();
      await handler(webhookRequest(webhookBodies.site_publish));
      expect(logger.info).toHaveBeenCalledWith("[next-webflow] site_publish: revalidated webflow");
    });

    it("logs isDraft and the timestamps of every item as debug info", async () => {
      const { handler, logger } = setup();
      await handler(webhookRequest(webhookBodies.collection_item_changed));
      expect(logger.info).toHaveBeenCalledWith(
        `[next-webflow] collection_item_changed: revalidated nothing (${IDS.POST_A} isDraft=true ` +
          "lastPublished=2026-10-21T03:41:14.342Z lastUpdated=2026-10-21T15:15:37.137Z)",
      );
    });
  });
});

it.each([false, true])(
  "still revalidates and answers 200 with a throwing logger (reporter throws=%s)",
  async (brokenReporter) => {
    const logger = {
      info: vi.fn(() => {
        throw new Error("info failed");
      }),
      warn: vi.fn(),
      error: vi.fn(() => {
        if (brokenReporter) throw new Error("error failed");
      }),
    };
    const { handler, revalidated } = setup({ logger });
    for (let i = 0; i < 2; i++) expect((await handler(webhookRequest(webhookBodies.site_publish))).status).toBe(200);
    expect(revalidated).toHaveLength(2);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("info failed"));
  },
);
