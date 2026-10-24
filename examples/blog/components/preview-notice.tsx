import { DraftModeBanner } from "next-webflow/components";

/** Renders only in draft mode: says the page shows unpublished content, with "Exit preview". */
export function PreviewNotice() {
  return (
    <DraftModeBanner
      className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted p-4 text-sm"
      exitClassName="font-medium underline underline-offset-4"
    />
  );
}
