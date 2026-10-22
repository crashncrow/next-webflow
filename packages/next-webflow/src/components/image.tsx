import NextImage, { type ImageProps } from "next/image.js";
import type { ReactNode } from "react";
import type { WebflowImageValue } from "../core/schema";
import { isInheritedAlt } from "../core/alt";
import { warnInheritedAlt, warnOnceInDev } from "./dev-warnings";

type BaseProps = Omit<ImageProps, "src" | "alt" | "width" | "height" | "fill"> & {
  /** An `Image` field value (or one item of a `MultiImage`). Nothing renders without it. */
  image: WebflowImageValue | null | undefined;
  /** Overrides the field's alt text. Webflow's `alt: null` becomes `""` (decorative) otherwise. */
  alt?: string | undefined;
};

/** Webflow doesn't report image dimensions: pass `width` and `height`, or `fill` (sized parent). */
export type WebflowImageProps =
  | (BaseProps & { width: number | `${number}`; height: number | `${number}`; fill?: false | undefined })
  | (BaseProps & { fill: true; width?: undefined; height?: undefined });

/**
 * `next/image` for Webflow Image fields. Add Webflow's CDN to `images.remotePatterns`
 * (README). Webflow's CDN doesn't resize images; Next.js' optimizer does where it runs.
 */
export function WebflowImage({ image, alt, ...props }: WebflowImageProps): ReactNode {
  if (!image?.url) return null;
  // Raw items (`{ raw: true }`) can still hold Webflow's inherit placeholder; normalized ones can't.
  const inherited = isInheritedAlt(image.alt);
  const text = alt ?? (inherited ? "" : image.alt) ?? "";
  if (alt === undefined && inherited) {
    warnInheritedAlt(image.url);
  } else if (alt === undefined && !image.alt) {
    warnOnceInDev(
      `alt:${image.fileId ?? image.url}`,
      `Image ${image.url} has no alt text in Webflow; rendering it as decorative (alt=""). ` +
        "Add alt text in the CMS, or pass alt to <WebflowImage>.",
    );
  }
  return <NextImage src={image.url} alt={text} {...(props as Omit<ImageProps, "src" | "alt">)} />;
}
