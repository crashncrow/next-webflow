"use client";
// Client only to read the current path. A plain <a>, never next/link: prefetching the exit URL
// would call the draft route and leave preview by itself.
import { usePathname } from "next/navigation.js";
import type { ReactNode } from "react";

export function ExitPreviewLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  const pathname = usePathname() ?? "/";
  const separator = href.includes("?") ? "&" : "?";
  return (
    <a href={`${href}${separator}disable=1&path=${encodeURIComponent(pathname)}`} className={className} rel="nofollow">
      {children}
    </a>
  );
}
