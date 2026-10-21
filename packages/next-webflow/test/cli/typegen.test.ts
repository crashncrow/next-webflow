import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { runTypegen } from "../../src/cli/typegen";
import type { CliIO, CommandContext } from "../../src/cli/webhooks";
import { WebflowConfigError } from "../../src/core";
import type { ApiCollection } from "../../src/core/normalize";
import { generateIndexFile, generateSchemaFile } from "../../src/typegen/generate";
import realCollections from "../fixtures/api/collections.json";
import { SITE } from "../fixtures/webhooks";
import { createTestClient, webflowError } from "../helpers";
import { DATA_API, server } from "../msw";

const SCHEMA = "webflow/schema.ts";
const INDEX = "webflow/index.ts";
const collections = realCollections as ApiCollection[];

function fakeSite({ forbid = false, list = collections } = {}) {
  server.use(
    http.get(`${DATA_API}/sites/${SITE}/collections`, () =>
      forbid
        ? HttpResponse.json(webflowError("missing_scopes", "Missing scopes"), { status: 403 })
        : HttpResponse.json({ collections: list.map(({ id, slug }) => ({ id, slug })) }),
    ),
    http.get(`${DATA_API}/collections/:id`, ({ params }) => HttpResponse.json(list.find((item) => item.id === params.id))),
  );
}

function setup(files: Record<string, string> = {}) {
  const output: string[] = [];
  const warnings: string[] = [];
  const io: CliIO = {
    log: (message) => output.push(message),
    warn: (message) => warnings.push(message),
    readFile: (path) => files[path],
    writeFile: vi.fn((path: string, content: string) => {
      files[path] = content;
    }),
    confirm: async () => false,
  };
  const context: CommandContext = { client: createTestClient().client, siteId: SITE, io, tokenEnv: "WEBFLOW_CMS_TOKEN" };
  return { context, io, files, output: () => output.join("\n"), warnings: () => warnings.join("\n") };
}

const expected = () => generateSchemaFile(collections).source;

describe("typegen", () => {
  it("writes schema.ts and creates index.ts on the first run", async () => {
    fakeSite();
    const { context, files, output } = setup();

    await expect(runTypegen(context)).resolves.toBe(0);

    expect(files[SCHEMA]).toBe(expected());
    expect(files[INDEX]).toBe(generateIndexFile());
    expect(output()).toMatch(/Wrote webflow\/schema\.ts \(2 collections\)/);
    expect(output()).toMatch(/Created webflow\/index\.ts/);
  });

  it("regenerates schema.ts but leaves a customized index.ts untouched", async () => {
    fakeSite();
    const custom = 'import { createWebflow } from "next-webflow";\nimport { schema } from "./schema";\n// source: "cdn"\n';
    const { context, files, output, warnings } = setup({ [SCHEMA]: "// old", [INDEX]: custom });

    await runTypegen(context);

    expect(files[SCHEMA]).toBe(expected());
    expect(files[INDEX]).toBe(custom);
    expect(output()).toMatch(/webflow\/index\.ts left untouched/);
    expect(warnings()).toBe("");
  });

  it("doesn't rewrite an unchanged schema.ts", async () => {
    fakeSite();
    const { context, io, output } = setup({ [SCHEMA]: expected(), [INDEX]: generateIndexFile() });
    await runTypegen(context);
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(output()).toMatch(/schema\.ts unchanged/);
  });

  it("warns when index.ts doesn't import ./schema", async () => {
    fakeSite();
    const { context, warnings } = setup({ [INDEX]: 'export const getItems = () => [];\n' });
    await runTypegen(context);
    expect(warnings()).toMatch(/webflow\/index\.ts doesn't import "\.\/schema"/);
  });

  it("recreates index.ts with --force", async () => {
    fakeSite();
    const { context, files, output } = setup({ [INDEX]: "// mine\n" });
    await runTypegen(context, { force: true });
    expect(files[INDEX]).toBe(generateIndexFile());
    expect(output()).toMatch(/Recreated webflow\/index\.ts/);
  });

  it("writes to --out", async () => {
    fakeSite();
    const { context, files } = setup();
    await runTypegen(context, { out: "src/cms" });
    expect(Object.keys(files).sort()).toEqual(["src/cms/index.ts", "src/cms/schema.ts"]);
  });

  it("passes on warnings (ExtFileRef)", async () => {
    const extFile = { id: "x-id", slug: "x", fields: [{ slug: "asset", type: "ExtFileRef", isRequired: false }] };
    fakeSite({ list: [...collections, extFile] });
    const { context, warnings } = setup();
    await runTypegen(context);
    expect(warnings()).toMatch(/"x\.asset" is an ExtFileRef field/);
  });

  it("explains the CMS: Read scope on 401/403", async () => {
    fakeSite({ forbid: true });
    const { context } = setup();
    const error = await runTypegen(context).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebflowConfigError);
    expect((error as Error).message).toMatch(/CMS: Read/);
  });

  describe("--check", () => {
    it("passes when schema.ts is up to date, and never writes", async () => {
      fakeSite();
      const { context, io, output } = setup({ [SCHEMA]: expected() });
      await expect(runTypegen(context, { check: true })).resolves.toBe(0);
      expect(io.writeFile).not.toHaveBeenCalled();
      expect(output()).toMatch(/up to date/);
    });

    it("passes when schema.ts was only reformatted (same hash)", async () => {
      fakeSite();
      const reformatted = expected().replaceAll('"', "'").replaceAll("  ", "\t");
      const { context } = setup({ [SCHEMA]: reformatted });
      await expect(runTypegen(context, { check: true })).resolves.toBe(0);
    });

    it("fails with the changed lines when the site's schema changed", async () => {
      const [authors, posts] = collections as [ApiCollection, ApiCollection];
      const withSubtitle = { ...posts, fields: [...(posts.fields ?? []), { slug: "subtitle", type: "PlainText", isRequired: false }] };
      fakeSite({ list: [authors, withSubtitle] });
      const { context, io, warnings } = setup({ [SCHEMA]: expected() });

      await expect(runTypegen(context, { check: true })).resolves.toBe(1);

      expect(io.writeFile).not.toHaveBeenCalled();
      expect(warnings()).toMatch(/schema\.ts is out of date/);
      expect(warnings()).toMatch(/\+ subtitle: \{ slug: "subtitle", type: "PlainText", required: false \},/);
      expect(warnings()).toMatch(/Run `npx next-webflow typegen`/);
    });

    it("fails when schema.ts doesn't exist", async () => {
      fakeSite();
      const { context, warnings } = setup();
      await expect(runTypegen(context, { check: true })).resolves.toBe(1);
      expect(warnings()).toMatch(/doesn't exist/);
    });
  });
});
