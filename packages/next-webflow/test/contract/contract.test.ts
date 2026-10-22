/**
 * Contract test against the real Webflow API of the TEST site (never a real one).
 *
 *   WEBFLOW_CONTRACT=1 pnpm --filter next-webflow test:contract
 *
 * Reads WEBFLOW_CMS_TOKEN / WEBFLOW_SITE_ID from the environment or packages/next-webflow/.env.local.
 * Only GET requests. Saves every real response to test/contract/output/ (git-ignored) and fails
 * when their shape drifts from our MSW fixtures (a key we read is gone or changed type), so
 * fixtures can be updated from reality. Runs weekly in GitHub Actions (.github/workflows/contract.yml).
 *
 * In CI (`CI` set) it prints only the drift summary: Actions logs of a public repo are public, so
 * real content (field values, URLs, IDs) stays in the local output files. Assertions report keys,
 * counts and booleans, never item data, so a failure doesn't print it either.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWebflowClient,
  normalizeItem,
  schemaFromApi,
  type FieldValueMap,
  type WebflowListResponse,
  type WebflowRawItem,
} from "../../src/core";
import type { ApiCollection } from "../../src/core/normalize";
import { fullRawPost, realPostsCollection, sitesCollectionsResponse, stagedItems } from "../fixtures/schema";
import { diffItemShapes, diffShapes, driftLines, type ShapeDifference } from "./shape";

const env = process.env;
const inCI = Boolean(env.CI);
const enabled = env.WEBFLOW_CONTRACT === "1" && Boolean(env.WEBFLOW_CMS_TOKEN) && Boolean(env.WEBFLOW_SITE_ID);
const COLLECTION_SLUG = env.WEBFLOW_CONTRACT_COLLECTION ?? "posts";
const OUTPUT_DIR = fileURLToPath(new URL("./output/", import.meta.url));

const ALL_FIELD_TYPES = [
  "PlainText",
  "RichText",
  "Image",
  "MultiImage",
  "VideoLink",
  "Link",
  "Email",
  "Phone",
  "Number",
  "DateTime",
  "Switch",
  "Color",
  "Option",
  "File",
  "Reference",
  "MultiReference",
  "ExtFileRef",
] as const satisfies ReadonlyArray<keyof FieldValueMap>;

interface ApiField {
  slug: string;
  type: string;
  isRequired: boolean;
  validations?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

describe.skipIf(!enabled)(`contract: real API vs fixtures (collection "${COLLECTION_SLUG}")`, () => {
  const client = createWebflowClient({ token: env.WEBFLOW_CMS_TOKEN, concurrency: 2 });
  const report: Record<string, unknown> = {};
  const diffs: Record<string, ShapeDifference[]> = {};

  let collection: ApiCollection & { fields: ApiField[] };
  let live: WebflowListResponse<WebflowRawItem>;
  let staged: WebflowListResponse<WebflowRawItem>;

  const firstLiveItem = (): WebflowRawItem => {
    const [item] = live.items;
    if (!item) throw new Error("The test collection has no published items.");
    return item;
  };

  const save = (name: string, data: unknown) =>
    writeFileSync(`${OUTPUT_DIR}${name}.json`, `${JSON.stringify(data, null, 2)}\n`);

  beforeAll(async () => {
    mkdirSync(OUTPUT_DIR, { recursive: true });

    const sites = await client.request<{ collections: ApiCollection[] }>(`/sites/${env.WEBFLOW_SITE_ID}/collections`);
    save("site-collections", sites);
    diffs.siteCollections = diffShapes(sitesCollectionsResponse, sites);

    const match = sites.collections.find((candidate) => candidate.slug === COLLECTION_SLUG);
    if (!match) throw new Error(`Collection "${COLLECTION_SLUG}" not found. Set WEBFLOW_CONTRACT_COLLECTION.`);

    collection = await client.request(`/collections/${match.id}`);
    save("collection", collection);
    // Every collection with its fields: typegen's input.
    save(
      "collections",
      await Promise.all(sites.collections.map((candidate) => client.request(`/collections/${candidate.id}`))),
    );
    // Referenced items (posts.author / co-authors): include's input.
    const authors = sites.collections.find((candidate) => candidate.slug === "authors");
    if (authors)
      save(
        "authors-items-live",
        await client.request(`/collections/${authors.id}/items/live`, { query: { limit: 100 } }),
      );
    diffs.collection = diffShapes(realPostsCollection, collection);

    live = await client.request(`/collections/${match.id}/items/live`, { query: { limit: 100 } });
    staged = await client.request(`/collections/${match.id}/items`, { query: { limit: 100 } });
    save("items-live", live);
    save("items-staged", staged);
    diffs.liveItem = diffItemShapes(fullRawPost, live.items);
    if (stagedItems[0]) diffs.stagedItem = diffItemShapes(stagedItems[0], staged.items);
  });

  afterAll(() => {
    if (!collection) return;
    save("report", report);
    save("diff", diffs);
    if (inCI) {
      const drift = driftLines(diffs);
      console.log(drift.length ? `\nAPI drift:\n${drift.join("\n")}` : "\nNo API drift.");
      return;
    }
    console.log(`\nContract output written to ${OUTPUT_DIR}`);
    for (const [name, list] of Object.entries(diffs)) {
      const relevant = list.filter(
        (difference) => difference.type !== "extra" || !difference.path.includes("fieldData"),
      );
      if (relevant.length > 0) console.log(`\n[${name}]`, relevant);
    }
    console.log("\n[report]", JSON.stringify(report, null, 2));
  });

  it("real responses keep the shape of our fixtures (API drift)", () => {
    const drift = driftLines(diffs);
    const extra = Object.entries(diffs).flatMap(([name, list]) =>
      list
        .filter((difference) => difference.type === "extra")
        .map((difference) => `${name}: ${difference.path} (${difference.real})`),
    );
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        [
          "## Webflow API vs fixtures",
          drift.length ? "**Drift (fails the run):**\n" + drift.map((line) => `- \`${line}\``).join("\n") : "No drift.",
          extra.length ? "\nNew keys (informational):\n" + extra.map((line) => `- \`${line}\``).join("\n") : "",
          "\nUpdate fixtures: run the contract test locally, then `pnpm --filter next-webflow fixtures:update` and review the diff.",
          "",
        ].join("\n"),
      );
    }
    expect(
      drift,
      "The real Webflow API no longer matches test/fixtures/api (see test/contract/output/diff.json)",
    ).toEqual([]);
  });

  it("the test site covers every field type", () => {
    const present = new Set(collection.fields.map((field) => field.type));
    const missing = ALL_FIELD_TYPES.filter((type) => !present.has(type));
    report.missingFieldTypes = missing;
    // ExtFileRef can't be created from the Designer; everything else should exist.
    expect(missing.filter((type) => type !== "ExtFileRef")).toEqual([]);
  });

  it("settles where Reference fields keep the target collection ID", () => {
    const references = collection.fields.filter(
      (field) => field.type === "Reference" || field.type === "MultiReference",
    );
    expect(references.length).toBeGreaterThan(0);

    report.referenceCollectionId = references.map((field) => ({
      slug: field.slug,
      type: field.type,
      inValidations: typeof field.validations?.collectionId === "string",
      inMetadata: typeof field.metadata?.collectionId === "string",
    }));
    const schema = schemaFromApi(collection);
    for (const field of references) {
      expect(Object.values(schema.fields).find((entry) => entry.slug === field.slug)?.collectionId).toBeTypeOf(
        "string",
      );
    }
  });

  it("Option fields list { id, name } in validations.options", () => {
    const options = collection.fields.filter((field) => field.type === "Option");
    expect(options.length).toBeGreaterThan(0);
    for (const field of options) {
      const list = field.validations?.options;
      const valid =
        Array.isArray(list) &&
        list.length > 0 &&
        list.every((option) => typeof option?.id === "string" && typeof option?.name === "string");
      expect(valid, `${field.slug}: validations.options is a list of { id, name }`).toBe(true);
    }
  });

  it("list responses have items and pagination", () => {
    for (const response of [live, staged]) {
      expect(response.pagination).toEqual({
        limit: expect.any(Number),
        offset: expect.any(Number),
        total: expect.any(Number),
      });
      expect(response.items.length).toBeGreaterThan(0);
    }
  });

  it("items have the top-level fields we read", () => {
    const expected = {
      id: "string",
      lastUpdated: "string",
      createdOn: "string",
      isArchived: "boolean",
      isDraft: "boolean",
    };
    const problems = [...live.items, ...staged.items].flatMap((item, index) => {
      const wrong = Object.entries(expected)
        .filter(([key, type]) => typeof (item as unknown as Record<string, unknown>)[key] !== type)
        .map(([key]) => key);
      for (const key of ["name", "slug"]) if (typeof item.fieldData[key] !== "string") wrong.push(`fieldData.${key}`);
      return wrong.map((key) => `item ${index}: ${key}`);
    });
    expect(problems).toEqual([]);
    report.cmsLocaleId = live.items[0]?.cmsLocaleId ?? "(missing)";
  });

  it("records how each field type's value looks and how empty fields are returned", () => {
    const values: Record<string, unknown> = {};
    const empty: Record<string, string> = {};
    for (const field of collection.fields) {
      const withValue = live.items.find((item) => item.fieldData[field.slug] != null);
      values[`${field.type} (${field.slug})`] = withValue?.fieldData[field.slug] ?? "(no item has a value)";
      const blank = live.items.find((item) => item.fieldData[field.slug] == null);
      if (blank) empty[field.slug] = field.slug in blank.fieldData ? "null" : "omitted";
    }
    report.fieldValues = values;
    report.emptyFields = empty;
    expect(Object.keys(empty).length).toBeGreaterThan(0);
  });

  it("our pipeline normalizes real items with the real schema without mismatches", () => {
    const schema = schemaFromApi(collection);
    const results = live.items.map((item) => normalizeItem(item, schema));
    expect(results.map((result) => result.mismatch).filter(Boolean)).toEqual([]);

    const videoKeys = Object.entries(schema.fields)
      .filter(([, field]) => field.type === "VideoLink")
      .map(([key]) => key);
    for (const { item } of results) {
      for (const key of videoKeys) {
        const video = item.fieldData[key];
        if (video !== undefined) expect(typeof (video as { url?: unknown }).url, `${key} has no url`).toBe("string");
      }
    }
  });

  it("records lastPublished on live vs staged items", () => {
    report.lastPublished = {
      live: [...new Set(live.items.map((item) => (item.lastPublished === null ? "null" : "string")))],
      staged: [...new Set(staged.items.map((item) => (item.lastPublished === null ? "null" : "string")))],
    };
    expect(report.lastPublished).toBeDefined();
  });

  it("?slug= returns exactly that item, live and staged", async () => {
    const target = firstLiveItem();
    const slug = target.fieldData.slug;
    const bySlugLive = await client.request<WebflowListResponse<WebflowRawItem>>(
      `/collections/${collection.id}/items/live`,
      { query: { slug } },
    );
    const bySlugStaged = await client.request<WebflowListResponse<WebflowRawItem>>(
      `/collections/${collection.id}/items`,
      { query: { slug } },
    );
    for (const [name, response] of [
      ["live", bySlugLive],
      ["staged", bySlugStaged],
    ] as const) {
      expect(response.items.length, `?slug= (${name}) item count`).toBe(1);
      expect(response.items[0]?.id === target.id, `?slug= (${name}) returned another item`).toBe(true);
    }
  });

  it("get item by ID works live and staged; staged-only items 404 on live", async () => {
    const target = firstLiveItem();
    const one = await client.request<WebflowRawItem>(`/collections/${collection.id}/items/${target.id}/live`);
    expect(one.id === target.id, "by-ID (live) returned another item").toBe(true);
    save("item-live", one);

    const liveIds = new Set(live.items.map((item) => item.id));
    const draftOnly = staged.items.find((item) => !liveIds.has(item.id));
    report.hasDraftOnlyItem = Boolean(draftOnly);
    if (draftOnly) {
      const status = await client.request(`/collections/${collection.id}/items/${draftOnly.id}/live`).then(
        () => 200,
        (error: { status?: number }) => error.status,
      );
      expect(status, "a staged-only item on /items/{id}/live").toBe(404);
      const stagedOne = await client.request<WebflowRawItem>(`/collections/${collection.id}/items/${draftOnly.id}`);
      expect(stagedOne.id === draftOnly.id, "by-ID (staged) returned another item").toBe(true);
    }
  });

  it("the Content Delivery API returns the same live items", async () => {
    const response = await fetch(`https://api-cdn.webflow.com/v2/collections/${collection.id}/items/live?limit=100`, {
      headers: { authorization: `Bearer ${env.WEBFLOW_CMS_TOKEN}`, accept: "application/json" },
    });
    expect(response.ok).toBe(true);
    report.cdnCacheStatus = response.headers.get("cf-cache-status");
    const body = (await response.json()) as WebflowListResponse<WebflowRawItem>;
    save("items-cdn", body);
    const cdnIds = new Set(body.items.map((item) => item.id));
    const liveIds = new Set(live.items.map((item) => item.id));
    expect({
      missingOnCdn: [...liveIds].filter((id) => !cdnIds.has(id)).length,
      extraOnCdn: [...cdnIds].filter((id) => !liveIds.has(id)).length,
    }).toEqual({ missingOnCdn: 0, extraOnCdn: 0 });
  });
});
