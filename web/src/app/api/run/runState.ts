import fs from "node:fs";
import path from "node:path";

export type RunProgress = {
  runId: string;
  spreadsheetId: string;
  settingsSheetName: string;
  leadsSheetName: string;
  startRow: number;
  endRow: number;
  rowNumbers: number[];
  currentIndex: number;
  processed: number;
  skipped: number;
  totalLeads: number;
  startedAt: string;
  finishedAt?: string;
  perRow: Array<{
    row: number;
    status: "skipped" | "succeeded" | "failed";
    message?: string;
    datasetUrl?: string;
    leads?: number;
  }>;
  headersAfterEnsure: string[];
  leadsHeaders: string[];
  existingUniqueIds: Set<string>;
  datasetCol: number;
  scrapedCol: number;
  statusCol: number;
  commentsCol: number;
  scrapeStatusCol: number;
  pushStatusCol: number;
  apifyTokenHeader: string;
  datasetUrlHeader: string;
};

export type RunState = {
  cancelRequested: boolean;
  activeRunId: string | null;
  activeToken: string | null;
  currentRun: RunProgress | null;
};

export const runState: RunState = {
  cancelRequested: false,
  activeRunId: null,
  activeToken: null,
  currentRun: null,
};

type PersistedRunProgress = Omit<RunProgress, "existingUniqueIds"> & { existingUniqueIds: string[] };
type PersistedRunState = Omit<RunState, "currentRun"> & { currentRun: PersistedRunProgress | null };

function getRunStatePath() {
  if (process.env.VERCEL) {
    return path.resolve("/tmp", ".run-state.json");
  }
  return path.resolve(process.cwd(), ".run-state.json");
}

function serializeRunProgress(run: RunProgress): PersistedRunProgress {
  return {
    ...run,
    existingUniqueIds: Array.from(run.existingUniqueIds),
  };
}

function deserializeRunProgress(run: PersistedRunProgress): RunProgress {
  return {
    ...run,
    existingUniqueIds: new Set(run.existingUniqueIds ?? []),
  };
}

export function saveRunStateToDisk(state: RunState) {
  const payload: PersistedRunState = {
    cancelRequested: state.cancelRequested,
    activeRunId: state.activeRunId,
    activeToken: state.activeToken,
    currentRun: state.currentRun ? serializeRunProgress(state.currentRun) : null,
  };
  fs.writeFileSync(getRunStatePath(), JSON.stringify(payload), "utf8");
}

export function loadRunStateFromDisk(): RunState | null {
  const filePath = getRunStatePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedRunState;
    return {
      cancelRequested: Boolean(parsed.cancelRequested),
      activeRunId: parsed.activeRunId ?? null,
      activeToken: parsed.activeToken ?? null,
      currentRun: parsed.currentRun ? deserializeRunProgress(parsed.currentRun) : null,
    };
  } catch {
    return null;
  }
}

export function clearRunStateOnDisk() {
  const filePath = getRunStatePath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
