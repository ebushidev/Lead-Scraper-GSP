import { NextResponse } from "next/server";
import { google } from "googleapis";

import { DEFAULT_NICHE_SETTINGS_TAB, DEFAULT_SPREADSHEET_ID, getRow, getRows } from "@/lib/sheets";
import { getAuthorizedGoogleAuthFromToken } from "@/lib/googleAuth";

export const runtime = "nodejs";

type SettingsRowsBody = {
  spreadsheetId?: string;
  sheetName?: string;
  maxLimitHeader?: string;
  datasetUrlHeader?: string;
  pushedHeader?: string;
  pushStatusHeader?: string;
  authToken?: Record<string, unknown>;
};

function findHeaderIndexCaseInsensitive(headers: string[], headerName: string) {
  const want = headerName.trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if ((headers[i] ?? "").trim().toLowerCase() === want) return i; // 0-based
  }
  return -1;
}

export async function POST(req: Request) {
  try {
    let body: SettingsRowsBody = {};
    try {
      body = (await req.json()) as SettingsRowsBody;
    } catch {
      body = {};
    }

    const authToken = body.authToken;
    if (!authToken || typeof authToken !== "object") {
      return NextResponse.json(
        { error: "not_authorized", message: "Authorize Google Sheets access first." },
        { status: 401 },
      );
    }
    const auth = getAuthorizedGoogleAuthFromToken(authToken as Record<string, unknown>);

    const spreadsheetId = (body.spreadsheetId ?? DEFAULT_SPREADSHEET_ID).trim();
    const sheetName = (body.sheetName ?? DEFAULT_NICHE_SETTINGS_TAB).trim();
    const maxLimitHeader = (body.maxLimitHeader ?? "Max Limit").trim();
    const datasetUrlHeader = (body.datasetUrlHeader ?? "Dataset URL").trim();
    const pushedHeader = (body.pushedHeader ?? "Pushed").trim();
    const pushStatusHeader = (body.pushStatusHeader ?? "Google-Maps Push Status").trim();

    const sheets = google.sheets({ version: "v4", auth });
    const headers = await getRow(sheets, spreadsheetId, sheetName, 1);
    if (!headers.length) {
      return NextResponse.json({ ok: true, rows: [], headers: {} });
    }

    const maxLimitIdx = findHeaderIndexCaseInsensitive(headers, maxLimitHeader);
    const datasetUrlIdx = findHeaderIndexCaseInsensitive(headers, datasetUrlHeader);
    const pushedIdx = findHeaderIndexCaseInsensitive(headers, pushedHeader);
    const pushStatusIdx = findHeaderIndexCaseInsensitive(headers, pushStatusHeader);

    const values = await getRows(sheets, spreadsheetId, sheetName, 2, 500);
    const rows = values.map((rowValues, i) => {
      const rowNumber = 2 + i;
      const datasetUrl = datasetUrlIdx >= 0 ? (rowValues?.[datasetUrlIdx] ?? "").toString().trim() : "";
      const maxLimit = maxLimitIdx >= 0 ? (rowValues?.[maxLimitIdx] ?? "").toString().trim() : "";
      const pushed = pushedIdx >= 0 ? (rowValues?.[pushedIdx] ?? "").toString().trim().toUpperCase() : "";
      const pushStatus = pushStatusIdx >= 0 ? (rowValues?.[pushStatusIdx] ?? "").toString().trim() : "";
      return {
        rowNumber,
        datasetUrl,
        maxLimit,
        pushed: pushed === "Y",
        pushStatus,
      };
    });

    return NextResponse.json({
      ok: true,
      rows,
      headers: {
        maxLimitHeader,
        datasetUrlHeader,
        pushedHeader,
        pushStatusHeader,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
