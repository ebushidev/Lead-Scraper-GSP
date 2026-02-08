import { NextResponse } from "next/server";

import { exchangeCodeForTokenWithJson } from "@/lib/googleAuth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json(
      { error: "missing_code", message: "Missing ?code=..." },
      { status: 400 },
    );
  }
  const state = searchParams.get("state");
  if (!state) {
    return NextResponse.json({ error: "missing_state", message: "Missing state." }, { status: 400 });
  }
  let payload: { credentialsJson: string; credentialName?: string };
  try {
    payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      credentialsJson: string;
      credentialName?: string;
    };
  } catch {
    return NextResponse.json({ error: "invalid_state", message: "Invalid state." }, { status: 400 });
  }
  const tokens = await exchangeCodeForTokenWithJson(code, payload.credentialsJson);
  const credentialName = payload.credentialName ?? "";
  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>OAuth Complete</title></head>
  <body>
    <script>
      (function() {
        try {
          var name = ${JSON.stringify(credentialName)};
          var tokens = ${JSON.stringify(tokens)};
          if (name) {
            localStorage.setItem("leadScraperActiveCredential", name);
            localStorage.setItem("leadScraperToken:" + name, JSON.stringify(tokens));
          }
        } catch (e) {}
        window.location.href = "/";
      })();
    </script>
  </body>
</html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html" } });
}

