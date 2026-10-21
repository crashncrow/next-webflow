// proxy.ts (Next 16; on Next 15 name it middleware.ts and the function `middleware`)
import { NextResponse, type NextRequest } from "next/server";
import { requireBasicAuth } from "next-webflow/draft";

export const config = { matcher: ["/drafts", "/drafts/:path*"] };

export async function proxy(request: NextRequest) {
  const denied = await requireBasicAuth(request, { password: process.env.DRAFTS_PASSWORD, realm: "Drafts" });
  return denied ?? NextResponse.next();
}
