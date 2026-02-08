import { NextResponse } from "next/server";
import { google, sheets_v4 } from "googleapis";

import { getAuthorizedGoogleAuthFromToken } from "@/lib/googleAuth";
import { DEFAULT_NICHE_SETTINGS_TAB, DEFAULT_SPREADSHEET_ID, appendRows, ensureHeader, getRow, setCell } from "@/lib/sheets";
import { getDatasetItems } from "@/lib/apify";

export const runtime = "nodejs";

type PushBody = {
  spreadsheetId?: string;
  settingsSheetName?: string;
  leadsSheetName?: string;
  rowNumber: number;
  datasetUrl: string;
  pushedHeader?: string;
  authToken?: Record<string, unknown>;
};

// header helpers are handled by ensureHeader

function toStringOrEmpty(v: unknown) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function toFirstUrl(v: unknown) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : "";
  return "";
}

function toJoinedLines(v: unknown, separator = "\n") {
  if (!v) return "";
  if (Array.isArray(v)) return v.map((x) => toStringOrEmpty(x)).filter(Boolean).join(separator);
  return toStringOrEmpty(v);
}

function normalizePhoneNumber(raw: unknown) {
  const str = toStringOrEmpty(raw);
  if (!str) return "";
  return str.replace(/[^\d]/g, "");
}

function normalizeWeekday(rawDay: string) {
  const cleaned = rawDay.trim().toLowerCase();
  const map: Record<string, string> = {
    monday: "Monday",
    mon: "Monday",
    tuesday: "Tuesday",
    tue: "Tuesday",
    tues: "Tuesday",
    wednesday: "Wednesday",
    wed: "Wednesday",
    thursday: "Thursday",
    thu: "Thursday",
    thurs: "Thursday",
    friday: "Friday",
    fri: "Friday",
    saturday: "Saturday",
    sat: "Saturday",
    sunday: "Sunday",
    sun: "Sunday",
  };
  return map[cleaned] ?? rawDay.trim();
}

function getMeridiem(raw: string) {
  const m = raw.match(/\b(am|pm)\b/i);
  return m ? m[1].toUpperCase() : "";
}

function normalizeTime(raw: string, fallbackMeridiem = "") {
  const cleaned = raw.replace(/\s+/g, " ").trim().toUpperCase();
  const m = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!m) return raw.trim();
  const hour = Number(m[1]);
  const minute = m[2] ?? "00";
  const meridiem = m[3] ?? fallbackMeridiem;
  if (!meridiem) return `${hour}:${minute} AM`;
  return minute === "00" ? `${hour} ${meridiem}` : `${hour}:${minute} ${meridiem}`;
}

function normalizeHoursRanges(rawHours: string) {
  const cleaned = rawHours.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (/^closed$/i.test(cleaned)) return "Closed";
  const ranges = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
  const formattedRanges = ranges
    .map((range) => {
      const parts = range.split(/\s+to\s+/i);
      if (parts.length !== 2) return normalizeTime(range);
      const startRaw = parts[0].trim();
      const endRaw = parts[1].trim();
      const end = normalizeTime(endRaw);
      const endMeridiem = getMeridiem(endRaw);
      const start = normalizeTime(startRaw, endMeridiem);
      return `${start} to ${end}`;
    })
    .filter(Boolean);
  return formattedRanges.join(", ");
}

function getItemField(item: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const v = item[k];
    if (v === undefined || v === null) continue;
    return v;
  }
  return undefined;
}

function toOpeningHoursText(item: Record<string, unknown>) {
  const v = getItemField(item, ["openingHours", "opening_hours", "openingHoursText", "openingHoursOpenDays"]);
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const formatted = v
      .map((x) => {
        if (!x || typeof x !== "object") return toStringOrEmpty(x);
        const obj = x as Record<string, unknown>;
        const rawDay = toStringOrEmpty(obj.day ?? obj.weekday ?? obj.name);
        const rawHours = toStringOrEmpty(obj.hours ?? obj.open ?? obj.time);
        if (!rawDay) return toStringOrEmpty(x);
        const day = normalizeWeekday(rawDay);
        const hours = normalizeHoursRanges(rawHours);
        return `${day} - ${hours || "Closed"}`;
      })
      .filter(Boolean);
    return formatted.join("\n");
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const weekdayText = obj.weekdayText;
    if (Array.isArray(weekdayText)) {
      return weekdayText.map((x) => toStringOrEmpty(x)).filter(Boolean).join("\n");
    }
  }
  return toStringOrEmpty(v);
}

