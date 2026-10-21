import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  parseSecrets,
  parseWebhookEvent,
  tagsForEvent,
  verifyWebflowSignature,
} from "../../src/core";
import { AUTHORS_ID, POSTS_ID } from "../fixtures/schema";
import { IDS, itemPayload, real, webhookBodies } from "../fixtures/webhooks";
import { NOW, SECRET, sign } from "../webhook-helpers";

const body = JSON.stringify(webhookBodies.site_publish);

describe("verifyWebflowSignature", () => {
  const verify = (overrides: Partial<Parameters<typeof verifyWebflowSignature>[0]> = {}) =>
    verifyWebflowSignature({
      rawBody: body,
      signature: sign(body, NOW),
      timestamp: String(NOW),
      secrets: [SECRET],
      now: NOW,
      ...overrides,
    });

  it("accepts a valid signature", async () => {
    await expect(verify()).resolves.toEqual({ ok: true, secretIndex: 0 });
  });

  it("accepts an uppercase hex signature", async () => {
    await expect(verify({ signature: sign(body, NOW).toUpperCase() })).resolves.toMatchObject({ ok: true });
  });

  it("tries every secret and reports which one matched", async () => {
    await expect(verify({ secrets: ["whsec_other", "whsec_another", SECRET] })).resolves.toEqual({
      ok: true,
      secretIndex: 2,
    });
  });

  it("rejects a signature from another secret", async () => {
    await expect(verify({ signature: sign(body, NOW, "whsec_wrong") })).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a tampered body (signature is over the raw body)", async () => {
    await expect(verify({ rawBody: `${body} ` })).resolves.toEqual({ ok: false, reason: "invalid" });
    const reserialized = JSON.stringify(JSON.parse(body), null, 2);
    await expect(verify({ rawBody: reserialized })).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects when the timestamp is part of what's signed and was swapped", async () => {
    await expect(verify({ timestamp: String(NOW - 1000) })).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects timestamps older than 5 minutes, or more than 5 minutes in the future", async () => {
    const old = NOW - 5 * 60 * 1000 - 1;
    await expect(verify({ timestamp: String(old), signature: sign(body, old) })).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
    const future = NOW + 5 * 60 * 1000 + 1;
    await expect(verify({ timestamp: String(future), signature: sign(body, future) })).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
    const edge = NOW - 5 * 60 * 1000;
    await expect(verify({ timestamp: String(edge), signature: sign(body, edge) })).resolves.toMatchObject({ ok: true });
  });

  it("honors a custom tolerance", async () => {
    const old = NOW - 2000;
    await expect(verify({ timestamp: String(old), signature: sign(body, old), toleranceMs: 1000 })).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it.each([
    ["only a signature", { timestamp: null }],
    ["only a timestamp", { signature: undefined }],
    ["a timestamp in seconds with a dot", { timestamp: "1792553132.801" }],
    ["a non-numeric timestamp", { timestamp: "yesterday" }],
    ["a short signature", { signature: "abc123" }],
    ["a non-hex signature", { signature: "z".repeat(64) }],
    ["a prefixed signature", { signature: `sha256=${"a".repeat(57)}` }],
  ])("reports %s as malformed", async (_label, overrides) => {
    await expect(verify(overrides)).resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("reports a request with no signature headers as unsigned", async () => {
    await expect(verify({ signature: null, timestamp: null })).resolves.toEqual({ ok: false, reason: "unsigned" });
  });

  it("is invalid (not ok) when no secrets are configured", async () => {
    await expect(verify({ secrets: [] })).resolves.toEqual({ ok: false, reason: "invalid" });
  });
});

describe("constantTimeEqual", () => {
  it("compares bytes", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});

describe("parseSecrets", () => {
  it("splits, trims, drops empty values and duplicates", () => {
    expect(parseSecrets(" a , b,,a ,c ")).toEqual(["a", "b", "c"]);
    expect(parseSecrets(["x", " y "])).toEqual(["x", "y"]);
    expect(parseSecrets(undefined)).toEqual([]);
    expect(parseSecrets("")).toEqual([]);
  });
});

describe("parseWebhookEvent", () => {
  it("reads isArchived/isDraft and the timestamps (real payloads)", () => {
    expect(parseWebhookEvent(real.changedLiveApi)?.items).toEqual([
      {
        id: IDS.POST_A,
        collectionId: POSTS_ID,
        slug: "cms-trends-2023-5",
        isArchived: false,
        isDraft: false,
        lastPublished: "2026-10-21T15:27:35.842Z",
        lastUpdated: "2026-10-21T15:27:35.842Z",
      },
    ]);
    expect(parseWebhookEvent(real.changedStaged)?.items[0]).toMatchObject({ isDraft: true });
    expect(parseWebhookEvent(real.unpublished)?.items[0]).toMatchObject({ id: IDS.UNPUBLISHED, lastPublished: null });
  });

  it("reads archived/draft (docs example spelling)", () => {
    const payload = { ...itemPayload(IDS.POST_A, "x", POSTS_ID, "plain"), archived: true, draft: true };
    const event = parseWebhookEvent({ triggerType: "collection_item_changed", payload });
    expect(event?.items[0]).toMatchObject({ isArchived: true, isDraft: true });
  });

  it("reads every item of collection_item_published, and a flat payload too", () => {
    expect(parseWebhookEvent(real.published)?.items.map((item) => item.id)).toEqual([IDS.POST_A]);
    expect(parseWebhookEvent(webhookBodies.collection_item_published)?.items.map((item) => item.id)).toEqual([
      IDS.POST_A,
      IDS.POST_B,
      IDS.AUTHOR,
    ]);
    const flat = parseWebhookEvent({ triggerType: "collection_item_published", payload: itemPayload(IDS.POST_B, "b") });
    expect(flat?.items.map((item) => item.id)).toEqual([IDS.POST_B]);
  });

  it("has no items for site_publish and unknown events", () => {
    expect(parseWebhookEvent(webhookBodies.site_publish)?.items).toEqual([]);
    expect(parseWebhookEvent({ triggerType: "form_submission", payload: { id: "x" } })?.items).toEqual([]);
  });

  it("leaves slug undefined for localized fieldData", () => {
    const payload = { ...itemPayload(IDS.POST_A, "x"), fieldData: { "locale-1": { slug: "hola" } } };
    expect(parseWebhookEvent({ triggerType: "collection_item_deleted", payload })?.items[0]?.slug).toBeUndefined();
  });

  it("rejects bodies that aren't webhooks", () => {
    expect(parseWebhookEvent(null)).toBeUndefined();
    expect(parseWebhookEvent({ payload: {} })).toBeUndefined();
    expect(parseWebhookEvent([])).toBeUndefined();
  });
});

describe("tagsForEvent (default mapping)", () => {
  const post = `webflow:item:${IDS.POST_A}`;
  const posts = `webflow:collection:${POSTS_ID}`;

  it("site_publish → the site tag", () => {
    expect(tagsForEvent(webhookBodies.site_publish)).toEqual(["webflow"]);
  });

  it("collection_item_published → item and collection tags for every item", () => {
    expect(tagsForEvent(webhookBodies.collection_item_published)).toEqual([
      posts,
      post,
      `webflow:item:${IDS.POST_B}`,
      `webflow:collection:${AUTHORS_ID}`,
      `webflow:item:${IDS.AUTHOR}`,
    ]);
  });

  it("real published / unpublished / deleted → item and collection", () => {
    expect(tagsForEvent(real.published)).toEqual([posts, post]);
    expect(tagsForEvent(real.unpublished)).toEqual([posts, `webflow:item:${IDS.UNPUBLISHED}`]);
    expect(tagsForEvent(real.deleted)).toEqual([posts, `webflow:item:${IDS.DELETED}`]);
  });

  describe("collection_item_changed: skip only isDraft === true (fail-safe)", () => {
    it("staged edit (isDraft: true) → nothing; item + collection when opted in", () => {
      expect(tagsForEvent(real.changedStaged)).toEqual([]);
      expect(tagsForEvent(real.changedStaged, { invalidateOnStagedChanges: true })).toEqual([posts, post]);
    });

    it("the changed that accompanies a publish (isDraft: false) → item and collection", () => {
      expect(tagsForEvent(real.changedOnPublish)).toEqual([posts, post]);
    });

    it("API write to a live item (isDraft: false, the only event it fires) → item and collection", () => {
      expect(tagsForEvent(real.changedLiveApi)).toEqual([posts, post]);
    });

    it("no isDraft in the payload → item and collection", () => {
      const payload: Partial<typeof real.changedLiveApi.payload> = { ...real.changedLiveApi.payload };
      delete payload.isDraft;
      expect(tagsForEvent({ triggerType: "collection_item_changed", payload })).toEqual([posts, post]);
    });

    it("ignores the timestamps: isDraft: true with equal lastPublished/lastUpdated → nothing", () => {
      const payload = { ...real.changedLiveApi.payload, isDraft: true };
      expect(tagsForEvent({ triggerType: "collection_item_changed", payload })).toEqual([]);
    });

    it("reads the docs' `draft` spelling too", () => {
      const payload = { ...itemPayload(IDS.POST_A, "x", POSTS_ID, "plain"), draft: true };
      expect(tagsForEvent({ triggerType: "collection_item_changed", payload })).toEqual([]);
    });
  });

  it("collection_item_created follows the same rule", () => {
    expect(tagsForEvent(webhookBodies.collection_item_created)).toEqual([]);
    expect(tagsForEvent({ ...real.changedLiveApi, triggerType: "collection_item_created" })).toEqual([posts, post]);
  });

  it("accepts an already parsed event", () => {
    const parsed = parseWebhookEvent(real.changedLiveApi);
    expect(tagsForEvent(parsed)).toEqual([posts, post]);
  });

  it("ignores unrelated and malformed events", () => {
    expect(tagsForEvent({ triggerType: "form_submission", payload: {} })).toEqual([]);
    expect(tagsForEvent({ triggerType: "collection_item_deleted", payload: null })).toEqual([]);
    expect(tagsForEvent({ triggerType: "collection_item_published", payload: { items: "nope" } })).toEqual([]);
    expect(tagsForEvent({})).toEqual([]);
  });

  it("still invalidates the item when the collection ID is missing", () => {
    const payload: Partial<ReturnType<typeof itemPayload>> = itemPayload(IDS.POST_A, "x");
    delete payload.collectionId;
    expect(tagsForEvent({ triggerType: "collection_item_deleted", payload })).toEqual([post]);
  });
});
