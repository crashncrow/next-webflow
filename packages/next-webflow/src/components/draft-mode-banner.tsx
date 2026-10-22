import { draftMode } from "next/headers.js";
import type { CSSProperties, ReactNode } from "react";
import { nextBasePath } from "../next/base-path";
// Its own entry so the "use client" directive survives bundling (rolldown drops it in shared chunks).
import { ExitPreviewLink } from "next-webflow/components/client";

export interface DraftModeBannerProps {
  /** Your draft route (`createDraftHandler`), without the base path. Default `/api/webflow/draft`. */
  route?: string | undefined;
  /** Base path for the exit link. Default: `NEXT_PUBLIC_BASE_PATH`, then the one Next.js inlines. */
  basePath?: string | undefined;
  children?: ReactNode;
  exitLabel?: ReactNode;
  /** Replaces the default inline styles. */
  className?: string | undefined;
  exitClassName?: string | undefined;
}

const defaultStyle: CSSProperties = {
  position: "fixed",
  insetInline: 0,
  bottom: 0,
  zIndex: 2147483647,
  display: "flex",
  justifyContent: "center",
  gap: "1rem",
  padding: "0.5rem 1rem",
  font: "14px/1.4 system-ui, sans-serif",
  background: "#1a1a1a",
  color: "#fff",
};

/**
 * Shown only in draft mode: says the page shows unpublished content and links to leave preview
 * (the draft route's `?disable=1&path=<current page>`). Renders nothing otherwise.
 */
export async function DraftModeBanner({
  route = "/api/webflow/draft",
  basePath,
  children = "Preview: you're seeing unpublished content.",
  exitLabel = "Exit preview",
  className,
  exitClassName,
}: DraftModeBannerProps): Promise<ReactNode> {
  let enabled = false;
  try {
    enabled = (await draftMode()).isEnabled;
  } catch {
    // Outside a request (generateStaticParams, scripts): never draft.
  }
  if (!enabled) return null;
  const href = `${(basePath ?? nextBasePath() ?? "").replace(/\/$/, "")}${route}`;
  return (
    <div
      role="status"
      data-next-webflow-draft-banner=""
      className={className}
      style={className ? undefined : defaultStyle}
    >
      <span>{children}</span>
      <ExitPreviewLink href={href} className={exitClassName}>
        {exitLabel}
      </ExitPreviewLink>
    </div>
  );
}