function parseDatasetUrl(datasetUrl: string): { datasetId: string; token: string } | null {
  try {
    const url = new URL(datasetUrl);
    if (!url.pathname.includes("/datasets/")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const datasetIndex = parts.findIndex((p) => p === "datasets");
    if (datasetIndex === -1 || !parts[datasetIndex + 1]) return null;
    const datasetId = parts[datasetIndex + 1];
    const token = url.searchParams.get("token") ?? "";
    if (!datasetId || !token) return null;
    return { datasetId, token };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PushBody;
    const spreadsheetId = (body.spreadsheetId ?? DEFAULT_SPREADSHEET_ID).trim();
    const settingsSheetName = (body.settingsSheetName ?? DEFAULT_NICHE_SETTINGS_TAB).trim();
    const leadsSheetName = (body.leadsSheetName ?? "").trim();
    const pushedHeader = (body.pushedHeader ?? "Pushed").trim();

    if (!body.rowNumber || !body.datasetUrl || !leadsSheetName) {
      return NextResponse.json(
        { error: "missing_fields", message: "rowNumber, datasetUrl, and leadsSheetName are required." },
        { status: 400 },
      );
    }

    const parsed = parseDatasetUrl(body.datasetUrl);
    if (!parsed) {
      return NextResponse.json({ error: "invalid_dataset_url", message: "Dataset URL is invalid." }, { status: 400 });
    }

    if (!body.authToken || typeof body.authToken !== "object") {
      return NextResponse.json(
        { error: "not_authorized", message: "Authorize Google Sheets access first." },
        { status: 401 },
      );
    }
    const auth = getAuthorizedGoogleAuthFromToken(body.authToken);
    const sheets: sheets_v4.Sheets = google.sheets({ version: "v4", auth });
    const leadsHeaders = await getRow(sheets, spreadsheetId, leadsSheetName, 1);
    if (!leadsHeaders.length) {
      return NextResponse.json(
        { error: "missing_leads_headers", message: `Leads tab '${leadsSheetName}' has no header row.` },
        { status: 400 },
      );
    }

    const items = await getDatasetItems({ token: parsed.token, datasetId: parsed.datasetId });
    const nowStr = new Date().toLocaleString("en-AU");
    const leadRows: string[][] = items
      .map((item) => {
        const uniqueId = toStringOrEmpty(getItemField(item, ["placeId", "place_id", "id", "placeID"])).trim();
        return leadsHeaders.map((h) => {
          const header = (h ?? "").trim();
          if (!header) return "";
          switch (header) {
            case "Unique ID":
              return uniqueId;
            case "Business Name":
              return toStringOrEmpty(getItemField(item, ["title", "name"]));
            case "Opening Hours":
              return toOpeningHoursText(item);
            case "Comments":
              return "";
            case "Phone Number":
              return normalizePhoneNumber(getItemField(item, ["phone", "phoneNumber"]));
            case "Other Phones": {
              const phones = getItemField(item, ["phones", "phoneNumbers", "otherPhones"]);
              if (Array.isArray(phones)) return phones.map(normalizePhoneNumber).filter(Boolean).join(" | ");
              return normalizePhoneNumber(phones);
            }
            case "Email": {
              const emails = getItemField(item, ["emails", "email"]);
              if (Array.isArray(emails)) return toStringOrEmpty(emails[0]);
              return toStringOrEmpty(emails);
            }
            case "Other Emails": {
              const emails = getItemField(item, ["emails"]);
              if (Array.isArray(emails)) return emails.slice(1).map(toStringOrEmpty).filter(Boolean).join("\n");
              return "";
            }
            case "Website URL":
              return toStringOrEmpty(getItemField(item, ["website", "web", "domain"]));
            case "Address Street":
              return toStringOrEmpty(getItemField(item, ["street", "streetAddress", "address"]));
            case "Address City":
              return toStringOrEmpty(getItemField(item, ["city", "municipality"]));
            case "Address State":
              return toStringOrEmpty(getItemField(item, ["state", "region", "county"]));
            case "Address Postcode":
              return toStringOrEmpty(getItemField(item, ["postalCode", "zipCode", "postcode"]));
            case "Address Country":
              return toStringOrEmpty(getItemField(item, ["country", "countryCode"]));
            case "Facebook URL":
              return toFirstUrl(getItemField(item, ["facebook", "facebooks"]));
            case "LinkedIn URL":
              return toFirstUrl(getItemField(item, ["linkedIn", "linkedIns", "linkedin", "linkedins"]));
            case "Twitter URL":
              return toFirstUrl(getItemField(item, ["twitter", "twitters"]));
            case "Instagram URL":
              return toFirstUrl(getItemField(item, ["instagram", "instagrams"]));
            case "Youtube URL":
              return toFirstUrl(getItemField(item, ["youtube", "youtubes"]));
            case "Tiktok URL":
              return toFirstUrl(getItemField(item, ["tiktok", "tiktoks"]));
            case "Pinterest URL":
              return toFirstUrl(getItemField(item, ["pinterest", "pinterests"]));
            case "Discord URL":
              return toFirstUrl(getItemField(item, ["discord", "discords"]));
            case "Google My Business URL":
              return toStringOrEmpty(getItemField(item, ["placeUrl", "googleBusinessUrl", "gmbUrl"]));
            case "Google Maps URL":
              return toStringOrEmpty(getItemField(item, ["url", "googleMapsUrl", "mapsUrl"]));
            case "Search Word":
              return toStringOrEmpty(getItemField(item, ["searchString", "searchTerm", "keyword"]));
            case "Date First Added":
              return nowStr;
            default:
              return "";
          }
        });
      })
      .filter((row): row is string[] => Array.isArray(row));

    if (leadRows.length) {
      await appendRows(sheets, spreadsheetId, leadsSheetName, leadRows);
    }

    const pushedCol = await ensureHeader(sheets, spreadsheetId, settingsSheetName, pushedHeader);
    if (pushedCol > 0) {
      await setCell(sheets, spreadsheetId, settingsSheetName, body.rowNumber, pushedCol, "Y");
    }

    return NextResponse.json({ ok: true, appended: leadRows.length });
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
