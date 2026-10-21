import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { mergeEnvList, parseEnvFile } from "../../src/cli/env-file";
import {
  MAX_WEBHOOKS_PER_TRIGGER,
  listWebhooks,
  registerWebhooks,
  unregisterWebhooks,
  type CliIO,
  type CommandContext,
  type Webhook,
} from "../../src/cli/webhooks";
import { CMS_WEBHOOK_EVENTS, WebflowConfigError } from "../../src/core";
import { SITE } from "../fixtures/webhooks";
import { createTestClient, webflowError } from "../helpers";
import { DATA_API, server } from "../msw";
import { ENDPOINT } from "../webhook-helpers";

const WEBHOOKS = `${DATA_API}/sites/${SITE}/webhooks`;
const ENV_FILE = ".env.local";

function existingWebhook(triggerType: string, url = ENDPOINT, id = `wh-${triggerType}`): Webhook {
  return { id, triggerType, url, siteId: SITE, createdOn: "2026-10-21T00:00:00.000Z", lastTriggered: null };
}

/** A fake Webflow site: webhook list, creation (returns `secretKey`), deletion, collections. */
function fakeSite({ existing = [] as Webhook[], secretField = "secretKey", forbid = "" } = {}) {
  const state = { webhooks: [...existing], created: [] as Array<{ triggerType: string; url: string }>, deleted: [] as string[] };
  let counter = 0;
  const forbidden = () => HttpResponse.json(webflowError("missing_scopes", "Missing scopes"), { status: 403 });
  server.use(
    http.get(WEBHOOKS, () => (forbid === "list" ? forbidden() : HttpResponse.json({ webhooks: state.webhooks }))),
    http.get(`${DATA_API}/sites/${SITE}/collections`, () =>
      forbid === "cms" ? forbidden() : HttpResponse.json({ collections: [] }),
    ),
    http.post(WEBHOOKS, async ({ request }) => {
      if (forbid === "create") return forbidden();
      const body = (await request.json()) as { triggerType: string; url: string };
      state.created.push(body);
      const webhook = { ...existingWebhook(body.triggerType, body.url, `wh-new-${++counter}`), [secretField]: `whsec_new_${counter}` };
      state.webhooks.push(webhook);
      return HttpResponse.json(webhook, { status: 201 });
    }),
    http.delete(`${DATA_API}/webhooks/:id`, ({ params }) => {
      state.deleted.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return state;
}

function setup(files: Record<string, string> = {}, confirmAnswer = true) {
  const output: string[] = [];
  const warnings: string[] = [];
  const io: CliIO = {
    log: (message) => output.push(message),
    warn: (message) => warnings.push(message),
    readFile: (path) => files[path],
    writeFile: (path, content) => {
      files[path] = content;
    },
    confirm: vi.fn(async () => confirmAnswer),
  };
  const context: CommandContext = { client: createTestClient().client, siteId: SITE, io, tokenEnv: "WEBFLOW_API_TOKEN" };
  return { context, io, files, output, warnings };
}

describe("webhooks register", () => {
  it("creates one webhook per CMS event by default and appends the secrets to .env.local", async () => {
    const site = fakeSite();
    const { context, files, warnings } = setup({ [ENV_FILE]: "WEBFLOW_API_TOKEN=keep-me\nWEBFLOW_SITE_ID=site\n" });

    const result = await registerWebhooks(context, { url: ENDPOINT, envFile: ENV_FILE });

    expect(site.created).toEqual(CMS_WEBHOOK_EVENTS.map((triggerType) => ({ triggerType, url: ENDPOINT })));
    expect(result.secrets).toEqual(["whsec_new_1", "whsec_new_2", "whsec_new_3", "whsec_new_4", "whsec_new_5", "whsec_new_6"]);
    expect(parseEnvFile(files[ENV_FILE] ?? "")).toEqual({
      WEBFLOW_API_TOKEN: "keep-me",
      WEBFLOW_SITE_ID: "site",
      WEBFLOW_WEBHOOK_SECRET: "whsec_new_1,whsec_new_2,whsec_new_3,whsec_new_4,whsec_new_5,whsec_new_6",
    });
    expect(warnings.join("\n")).toMatch(/only once/);
  });

  it("accepts the secret under `secret` too (field name differs between sources)", async () => {
    fakeSite({ secretField: "secret" });
    const { context } = setup();
    const result = await registerWebhooks(context, { url: ENDPOINT, events: "site_publish", envFile: ENV_FILE });
    expect(result.secrets).toEqual(["whsec_new_1"]);
  });

  it("doesn't create duplicates for the same URL and event, and keeps existing secrets", async () => {
    const site = fakeSite({ existing: [existingWebhook("site_publish"), existingWebhook("site_publish", "https://other.example/hook")] });
    const { context, files, warnings } = setup({ [ENV_FILE]: "WEBFLOW_WEBHOOK_SECRET=whsec_old\n" });

    const result = await registerWebhooks(context, { url: `${ENDPOINT}`, envFile: ENV_FILE });

    expect(site.created.map((webhook) => webhook.triggerType)).toEqual(
      CMS_WEBHOOK_EVENTS.filter((event) => event !== "site_publish"),
    );
    expect(result.skipped.map((webhook) => webhook.id)).toEqual(["wh-site_publish"]);
    expect(parseEnvFile(files[ENV_FILE] ?? "").WEBFLOW_WEBHOOK_SECRET).toBe(
      "whsec_old,whsec_new_1,whsec_new_2,whsec_new_3,whsec_new_4,whsec_new_5",
    );
    expect(warnings.join("\n")).toMatch(/can't show again/);
  });

  it("registers custom --events and validates them", async () => {
    const site = fakeSite();
    const { context } = setup();

    await registerWebhooks(context, { url: ENDPOINT, events: "collection_item_changed, site_publish", envFile: ENV_FILE });
    expect(site.created.map((webhook) => webhook.triggerType)).toEqual(["collection_item_changed", "site_publish"]);

    await expect(registerWebhooks(context, { url: ENDPOINT, events: "form_submission", envFile: ENV_FILE })).rejects.toThrow(
      /Unknown event\(s\): form_submission/,
    );
  });

  it("prints the secrets with --print instead of writing them", async () => {
    fakeSite();
    const { context, files, output } = setup();
    await registerWebhooks(context, { url: ENDPOINT, events: "site_publish", print: true, envFile: ENV_FILE });
    expect(files[ENV_FILE]).toBeUndefined();
    expect(output).toContain("\nWEBFLOW_WEBHOOK_SECRET=whsec_new_1");
  });

  it.each([
    [undefined, /Missing --url/],
    ["http://example.com/api/webflow", /must use https/],
    ["not a url", /not a valid URL/],
  ])("requires an https URL (%s)", async (url, message) => {
    fakeSite();
    const { context } = setup();
    await expect(registerWebhooks(context, { url, envFile: ENV_FILE })).rejects.toThrow(message);
  });

  it.each([
    ["list", "list webhooks"],
    ["cms", "read CMS collections"],
    ["create", 'create a "collection_item_created" webhook'],
  ])("explains the required scopes when %s is forbidden", async (forbid, action) => {
    fakeSite({ forbid });
    const { context } = setup();
    const error = await registerWebhooks(context, { url: ENDPOINT, envFile: ENV_FILE }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebflowConfigError);
    expect((error as Error).message).toContain(action);
    expect((error as Error).message).toMatch(/Sites: Read and write.*CMS: Read/s);
  });

  it("doesn't need CMS access when only site_publish is registered", async () => {
    fakeSite({ forbid: "cms" });
    const { context } = setup();
    await expect(registerWebhooks(context, { url: ENDPOINT, events: "site_publish", envFile: ENV_FILE })).resolves.toMatchObject({
      created: [expect.objectContaining({ triggerType: "site_publish" })],
    });
  });

  it(`fails before creating anything past ${MAX_WEBHOOKS_PER_TRIGGER} webhooks per trigger type`, async () => {
    const full = Array.from({ length: MAX_WEBHOOKS_PER_TRIGGER }, (_, index) =>
      existingWebhook("site_publish", `https://site-${index}.example/hook`, `wh-${index}`),
    );
    const site = fakeSite({ existing: full });
    const { context } = setup();
    await expect(registerWebhooks(context, { url: ENDPOINT, envFile: ENV_FILE })).rejects.toThrow(/limit is 75/);
    expect(site.created).toEqual([]);
  });

  it("warns when Webflow returns no secret (OAuth-created webhooks)", async () => {
    fakeSite({ secretField: "unused" });
    const { context, warnings } = setup();
    const result = await registerWebhooks(context, { url: ENDPOINT, events: "site_publish", envFile: ENV_FILE });
    expect(result.secrets).toEqual([]);
    expect(warnings.join("\n")).toMatch(/client secret/);
  });
});

describe("webhooks list", () => {
  it("prints every webhook of the site", async () => {
    fakeSite({ existing: [existingWebhook("site_publish"), existingWebhook("collection_item_deleted")] });
    const { context, output } = setup();
    const webhooks = await listWebhooks(context);
    expect(webhooks).toHaveLength(2);
    expect(output.join("\n")).toMatch(/site_publish.*https:\/\/example\.com\/api\/webflow.*never triggered/);
  });
});

describe("webhooks unregister", () => {
  const existing = [
    existingWebhook("site_publish"),
    existingWebhook("collection_item_deleted"),
    existingWebhook("site_publish", "https://other.example/hook", "wh-other"),
  ];

  it("deletes only the webhooks for --url after confirmation", async () => {
    const site = fakeSite({ existing });
    const { context, io } = setup();
    const deleted = await unregisterWebhooks(context, { url: ENDPOINT });
    expect(io.confirm).toHaveBeenCalledOnce();
    expect(deleted.map((webhook) => webhook.id)).toEqual(["wh-site_publish", "wh-collection_item_deleted"]);
    expect(site.deleted).toEqual(["wh-site_publish", "wh-collection_item_deleted"]);
  });

  it("deletes nothing if the user declines", async () => {
    const site = fakeSite({ existing });
    const { context } = setup({}, false);
    await expect(unregisterWebhooks(context, { url: ENDPOINT })).resolves.toEqual([]);
    expect(site.deleted).toEqual([]);
  });

  it("skips the prompt with --yes", async () => {
    const site = fakeSite({ existing });
    const { context, io } = setup({}, false);
    await unregisterWebhooks(context, { url: ENDPOINT, yes: true });
    expect(io.confirm).not.toHaveBeenCalled();
    expect(site.deleted).toHaveLength(2);
  });
});

describe("env file merging", () => {
  it("appends to an existing value without duplicates and keeps other lines and comments", () => {
    const before = "# secrets\nWEBFLOW_API_TOKEN=abc\nWEBFLOW_WEBHOOK_SECRET=\"whsec_a, whsec_b\"\nOTHER=1";
    expect(mergeEnvList(before, "WEBFLOW_WEBHOOK_SECRET", ["whsec_b", "whsec_c"])).toBe(
      "# secrets\nWEBFLOW_API_TOKEN=abc\nWEBFLOW_WEBHOOK_SECRET=whsec_a,whsec_b,whsec_c\nOTHER=1",
    );
  });

  it("adds the variable when missing", () => {
    expect(mergeEnvList("", "KEY", ["a"])).toBe("KEY=a\n");
    expect(mergeEnvList("A=1", "KEY", ["a", "b"])).toBe("A=1\nKEY=a,b\n");
    expect(mergeEnvList("A=1\n", "KEY", ["a"])).toBe("A=1\nKEY=a\n");
  });

  it("understands export prefixes and quotes when parsing", () => {
    expect(parseEnvFile("export A=1\nB='two words'\n# C=3\nD=4 # comment")).toEqual({ A: "1", B: "two words", D: "4" });
  });
});
