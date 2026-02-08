import { NextResponse } from "next/server";
export const runtime = "nodejs";

type DeleteBody = {
  file?: string;
};

export async function POST(req: Request) {
  try {
    void req;
    return NextResponse.json(
      { error: "deprecated", message: "Credential deletion is handled in the browser now." },
      { status: 410 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
