import { NextResponse } from "next/server";

import { exchangeCodeAndStoreToken } from "@/lib/googleAuth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json(
      { error: "missing_code", message: "Missing ?code=..." },
      { status: 400 },
    );
  }

  const cookieCred = req.headers.get("cookie") ?? "";
  const match = cookieCred.match(/(?:^|; )google_cred=([^;]+)/);
  const cred = match ? decodeURIComponent(match[1]) : undefined;
  await exchangeCodeAndStoreToken(code, cred);
  const res = NextResponse.redirect(new URL("/", req.url));
  if (cred) {
    res.cookies.set("google_cred_active", cred, { httpOnly: false, sameSite: "lax", path: "/" });
  } else {
    res.cookies.set("google_cred_active", "", { httpOnly: false, sameSite: "lax", path: "/" });
  }
  return res;
}

