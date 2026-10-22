const warned = new Set<string>();

/** `console.warn` once per key, only outside production builds. */
export function warnOnceInDev(key: string, message: string): void {
  if ((typeof process !== "undefined" && process.env.NODE_ENV === "production") || warned.has(key)) return;
  warned.add(key);
  console.warn(`[next-webflow] ${message}`);
}

/** Webflow's "inherit the asset's alt text" placeholder was replaced with `alt=""`. */
export function warnInheritedAlt(url: string, fix = "set it on the image itself in the CMS editor"): void {
  warnOnceInDev(
    `inherited-alt:${url}`,
    `Image ${url} inherits its alt text from the Webflow asset, which next-webflow doesn't resolve yet; ` +
      `rendering it as decorative (alt=""). To give it alt text, ${fix}.`,
  );
}
