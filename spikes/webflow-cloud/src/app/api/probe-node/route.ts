import { probe } from "@/lib/probe";

// Default (nodejs) runtime, to compare with the edge route.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tag = new URL(request.url).searchParams.get("tag") ?? "spike-probe";
  return Response.json(await probe(tag, "route (node)"));
}
