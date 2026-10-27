import Link from "next/link";
import { Fragment } from "react";
import type { Author } from "@/webflow";

/** "Ada, Grace and Linus", each name linking to /authors/[slug]. Missing (`null`) authors are left out. */
export function AuthorLinks({ authors }: { authors: ReadonlyArray<Author | null | undefined> }) {
  // The main author can also be listed as a co-author: show each person once.
  const unique = [...new Map(authors.flatMap((author) => (author ? [[author.id, author] as const] : []))).values()];
  if (unique.length === 0) return null;

  let index = 0;
  const parts = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).formatToParts(
    unique.map((author) => author.fieldData.name),
  );
  return (
    <span className="text-foreground">
      {parts.map((part, i) => {
        const author = part.type === "element" ? unique[index++] : undefined;
        if (!author) return <Fragment key={i}>{part.value}</Fragment>;
        return (
          <Link
            key={author.id}
            href={`/authors/${author.fieldData.slug}`}
            className="hover:underline underline-offset-4"
          >
            {part.value}
          </Link>
        );
      })}
    </span>
  );
}
