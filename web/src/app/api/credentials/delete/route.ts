import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { getTokenPathForCredential } from "@/lib/googleAuth";

export const runtime = "nodejs";

const CREDENTIALS_DIR = path.resolve(process.cwd(), "..", "credentials");

type DeleteBody = {
  file?: string;
};

export async function POST(req: Request) {
  try {
    let body: DeleteBody = {};
    try {
      body = (await req.json()) as DeleteBody;
    } catch {
      body = {};
    }

    const file = (body.file ?? "").trim();
    if (!file || !file.endsWith(".json")) {
      return NextResponse.json({ error: "invalid_file", message: "Invalid file name." }, { status: 400 });
    }

    const safeName = file.replace(/[^a-zA-Z0-9._-]/g, "_");
    const targetPath = path.join(CREDENTIALS_DIR, safeName);
    await fs.unlink(targetPath);

    const tokenPath = getTokenPathForCredential(safeName);
    try {
      await fs.unlink(tokenPath);
    } catch {
      // token might not exist
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
