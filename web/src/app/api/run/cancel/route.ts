import { NextResponse } from "next/server";

import { abortActorRun } from "@/lib/apify";
import { loadRunStateFromDisk, runState, saveRunStateToDisk } from "../runState";

export const runtime = "nodejs";

export async function POST() {
  try {
    const persisted = loadRunStateFromDisk();
    if (persisted) {
      runState.cancelRequested = persisted.cancelRequested;
      runState.activeRunId = persisted.activeRunId;
      runState.activeToken = persisted.activeToken;
      runState.currentRun = persisted.currentRun;
    }

    // These are module-level variables in the run route.
    runState.cancelRequested = true;
    const activeRunId = runState.activeRunId;
    const activeToken = runState.activeToken;

    if (activeRunId && activeToken) {
      await abortActorRun({ token: activeToken, runId: activeRunId });
    }

    saveRunStateToDisk(runState);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
