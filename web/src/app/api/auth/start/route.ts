import { NextResponse } from "next/server";

import { getAuthUrl } from "@/lib/googleAuth";

export async function GET(req: Request) {
  const urlObj = new URL(req.url);
  const cred = urlObj.searchParams.get("cred")?.trim() || undefined;
  const url = getAuthUrl(cred);
  const res = NextResponse.redirect(url);
  if (cred) {
    res.cookies.set("google_cred", cred, { httpOnly: true, sameSite: "lax", path: "/" });
  }
  return res;
}

