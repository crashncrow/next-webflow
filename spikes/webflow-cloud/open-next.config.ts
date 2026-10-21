// Webflow Cloud generates `defineCloudflareConfig()` (dummy caches: no data cache, revalidateTag is a
// no-op) only when the app has no open-next.config.ts. This one backs the Next data cache with KV and
// the tag cache with D1, both provisioned by Webflow Cloud from the bindings in wrangler.json.
// No queue: it only serves time-based ISR, and Webflow Cloud doesn't document the service binding
// (WORKER_SELF_REFERENCE) or Durable Objects the queue overrides need.
// NOTE: the Webflow builder deletes this file after deploying; keep it committed (`npm run deploy`
// checks it exists).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: d1NextTagCache,
});
