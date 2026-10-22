import { ENV, readEnv } from "./env";
import {
  DEFAULT_TIMESTAMP_TOLERANCE_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  parseSecrets,
  parseWebhookEvent,
  tagsForEvent,
  verifyWebflowSignature,
  type WebflowWebhookEvent,
} from "./webhook";

/** Second argument of Next's `revalidateTag` (a cacheLife profile name or an inline profile). */
export type RevalidateProfile = string | { stale?: number; revalidate?: number; expire?: number };

export interface WebhookLogger {
  info?: (message: string) => void;
  warn: (message: string) => void;
  error?: (message: string) => void;
}

export interface WebhookHandlerOptions {
  /** Signing secret(s). Default: `WEBFLOW_WEBHOOK_SECRET` (comma-separated, one per webhook). */
  secret?: string | readonly string[] | undefined;
  /**
   * INSECURE: accept requests without signature headers (webhooks created in the Webflow
   * dashboard aren't signed). Anyone who knows the URL can then trigger revalidations.
   */
  allowUnsigned?: boolean;
  /** Passed to `revalidateTag(tag, profile)`. Default `{ expire: 0 }`: next visit gets fresh data. */
  profile?: RevalidateProfile;
  /** Also invalidate on `collection_item_created` / `_changed` (usually staged-only edits). */
  invalidateOnStagedChanges?: boolean;
  /** Tags to invalidate in addition to the defaults (e.g. your own `fetch` tags). */
  extraTags?: (event: WebflowWebhookEvent) => readonly string[] | undefined;
  /** Replaces the tag list entirely. Receives the defaults (plus `extraTags`). */
  tags?: (event: WebflowWebhookEvent, defaults: readonly string[]) => readonly string[];
  /** Called after invalidating, for every verified event. A throw makes the response 500 (Webflow retries). */
  onEvent?: (event: WebflowWebhookEvent, tags: readonly string[]) => void | Promise<void>;
  /** Default: `console` for warnings and errors; `info` is silent unless provided. */
  logger?: WebhookLogger;
  /** Max age of `x-webflow-timestamp`. Default 5 minutes. */
  toleranceMs?: number;
}

export interface WebhookHandlerDeps {
  /** Invalidates one tag. In Next.js: `revalidateTag(tag, profile)`. */
  revalidate: (tag: string, profile: RevalidateProfile) => void | Promise<void>;
  now?: () => number;
}

export const UNSIGNED_WEBHOOK_MESSAGE =
  "Unsigned webhook rejected. Webhooks created in the Webflow dashboard aren't signed. Register signed " +
  "webhooks with `npx next-webflow webhooks register --url <this endpoint's https URL>`, which saves " +
  `their secrets to ${ENV.webhookSecret}. To accept unsigned webhooks anyway (insecure: anyone who ` +
  "knows the URL can trigger revalidations), pass `allowUnsigned: true` to createWebhookHandler.";

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/** Builds a `(request) => Response` webhook endpoint: verify, invalidate, answer 200. */
export function createWebhookRequestHandler(options: WebhookHandlerOptions, deps: WebhookHandlerDeps) {
  const logger: WebhookLogger = options.logger ?? { warn: console.warn, error: console.error };
  let loggerErrorReported = false;
  const log = (level: keyof WebhookLogger, message: string) => {
    try {
      logger[level]?.(message);
    } catch (error) {
      if (loggerErrorReported) return;
      loggerErrorReported = true;
      try {
        const report = level === "error" ? logger.warn : (logger.error ?? logger.warn);
        report.call(logger, `[next-webflow] Logger ${level} failed: ${String(error)}`);
      } catch {
        // A broken logger must not change webhook delivery semantics.
      }
    }
  };
  const profile = options.profile ?? { expire: 0 };

  return async function handleWebhook(request: Request): Promise<Response> {
    const rawBody = await request.text();
    const signature = request.headers.get(SIGNATURE_HEADER);
    const timestamp = request.headers.get(TIMESTAMP_HEADER);
    // Resolved per request so env changes (tests, late config) are picked up.
    const secrets = parseSecrets(options.secret ?? readEnv(ENV.webhookSecret));

    if (!signature && !timestamp) {
      if (!options.allowUnsigned) {
        log("warn", `[next-webflow] ${UNSIGNED_WEBHOOK_MESSAGE}`);
        return json(401, { ok: false, error: UNSIGNED_WEBHOOK_MESSAGE });
      }
      log("warn", "[next-webflow] Accepting an unsigned webhook because allowUnsigned is true (insecure).");
    } else {
      if (secrets.length === 0) {
        const message =
          `No webhook secret configured. Set ${ENV.webhookSecret} (comma-separated, one per webhook) ` +
          "with the secrets printed by `npx next-webflow webhooks register`.";
        log("error", `[next-webflow] ${message}`);
        return json(500, { ok: false, error: message });
      }
      const result = await verifyWebflowSignature({
        rawBody,
        signature,
        timestamp,
        secrets,
        now: deps.now?.() ?? Date.now(),
        toleranceMs: options.toleranceMs ?? DEFAULT_TIMESTAMP_TOLERANCE_MS,
      });
      if (!result.ok) {
        const status = result.reason === "malformed" ? 400 : 401;
        const message = {
          unsigned: "Missing signature headers.",
          malformed: `Malformed ${SIGNATURE_HEADER} / ${TIMESTAMP_HEADER} headers.`,
          expired: "Webhook timestamp is too old (or in the future); possible replay.",
          invalid: `Invalid signature: no secret in ${ENV.webhookSecret} matches.`,
        }[result.reason];
        log("warn", `[next-webflow] Webhook rejected: ${message}`);
        return json(status, { ok: false, error: message });
      }
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json(400, { ok: false, error: "Body is not JSON." });
    }
    const event = parseWebhookEvent(body);
    if (!event) return json(400, { ok: false, error: "Not a Webflow webhook body ({ triggerType, payload })." });

    const defaults = [
      ...tagsForEvent(event, options.invalidateOnStagedChanges ? { invalidateOnStagedChanges: true } : {}),
      ...(options.extraTags?.(event) ?? []),
    ];
    const tags = [...new Set(options.tags ? options.tags(event, defaults) : defaults)];

    try {
      // Idempotent: Webflow's retries (up to 3, 10 min apart) just invalidate the same tags again.
      for (const tag of tags) await deps.revalidate(tag, profile);
      await options.onEvent?.(event, tags);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", `[next-webflow] Webhook ${event.triggerType} failed: ${message}`);
      return json(500, { ok: false, error: message });
    }

    const items = event.items.map(
      (item) =>
        `${item.id} isDraft=${item.isDraft} lastPublished=${item.lastPublished} lastUpdated=${item.lastUpdated}`,
    );
    log(
      "info",
      `[next-webflow] ${event.triggerType}: revalidated ${tags.length ? tags.join(", ") : "nothing"}` +
        (items.length ? ` (${items.join("; ")})` : ""),
    );
    return json(200, { ok: true, triggerType: event.triggerType, revalidated: tags });
  };
}
