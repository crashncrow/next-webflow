import { ENV } from "../core/env";
import { WebflowApiError, WebflowConfigError } from "../core/errors";
import type { WebflowClient } from "../core/client";
import { CMS_WEBHOOK_EVENTS, DEFAULT_WEBHOOK_EVENTS } from "../core/webhook";
import { mergeEnvList } from "./env-file";

/** Webflow allows this many webhooks per trigger type per site. */
export const MAX_WEBHOOKS_PER_TRIGGER = 75;

export interface Webhook {
  id: string;
  triggerType: string;
  url: string;
  siteId?: string;
  createdOn?: string | null;
  lastTriggered?: string | null;
  /** Only in the create response, only for site-token webhooks (name differs between sources). */
  secretKey?: string;
  secret?: string;
}

export interface CliIO {
  log: (message: string) => void;
  warn: (message: string) => void;
  readFile: (path: string) => string | undefined;
  writeFile: (path: string, content: string) => void;
  /** Resolves true when the user confirms. */
  confirm: (question: string) => Promise<boolean>;
}

export interface CommandContext {
  client: WebflowClient;
  siteId: string;
  io: CliIO;
  /** Env var the token came from, for error messages. */
  tokenEnv: string;
}

const REQUIRED_SCOPES =
  "The token needs **Sites: Read and write** (to create webhooks) and **CMS: Read** (for collection_item_* " +
  "events). Generate a site token in Site settings → Apps & integrations → API access and point " +
  "--token-env at the variable that holds it.";

export function requireHttpsUrl(url: string | undefined): string {
  if (!url) throw new WebflowConfigError("Missing --url (the https URL of your webhook route, e.g. https://example.com/api/webflow).");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebflowConfigError(`--url is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new WebflowConfigError(`--url must use https (Webflow only delivers to https): ${url}`);
  return parsed.toString();
}

export function parseEvents(value: string | undefined): string[] {
  if (!value) return [...DEFAULT_WEBHOOK_EVENTS];
  const events = [...new Set(value.split(",").map((event) => event.trim()).filter(Boolean))];
  const unknown = events.filter((event) => !(CMS_WEBHOOK_EVENTS as readonly string[]).includes(event));
  if (unknown.length > 0) {
    throw new WebflowConfigError(`Unknown event(s): ${unknown.join(", ")}. Supported: ${CMS_WEBHOOK_EVENTS.join(", ")}.`);
  }
  return events;
}

const sameUrl = (a: string, b: string) => {
  try {
    return new URL(a).toString() === new URL(b).toString();
  } catch {
    return a === b;
  }
};

/** Turns permission errors into an explanation of the scopes the token needs. */
async function withScopeHint<T>(context: CommandContext, action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WebflowApiError && (error.status === 401 || error.status === 403)) {
      throw new WebflowConfigError(
        `Webflow refused to ${action} (${error.status}${error.code ? ` ${error.code}` : ""}) with the token in ${context.tokenEnv}. ${REQUIRED_SCOPES}`,
      );
    }
    throw error;
  }
}

export async function fetchWebhooks(context: CommandContext): Promise<Webhook[]> {
  const response = await withScopeHint(context, "list webhooks", () =>
    context.client.request<{ webhooks?: Webhook[] }>(`/sites/${context.siteId}/webhooks`),
  );
  return response.webhooks ?? [];
}

export interface RegisterOptions {
  url: string | undefined;
  events?: string | undefined;
  /** Print secrets instead of writing them. */
  print?: boolean;
  /** Env file the secrets are appended to. */
  envFile: string;
}

export interface RegisterResult {
  created: Webhook[];
  skipped: Webhook[];
  secrets: string[];
}

export async function registerWebhooks(context: CommandContext, options: RegisterOptions): Promise<RegisterResult> {
  const url = requireHttpsUrl(options.url);
  const events = parseEvents(options.events);
  const { io } = context;

  const existing = await fetchWebhooks(context);
  if (events.some((event) => event.startsWith("collection_item_"))) {
    // Collection events need cms:read on the token; check it before creating anything.
    await withScopeHint(context, "read CMS collections", () => context.client.request(`/sites/${context.siteId}/collections`));
  }

  const toCreate: string[] = [];
  const skipped: Webhook[] = [];
  for (const event of events) {
    const duplicate = existing.find((webhook) => webhook.triggerType === event && sameUrl(webhook.url, url));
    if (duplicate) {
      skipped.push(duplicate);
      continue;
    }
    const count = existing.filter((webhook) => webhook.triggerType === event).length;
    if (count >= MAX_WEBHOOKS_PER_TRIGGER) {
      throw new WebflowConfigError(
        `The site already has ${count} "${event}" webhooks (Webflow's limit is ${MAX_WEBHOOKS_PER_TRIGGER} per trigger type). Remove some first.`,
      );
    }
    toCreate.push(event);
  }

  const created: Webhook[] = [];
  for (const event of toCreate) {
    const webhook = await withScopeHint(context, `create a "${event}" webhook`, () =>
      context.client.request<Webhook>(`/sites/${context.siteId}/webhooks`, {
        method: "POST",
        body: { triggerType: event, url },
      }),
    );
    created.push(webhook);
    io.log(`Created ${event} → ${url} (${webhook.id})`);
  }
  for (const webhook of skipped) {
    io.log(`Skipped ${webhook.triggerType}: already registered for this URL (${webhook.id}).`);
  }
  if (skipped.length > 0) {
    io.warn(
      "Existing webhooks keep their old secrets, which Webflow can't show again. If you lost them, " +
        "run `next-webflow webhooks unregister --url …` and register again.",
    );
  }

  const secrets = created.flatMap((webhook) => {
    const secret = webhook.secretKey ?? webhook.secret;
    return typeof secret === "string" && secret ? [secret] : [];
  });
  if (created.length > 0 && secrets.length < created.length) {
    io.warn(
      "Webflow didn't return a signing secret for every webhook. Webhooks created with an OAuth app are " +
        "signed with the app's client secret: put that in " + `${ENV.webhookSecret} instead.`,
    );
  }

  if (secrets.length > 0) {
    if (options.print) {
      io.log(`\n${ENV.webhookSecret}=${secrets.join(",")}`);
      io.warn(`Add these to ${ENV.webhookSecret} (append to existing values, comma-separated).`);
    } else {
      const current = io.readFile(options.envFile) ?? "";
      io.writeFile(options.envFile, mergeEnvList(current, ENV.webhookSecret, secrets));
      io.log(`Saved ${secrets.length} secret(s) to ${ENV.webhookSecret} in ${options.envFile}.`);
    }
    io.warn("Webflow shows webhook secrets only once: keep them safe; they can't be retrieved later.");
  }

  return { created, skipped, secrets };
}

