import { revalidateTag } from "next/cache";
import { checkSecret } from "@/lib/probe";

export async function POST(request: Request) {
  const { secret, tag } = (await request.json()) as { secret?: string; tag?: string };
  if (!checkSecret(secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    revalidateTag(tag ?? "spike-probe", { expire: 0 });
    return Response.json({ ok: true, runtime: "node", at: new Date().toISOString() });
  } catch (error) {
    return Response.json({ ok: false, runtime: "node", error: String(error) }, { status: 500 });
  }
}
