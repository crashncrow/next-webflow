import type { WebflowItem } from "next-webflow";
import { hasEmptyCodeBlock } from "@/lib/format";

const paths = {
  text: "M4 5h16M4 10h10M4 15h16M4 20h10",
  video: "M4 4h16v16H4zM10 8l6 4-6 4z",
  code: "M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16",
  attachment: "M21 11.5l-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5",
  contact: "M3 5h18v14H3zM3 5l9 7 9-7",
  references: "M3 3h6v6H3zM15 15h6v6h-6zM6 9v9h9M15 3h6v6h-6zM9 6h6",
  images: "M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4M16 8h.01",
  embed: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zM9 3v15M15 6v15",
};

type PostFields = {
  body: string;
  video?: unknown;
  attachment?: unknown;
  website?: string;
  contactEmail?: string;
  phone?: string;
  coAuthors: readonly unknown[];
};

/** Picks an icon from the fields a post uses (never from its slug, so it works with any site). */
function iconFor(fields: PostFields): keyof typeof paths {
  if (fields.video) return "video";
  if (hasEmptyCodeBlock(fields.body)) return "code";
  if (fields.attachment) return "attachment";
  if (fields.website || fields.contactEmail || fields.phone) return "contact";
  if (fields.coAuthors.length > 0) return "references";
  // Rich Text with images, or embedded content (maps, players: iframes).
  if (/<img\b/i.test(fields.body)) return "images";
  if (/<iframe\b/i.test(fields.body)) return "embed";
  return "text";
}

/** Shown in the list when a post has no image. */
export function PostIcon({ post }: { post: WebflowItem<PostFields> }) {
  return (
    <svg
      className="size-5 text-muted-foreground"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[iconFor(post.fieldData)]} />
    </svg>
  );
}
