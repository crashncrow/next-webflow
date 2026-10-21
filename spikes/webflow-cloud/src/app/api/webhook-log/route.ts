import { checkSecret } from "@/lib/probe";
import { readWebhookLog } from "@/lib/webhook-log";

// Spike only: read the webhook log. Secret in a header, never in the URL.
export async function GET(request: Request): Promise<Response> {
  if (!checkSecret(request.headers.get("x-spike-secret"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
  return Response.json({ rows: await readWebhookLog(Number.isFinite(since) ? since : 0) });
}
