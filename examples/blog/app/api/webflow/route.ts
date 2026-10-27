// Webhook endpoint: `npx next-webflow webhooks register --url https://<your-site>/api/webflow --token-env WEBFLOW_ADMIN_TOKEN`
// creates the webhooks and writes their secrets to WEBFLOW_WEBHOOK_SECRET.
// Don't export `runtime` from route handlers.
import { createWebhookHandler } from "next-webflow/webhook";
import { publicPreviews } from "@/lib/demo-previews";

// Staged edits only matter here for the demo's "Try draft preview" button (lib/demo-previews.ts).
// Without it, this is the same as `export { POST } from "next-webflow/webhook"`.
export const POST = createWebhookHandler({ invalidateOnStagedChanges: publicPreviews });
