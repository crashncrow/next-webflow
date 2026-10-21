import { revalidateTag } from "next/cache";
import { checkSecret } from "@/lib/probe";

export const runtime = "edge";

export async function POST(request: Request) {
  const { secret, tag } = (await request.json()) as { secret?: string; tag?: string };
  if (!checkSecret(secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    revalidateTag(tag ?? "spike-probe", { expire: 0 });
    return Response.json({ ok: true, runtime: "edge", at: new Date().toISOString() });
  } catch (error) {
    return Response.json({ ok: false, runtime: "edge", error: String(error) }, { status: 500 });
  }
}
