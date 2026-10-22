import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Minimal D1 surface used here (avoids depending on workers-types). */
interface D1 {
  prepare(query: string): {
    bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
  };
}

// Same D1 database as the OpenNext tag cache (migrations/0002_webhook_log.sql).
async function db(): Promise<D1 | undefined> {
  const { env } = await getCloudflareContext({ async: true });
  return (env as unknown as Record<string, D1 | undefined>).NEXT_TAG_CACHE_D1;
}

export interface WebhookLogRow {
  id: number;
  received_at: string;
  status: number;
  trigger_type: string | null;
  signed: number;
  response: string;
  raw_body: string;
  duration_ms: number | null;
}

export async function logWebhook(entry: {
  receivedAt: string;
  status: number;
  triggerType: string | null;
  signed: boolean;
  response: string;
  rawBody: string;
  durationMs: number;
}): Promise<void> {
  const database = await db();
  if (!database) return;
  await database
    .prepare(
      "INSERT INTO webhook_log (received_at, status, trigger_type, signed, response, raw_body, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      entry.receivedAt,
      entry.status,
      entry.triggerType,
      entry.signed ? 1 : 0,
      entry.response,
      entry.rawBody,
      entry.durationMs,
    )
    .run();
}

export async function readWebhookLog(sinceId: number): Promise<WebhookLogRow[]> {
  const database = await db();
  if (!database) return [];
  const { results } = await database
    .prepare("SELECT * FROM webhook_log WHERE id > ? ORDER BY id LIMIT 200")
    .bind(sinceId)
    .all<WebhookLogRow>();
  return results;
}
