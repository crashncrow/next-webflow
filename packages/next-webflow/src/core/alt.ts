/**
 * Alt text Webflow writes when an image should inherit the asset's alt text (undocumented; seen in
 * Rich Text images without their own alt, 2026-10-21). Never render it: it isn't alt text.
 */
export const INHERIT_ASSET_ALT = "__wf_reserved_inherit";

export const isInheritedAlt = (alt: unknown): alt is typeof INHERIT_ASSET_ALT => alt === INHERIT_ASSET_ALT;
