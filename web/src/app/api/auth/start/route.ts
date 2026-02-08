import { NextResponse } from "next/server";

import { getAuthUrlFromJson } from "@/lib/googleAuth";

type AuthStartBody = {
  credentialsJson?: string;
  credentialName?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AuthStartBody;
    const credentialsJson = (body.credentialsJson ?? "").trim();
    if (!credentialsJson) {
      return NextResponse.json({ error: "missing_credentials", message: "Missing credentials JSON." }, { status: 400 });
    }
    const payload = {
      credentialsJson,
      credentialName: body.credentialName ?? "",
    };
    const state = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const authUrl = getAuthUrlFromJson(credentialsJson, state);
    return NextResponse.json({ ok: true, authUrl });
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

