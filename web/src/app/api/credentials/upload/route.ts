import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const CREDENTIALS_DIR = path.resolve(process.cwd(), "..", "credentials");

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "missing_file", message: "Upload a JSON file." }, { status: 400 });
    }

    const originalName = file.name ?? "credentials.json";
    if (!originalName.endsWith(".json")) {
      return NextResponse.json({ error: "invalid_file", message: "Only .json files are allowed." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const content = Buffer.from(arrayBuffer).toString("utf8");
    try {
      JSON.parse(content);
    } catch {
      return NextResponse.json({ error: "invalid_json", message: "Invalid JSON file." }, { status: 400 });
    }

    await fs.mkdir(CREDENTIALS_DIR, { recursive: true });
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const targetPath = path.join(CREDENTIALS_DIR, safeName);
    await fs.writeFile(targetPath, content, "utf8");

    return NextResponse.json({ ok: true, file: safeName });
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
