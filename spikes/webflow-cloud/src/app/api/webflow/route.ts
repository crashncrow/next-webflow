import { createWebhookHandler } from "next-webflow/webhook";
import { logWebhook } from "@/lib/webhook-log";

// The library's handler, as a user would mount it. No `runtime` export (edge → 500 on Cloud).
const handler = createWebhookHandler({
  logger: { info: console.log, warn: console.warn, error: console.error },
});

// Spike only: record every request (raw body, status, timing) for the stage 4 E2E table.
export async function POST(request: Request): Promise<Response> {
  const receivedAt = new Date().toISOString();
  const rawBody = await request.clone().text();
  const response = await handler(request);
  let triggerType: string | null = null;
  try {
    triggerType = (JSON.parse(rawBody) as { triggerType?: string }).triggerType ?? null;
  } catch {
    // not JSON
  }
  await logWebhook({
    receivedAt,
    status: response.status,
    triggerType,
    signed: request.headers.has("x-webflow-signature"),
    response: await response.clone().text(),
    rawBody,
  }).catch((error: unknown) => console.error("webhook_log insert failed", error));
  return response;
}
