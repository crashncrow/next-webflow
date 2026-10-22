import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ApiCollection } from "../../src/core/normalize";
import { WebflowConfigError, type ItemOf } from "../../src/core";
import {
  generateIndexFile,
  generateSchemaFile,
  importsGeneratedSchema,
  typeNameForCollection,
} from "../../src/typegen/generate";
import realCollections from "../fixtures/api/collections.json";
import { schema as expectedSchema } from "../fixtures/schema";
import * as golden from "../fixtures/generated/schema";

const GOLDEN = new URL("../fixtures/generated/schema.ts", import.meta.url);
const IMPORT_FROM = "../../../src";

/** SYNTHETIC: a slug starting with a digit (quoted key, prefixed type name) and an ExtFileRef field. */
const events2024: ApiCollection = {
  id: "events-collection-id",
  slug: "2024-events",
  fields: [
    { slug: "name", type: "PlainText", isRequired: true },
    { slug: "slug", type: "PlainText", isRequired: true },
    { slug: "legacy-asset", type: "ExtFileRef", isRequired: false },
    {
      slug: "kind",
      type: "Option",
      isRequired: false,
      validations: {
        options: [
          { id: "opt-1", name: 'Talk "live"' },
          { id: "opt-2", name: "Workshop" },
        ],
      },
    },
  ],
};

const inputs = [...(realCollections as ApiCollection[]), events2024];
const collection = (slug: string, fieldSlugs: string[]): ApiCollection => ({
  id: `${slug}-id`,
  slug,
  fields: fieldSlugs.map((fieldSlug) => ({ slug: fieldSlug, type: "PlainText", isRequired: false })),
});

describe("generateSchemaFile", () => {
  it("matches the committed golden file (UPDATE_GOLDEN=1 rewrites it)", () => {
    const { source } = generateSchemaFile(inputs, { importFrom: IMPORT_FROM });
    if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, source);
    expect(source).toBe(readFileSync(GOLDEN, "utf8"));
  });

  it("emits the runtime schema the library expects, from real API responses", () => {
    expect(golden.schema.authors).toEqual(expectedSchema.authors);
    expect(golden.schema.posts.fields.category).toMatchObject({
      ...expectedSchema.posts.fields.category,
      options: expect.any(Array),
    });
    // The live site gained a "Tutorials" option after the fixture schema was written.
    expect(golden.schema.posts.fields.category.options.map((option) => option.name)).toEqual([
      "News",
      "Guides",
      "Tutorials",
    ]);
    expect(Object.keys(golden.schema.posts.fields)).toEqual(Object.keys(expectedSchema.posts.fields));
  });

  it("exports one item type per collection, inferred from the schema", () => {
    expectTypeOf<golden.PostsItem>().toEqualTypeOf<ItemOf<typeof golden.schema, "posts">>();
    expectTypeOf<golden.Collection2024EventsItem["fieldData"]["kind"]>().toEqualTypeOf<
      | { id: "opt-1"; name: 'Talk "live"' }
      | { id: "opt-2"; name: "Workshop" }
      | { id: string; name: undefined }
      | undefined
    >();
    expectTypeOf<golden.PostsItem["fieldData"]["category"]>().exclude<undefined>().toHaveProperty("name");
  });

  it("is deterministic: collections sorted by slug, regardless of API order", () => {
    const forward = generateSchemaFile(inputs).source;
    expect(generateSchemaFile([...inputs].reverse()).source).toBe(forward);
    expect(forward.indexOf('"2024-events"')).toBeLessThan(forward.indexOf("authors:"));
    expect(forward).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps, so --check is stable
  });

  it("imports types only, from next-webflow by default", () => {
    expect(generateSchemaFile(inputs).source).toContain('import type { ItemOf, WebflowSchema } from "next-webflow";');
  });

  it("warns about ExtFileRef fields", () => {
    expect(generateSchemaFile(inputs).warnings).toEqual([
      '"2024-events.legacyAsset" is an ExtFileRef field; its values are typed `unknown`.',
    ]);
  });

  it("fails when two collection slugs map to the same type name", () => {
    const run = () => generateSchemaFile([collection("blog-posts", ["name"]), collection("blog_posts", ["name"])]);
    expect(run).toThrow(/"blog-posts" and "blog_posts" → BlogPostsItem/);
    expect(run).toThrow(WebflowConfigError);
  });

  it("fails when two field slugs map to the same key", () => {
    expect(() => generateSchemaFile([collection("posts", ["post-body", "post_body"])])).toThrow(
      /"posts" has fields that map to the same key: "post-body" and "post_body" → postBody/,
    );
  });
});

describe("typeNameForCollection", () => {
  it.each([
    ["posts", "PostsItem"],
    ["blog-posts", "BlogPostsItem"],
    ["news", "NewsItem"],
    ["2024-events", "Collection2024EventsItem"],
    ["3d-models", "Collection3dModelsItem"],
    ["café-menu", "CafMenuItem"],
    ["---", "CollectionItem"],
  ])("%s → %s", (slug, name) => {
    expect(typeNameForCollection(slug)).toBe(name);
  });
});

describe("index.ts template", () => {
  it("imports the schema and exports the client functions and the types", () => {
    const source = generateIndexFile();
    expect(source).toContain('import { createWebflow } from "next-webflow";');
    expect(source).toContain("export const { getItems, getItemBySlug, getItem } = createWebflow({ schema });");
    expect(source).toContain('export type * from "./schema";');
    expect(importsGeneratedSchema(source)).toBe(true);
  });

  it.each([
    ['import { schema } from "./schema";', true],
    ["import { schema } from './schema.js';", true],
    ['import { schema } from "./schema.ts";', true],
    ['import { schema } from "./my-schema";', false],
    ["export const x = 1;", false],
  ])("detects whether %s imports the generated schema", (source, expected) => {
    expect(importsGeneratedSchema(source)).toBe(expected);
  });
});
