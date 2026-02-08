import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const CREDENTIALS_DIR = path.resolve(process.cwd(), "..", "credentials");

export async function GET() {
  try {
    let files: string[] = [];
    try {
      const entries = await fs.readdir(CREDENTIALS_DIR, { withFileTypes: true });
      files = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
    } catch {
      files = [];
    }

    return NextResponse.json({ ok: true, files });
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
