import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(
      { error: "deprecated", message: "Credential listing is handled in the browser now." },
      { status: 410 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
