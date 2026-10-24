import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { themeInitScript } from "@/lib/theme";
import banner from "@/public/webflow-next-banner.webp";
import "./globals.css";

const title = "Webflow CMS + Next.js | next-webflow example";
const description =
  "Webflow CMS content rendered with Next.js using next-webflow: typed reads, Rich Text, media, references and draft previews.";

export const metadata: Metadata = {
  // Social images need absolute URLs. On Vercel, Next.js uses the deployment URL by itself;
  // elsewhere, set NEXT_PUBLIC_SITE_URL (e.g. https://blog.example.com).
  ...(process.env.NEXT_PUBLIC_SITE_URL ? { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL) } : {}),
  title: { default: title, template: "%s | next-webflow example" },
  description,
  openGraph: {
    type: "website",
    siteName: "next-webflow example",
    title,
    description,
    images: [{ url: banner.src, width: banner.width, height: banner.height, alt: "Webflow + Next.js" }],
  },
  twitter: { card: "summary_large_image", title, description, images: [banner.src] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets `class="dark"` before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:p-3 focus:text-background"
        >
          Skip to content
        </a>
        <header className="shell flex items-center justify-between gap-4 pt-4">
          <Link href="/" className="inline-flex min-h-10 items-center text-xl font-semibold tracking-tight">
            next-webflow
          </Link>
          <ThemeToggle />
        </header>
        {children}
        <footer className="shell mt-16 flex flex-wrap items-end justify-between gap-3 border-t py-6 text-xs text-muted-foreground">
          <p>
            <a href="https://github.com/crashncrow/next-webflow" className="hover:text-foreground">
              next-webflow
            </a>
            {" by "}
            <a href="https://nnaro.dev" className="hover:text-foreground" target="_blank" rel="noopener noreferrer">
              nnaro.dev
            </a>
          </p>
          <p>
            {/* A plain-text summary of the site for AI agents (public/llms.txt). */}
            <a
              href="/llms.txt"
              title="View as Agent"
              className="inline-flex items-center gap-1 hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                className="relative top-0.5 size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 8V4H8" />
                <rect x="4" y="8" width="16" height="12" rx="3" />
                <path d="M9 13h.01M15 13h.01M9 17h6" />
              </svg>
              <span className="sr-only">View as Agent</span>
            </a>
            <span className="mx-3 h-3.5 border-l border-border" aria-hidden="true" />
            <a
              href="https://github.com/crashncrow/next-webflow"
              title="next-webflow on GitHub"
              className="inline-flex items-center gap-1 hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg className="relative top-0.5 size-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <span className="sr-only">next-webflow on GitHub</span>
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
