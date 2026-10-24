// DEMO ONLY (see lib/demo-previews.ts): turns "Try draft preview" into a signed preview link
// and hands it to the draft route, which enables draft mode. Off unless DEMO_PUBLIC_PREVIEWS=true.
// Don't export `runtime`.
import { createPreviewUrl } from "next-webflow/draft";
import { publicPreviews } from "@/lib/demo-previews";

export async function GET(request: Request) {
  if (!publicPreviews) return new Response("Not found", { status: 404 });
  const itemId = new URL(request.url).searchParams.get("item");
  if (!itemId || !/^[0-9a-f]{24}$/.test(itemId)) return new Response("Bad request", { status: 400 });

  const link = await createPreviewUrl({ url: "/api/webflow/draft", collection: "posts", itemId });
  return Response.redirect(new URL(link, request.url), 307);
}
