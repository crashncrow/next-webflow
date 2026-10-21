import { probe } from "@/lib/probe";

// Webflow Cloud docs: API routes need the edge runtime. Compare with api/probe-node.
export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tag = new URL(request.url).searchParams.get("tag") ?? "spike-probe";
  return Response.json(await probe(tag, "route (edge)"));
}
