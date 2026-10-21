import type { NextConfig } from "next";

// Keep minimal: Webflow Cloud sets basePath/assetPrefix and the Cloudflare adapter at build time.
const nextConfig: NextConfig = {
  // Webflow's asset CDN (the only host in the test site's real data). Webflow Cloud replaces the
  // image loader with its own; this matters for `next dev` / `next start`.
  images: { remotePatterns: [{ protocol: "https", hostname: "cdn.prod.website-files.com" }] },
};

export default nextConfig;