export async function listWebhooks(context: CommandContext): Promise<Webhook[]> {
  const webhooks = await fetchWebhooks(context);
  if (webhooks.length === 0) {
    context.io.log("No webhooks registered for this site (dashboard-created webhooks aren't listed by the API).");
  }
  for (const webhook of webhooks) {
    const last = webhook.lastTriggered ? `last triggered ${webhook.lastTriggered}` : "never triggered";
    context.io.log(`${webhook.id}  ${webhook.triggerType.padEnd(28)} ${webhook.url}  (${last})`);
  }
  return webhooks;
}

export interface UnregisterOptions {
  url: string | undefined;
  /** Skip the confirmation prompt. */
  yes?: boolean;
}

export async function unregisterWebhooks(context: CommandContext, options: UnregisterOptions): Promise<Webhook[]> {
  const url = requireHttpsUrl(options.url);
  const matching = (await fetchWebhooks(context)).filter((webhook) => sameUrl(webhook.url, url));
  if (matching.length === 0) {
    context.io.log(`No webhooks point at ${url}.`);
    return [];
  }
  for (const webhook of matching) context.io.log(`${webhook.id}  ${webhook.triggerType}`);
  const confirmed = options.yes || (await context.io.confirm(`Delete these ${matching.length} webhook(s) pointing at ${url}?`));
  if (!confirmed) {
    context.io.log("Nothing deleted.");
    return [];
  }
  for (const webhook of matching) {
    await withScopeHint(context, "delete webhooks", () => context.client.request(`/webhooks/${webhook.id}`, { method: "DELETE" }));
    context.io.log(`Deleted ${webhook.triggerType} (${webhook.id})`);
  }
  context.io.warn(`Their secrets are still in ${ENV.webhookSecret}; remove them if you no longer need them.`);
  return matching;
}
