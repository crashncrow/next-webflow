// Webhook endpoint: `npx next-webflow webhooks register --url https://<your-site>/api/webflow`
// creates the webhooks and writes their secrets to WEBFLOW_WEBHOOK_SECRET.
// Don't export `runtime` from route handlers.
export { POST } from "next-webflow/webhook";
