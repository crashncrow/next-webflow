// Draft mode route logic, Next-free. `src/draft/index.ts` wires Next's `draftMode()`.
import { createWebflowCms, unsafeStagedCache, type WebflowCms, type WebflowCmsConfig } from "./cms";
import { ENV, readEnv } from "./env";
import { WebflowConfigError, WebflowNotFoundError } from "./errors";
import { safeRelativePath, verifyPreviewParams } from "./preview";
import type { WebflowItem, WebflowSchema } from "./schema";
import { parseSecrets } from "./webhook";

export interface DraftHandlerOptions<S extends WebflowSchema | undefined = undefined> extends Pick<
  WebflowCmsConfig<S>,
  "schema" | "siteId" | "token" | "fetch" | "baseUrls" | "retry" | "concurrency"
> {
  /**
   * Where the previewed item lives in your app, e.g. `(collection, item) => \`/blog/${item.fieldData.slug}\``.
   * Receives the **staged** item, so a slug changed in a draft is already the new one. Required.
   */
  resolvePath?: ((collection: string, item: WebflowItem) => string | Promise<string>) | undefined;
  /** Signing secret(s). Default `WEBFLOW_PREVIEW_SECRET` (comma-separated: any of them verifies). */
  secret?: string | readonly string[] | undefined;
  /**
   * Prefixed to redirects (Webflow Cloud's mount path, e.g. `/app`). Default:
   * `NEXT_PUBLIC_BASE_PATH`, then the base path Next.js inlines at build time.
   */
  basePath?: string | undefined;
  /** Reject links whose expiry is further away than this. Default 30 days. */
  maxLinkLifetimeSeconds?: number | undefined;
  logger?: Pick<Console, "warn"> | undefined;
}

export interface DraftModeControls {
  enable(): Promise<void>;
  disable(): Promise<void>;
  /** The framework's base path, used when `options.basePath` isn't set. */
  basePath?(): string | undefined;
}

export interface DraftRouteHandlers {
  /** Enter preview (signed link), or leave it with `?disable=1&path=/somewhere`. */
  GET(request: Request): Promise<Response>;
  /** Leave preview without a redirect (e.g. `fetch(route, { method: "DELETE" })`). */
  DELETE(request: Request): Promise<Response>;
}

const noStore = { "cache-control": "private, no-store" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

/** Last resort: a NextRequest's `nextUrl.basePath` (empty on Webflow Cloud, measured 2026-10-21). */
function requestBasePath(request: Request): string | undefined {
  const basePath = (request as Request & { nextUrl?: { basePath?: unknown } }).nextUrl?.basePath;
  return typeof basePath === "string" && basePath ? basePath : undefined;
}

export function createDraftRequestHandler<S extends WebflowSchema | undefined = undefined>(
  options: DraftHandlerOptions<S>,
  controls: DraftModeControls,
  deps: { cms?: WebflowCms<S>; now?: () => number } = {},
): DraftRouteHandlers {
  const logger = options.logger ?? console;
  const basePathFor = (request: Request) =>
    (options.basePath ?? controls.basePath?.() ?? requestBasePath(request) ?? "").replace(/\/$/, "");
  const redirect = (request: Request, path: string) =>
    new Response(null, { status: 307, headers: { ...noStore, location: `${basePathFor(request)}${path}` } });
  let cms = deps.cms;
  const getCms = () =>
    (cms ??= createWebflowCms<S>({
      schema: options.schema,
      siteId: options.siteId,
      token: options.token,
      fetch: options.fetch,
      baseUrls: options.baseUrls,
      retry: options.retry,
      concurrency: options.concurrency,
      cache: unsafeStagedCache, // behind a verified signed link only
    } as WebflowCmsConfig<S>));

  async function exit(request: Request, redirectTo: boolean): Promise<Response> {
    await controls.disable();
    if (!redirectTo) return json(200, { ok: true, draft: false });
    // Not signed, so validated exactly like the entry path; anything else goes home.
    return redirect(request, safeRelativePath(new URL(request.url).searchParams.get("path")) ?? "/");
  }

  async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    if (params.has("disable")) return exit(request, true);

    const secrets = parseSecrets(options.secret ?? readEnv(ENV.previewSecret));
    if (secrets.length === 0) {
      logger.warn(`[next-webflow] Draft route: no preview secret. Set ${ENV.previewSecret}.`);
      return json(500, { ok: false, error: `Draft mode isn't configured: set ${ENV.previewSecret}.` });
    }
    if (!options.resolvePath) {
      return json(500, {
        ok: false,
        error:
          "Draft mode isn't configured: pass resolvePath to createDraftHandler, e.g. " +
          "createDraftHandler({ resolvePath: (collection, item) => `/blog/${item.fieldData.slug}` }).",
      });
    }

    const verification = await verifyPreviewParams(params, {
      secrets,
      now: deps.now?.(),
      maxLifetimeSeconds: options.maxLinkLifetimeSeconds,
    });
    if (!verification.ok) {
      const [status, error] = {
        malformed: [400, "Malformed preview link."],
        expired: [401, "This preview link has expired. Ask for a new one."],
        invalid: [401, "Invalid preview link signature."],
      }[verification.reason] as [number, string];
      return json(status, { ok: false, error });
    }

    let item: WebflowItem | null;
    try {
      item = (await (getCms() as WebflowCms<undefined>).getItem(
        verification.collection,
        verification.itemId,
      )) as WebflowItem | null;
    } catch (error) {
      if (error instanceof WebflowNotFoundError || error instanceof WebflowConfigError) {
        return json(404, { ok: false, error: `Collection "${verification.collection}" not found.` });
      }
      throw error;
    }
    if (!item) return json(404, { ok: false, error: "This item doesn't exist anymore." });

    const resolved = await options.resolvePath(verification.collection, item);
    const path = safeRelativePath(resolved);
    if (!path) {
      logger.warn(
        `[next-webflow] Draft route: resolvePath returned ${JSON.stringify(resolved)}, not a same-site path.`,
      );
      return json(500, { ok: false, error: "resolvePath must return a same-site path starting with /." });
    }

    await controls.enable();
    return redirect(request, path);
  }

  return { GET, DELETE: (request) => exit(request, false) };
}
