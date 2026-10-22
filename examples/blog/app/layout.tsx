import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DraftModeBanner } from "next-webflow/components";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Blog", template: "%s · Blog" },
  description: "A Next.js blog whose content lives in the Webflow CMS (next-webflow example).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/">Blog</Link>
        </header>
        <main className="container">{children}</main>
        {/* Renders only in draft mode: a bar with "Exit preview". */}
        <DraftModeBanner />
      </body>
    </html>
  );
}
