"use client";

import { useEffect, useRef } from "react";
import { themeStorageKey } from "@/lib/theme";

type Theme = "light" | "dark";

/** Follows the system theme until the visitor picks one; the choice is kept in localStorage. */
export function ThemeToggle() {
  const preference = useRef<Theme | null>(null);

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    try {
      const saved = localStorage.getItem(themeStorageKey);
      preference.current = saved === "light" || saved === "dark" ? saved : null;
    } catch {
      // Storage unavailable (private mode): follow the system theme.
    }
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        preference.current ? preference.current === "dark" : system.matches,
      );
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, []);

  function toggle() {
    const dark = !document.documentElement.classList.contains("dark");
    preference.current = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(themeStorageKey, preference.current);
    } catch {
      // Storage unavailable: the choice lasts until the page is reloaded.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex size-10 items-center justify-center rounded-md border bg-background transition-colors hover:bg-muted"
      title="Switch color theme"
    >
      <svg
        className="size-[18px] dark:hidden"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
      </svg>
      <svg
        className="hidden size-[18px] dark:block"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </svg>
      <span className="sr-only">Switch color theme</span>
    </button>
  );
}
