"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

const tabClass = (active: boolean) =>
  `inline-flex min-h-10 shrink-0 items-center border-b-2 py-2 text-sm font-medium transition-colors ${
    active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
  }`;

/** All / Featured / one tab per category. On narrow screens it scrolls, keeping the active tab in view. */
export function CategoryTabs({
  categories,
  categoryId,
  featured = false,
}: {
  categories: ReadonlyArray<{ id: string; name: string }>;
  categoryId?: string | undefined;
  featured?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const activeKey = featured ? "featured" : (categoryId ?? "all");

  useEffect(() => {
    const container = viewport.current;
    const active = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !active) return;
    const offset = active.getBoundingClientRect().left - container.getBoundingClientRect().left;
    const left = Math.max(
      0,
      Math.min(
        container.scrollWidth - container.clientWidth,
        container.scrollLeft + offset - (container.clientWidth - active.clientWidth) / 2,
      ),
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({ left, behavior: reducedMotion ? "auto" : "smooth" });
  }, [activeKey]);

  const tab = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
      {label}
    </Link>
  );

  return (
    <div
      ref={viewport}
      className="scrollbar-none mb-4 max-w-full overflow-x-auto overscroll-x-contain sm:overflow-visible"
    >
      <nav aria-label="Filter posts" className="flex w-max min-w-full flex-nowrap gap-x-5">
        {tab("/", "All", !categoryId && !featured)}
        {tab("/featured", "Featured", featured)}
        {categories.map((category) =>
          tab(`/category/${encodeURIComponent(category.id)}`, category.name, category.id === categoryId),
        )}
      </nav>
    </div>
  );
}
