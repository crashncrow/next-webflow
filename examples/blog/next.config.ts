import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    // Webflow's asset CDN: the only host CMS images come from.
    remotePatterns: [{ protocol: "https", hostname: "cdn.prod.website-files.com" }],
  },
};

export default config;
