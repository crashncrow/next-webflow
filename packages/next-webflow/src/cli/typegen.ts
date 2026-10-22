// `next-webflow typegen`: fetches the site's collection schemas and writes `<out>/schema.ts`
// (always regenerated) and `<out>/index.ts` (created once, then owned by the user).
import { join } from "node:path";
import { WebflowConfigError, WebflowForbiddenError, WebflowUnauthorizedError } from "../core/errors";
import type { ApiCollection } from "../core/normalize";
import {
  INDEX_FILE,
  SCHEMA_FILE,
  generateIndexFile,
  generateSchemaFile,
  importsGeneratedSchema,
  readSchemaHash,
  type GenerateOptions,
} from "../typegen/generate";
import type { CommandContext } from "./webhooks";

export const DEFAULT_OUT_DIR = "webflow";

export interface TypegenOptions extends GenerateOptions {
  /** Output folder (default `webflow`). */
  out?: string;
  /** Don't write; fail (exit 1) if `schema.ts` is missing or differs. For CI. */
  check?: boolean;
  /** Recreate `index.ts` even if it exists. */
  force?: boolean;
}

/** Every collection of the site with its fields (`GET /sites/{id}/collections` + `GET /collections/{id}` each). */
export async function fetchCollections(context: CommandContext): Promise<ApiCollection[]> {
  try {
    const { collections } = await context.client.request<{ collections: ApiCollection[] }>(
      `/sites/${encodeURIComponent(context.siteId)}/collections`,
    );
    // The client's concurrency limit applies (default 4).
    return await Promise.all(
      collections.map((collection) =>
        context.client.request<ApiCollection>(`/collections/${encodeURIComponent(collection.id)}`),
      ),
    );
  } catch (error) {
    if (error instanceof WebflowUnauthorizedError || error instanceof WebflowForbiddenError) {
      throw new WebflowConfigError(
        `Webflow refused to read the site's collections (${error.status}${error.code ? ` ${error.code}` : ""}) ` +
          `with the token in ${context.tokenEnv}. typegen needs a site token with **CMS: Read** ` +
          "(the same read-only token your app uses is enough).",
      );
    }
    throw error;
  }
}

/** Returns the exit code: 1 when `--check` finds the schema out of date. */
export async function runTypegen(context: CommandContext, options: TypegenOptions = {}): Promise<number> {
  const { io } = context;
  const out = options.out ?? DEFAULT_OUT_DIR;
  const schemaPath = join(out, SCHEMA_FILE);
  const indexPath = join(out, INDEX_FILE);

  const collections = await fetchCollections(context);
  const { source, warnings } = generateSchemaFile(collections, options);
  for (const warning of warnings) io.warn(warning);
  const current = io.readFile(schemaPath);

  if (options.check) {
    if (current === source) {
      io.log(`✔ ${schemaPath} is up to date (${collections.length} collections).`);
      return 0;
    }
    if (current !== undefined && readSchemaHash(current) === readSchemaHash(source)) {
      io.log(`✔ ${schemaPath} is up to date (reformatted; same schema hash).`);
      return 0;
    }
    io.warn(
      current === undefined
        ? `${schemaPath} doesn't exist.`
        : `${schemaPath} is out of date:\n${describeDiff(current, source)}`,
    );
    io.warn("Run `npx next-webflow typegen` and commit the result.");
    return 1;
  }

  if (current === source) io.log(`✔ ${schemaPath} unchanged (${collections.length} collections).`);
  else {
    io.writeFile(schemaPath, source);
    io.log(`✔ Wrote ${schemaPath} (${collections.length} collections).`);
  }

  const index = io.readFile(indexPath);
  if (index === undefined || options.force) {
    io.writeFile(indexPath, generateIndexFile(options));
    io.log(`✔ ${index === undefined ? "Created" : "Recreated"} ${indexPath}.`);
  } else {
    io.log(`• ${indexPath} left untouched (it's yours; --force recreates it).`);
    if (!importsGeneratedSchema(index)) {
      io.warn(`${indexPath} doesn't import "./schema": your types won't follow the generated schema.`);
    }
  }
  return 0;
}

/** Lines only in the old file (-) and only in the new one (+), in order. Enough to see what changed. */
function describeDiff(before: string, after: string, max = 20): string {
  const beforeLines = new Set(before.split("\n"));
  const afterLines = new Set(after.split("\n"));
  const lines = [
    ...before
      .split("\n")
      .filter((line) => !afterLines.has(line))
      .map((line) => `- ${line.trim()}`),
    ...after
      .split("\n")
      .filter((line) => !beforeLines.has(line))
      .map((line) => `+ ${line.trim()}`),
  ];
  const shown = lines.slice(0, max).map((line) => `  ${line}`);
  if (lines.length > max) shown.push(`  … ${lines.length - max} more`);
  return shown.join("\n");
}
