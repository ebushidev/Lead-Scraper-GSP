"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faBolt,
  faKey,
  faPlay,
  faRotate,
  faStop,
  faTable,
  faTrash,
  faUpload,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

type RunResult =
  | {
      ok: true;
      runId?: string;
      done?: boolean;
      settingsSheetName?: string;
      leadsSheetName?: string;
      startRow: number;
      endRow: number;
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
    }
  | { error: string; message?: string; authUrl?: string };

type TabsResult =
  | { ok: true; spreadsheetId: string; tabs: { title: string; sheetId: number; dataRowCount: number }[] }
  | { error: string; message?: string; authUrl?: string };

type ScrapedRowsResult =
  | { ok: true; rows: number[] }
  | { error: string; message?: string; authUrl?: string };

type SettingsRowsResult =
  | {
      ok: true;
      rows: Array<{
        rowNumber: number;
        datasetUrl: string;
        maxLimit: string;
        pushed: boolean;
        pushStatus: string;
      }>;
    }
  | { error: string; message?: string; authUrl?: string };

type CredentialsListResult =
  | { ok: true; files: string[] }
  | { error: string; message?: string };

function isOkTabsResult(r: TabsResult): r is Extract<TabsResult, { ok: true }> {
  return (r as { ok?: boolean }).ok === true;
}

function isOkResult(r: RunResult): r is Extract<RunResult, { ok: true }> {
  return (r as { ok?: boolean }).ok === true;
}

function isOkScrapedRowsResult(r: ScrapedRowsResult): r is Extract<ScrapedRowsResult, { ok: true }> {
  return (r as { ok?: boolean }).ok === true;
}

function isOkSettingsRowsResult(r: SettingsRowsResult): r is Extract<SettingsRowsResult, { ok: true }> {
  return (r as { ok?: boolean }).ok === true;
}

function isOkCredentialsListResult(r: CredentialsListResult): r is Extract<CredentialsListResult, { ok: true }> {
  return (r as { ok?: boolean }).ok === true;
}

const SETTINGS_KEY = "leadScraperSettingsV1";
const CREDENTIAL_KEY = "leadScraperCredentialV1";

type Settings = {
  spreadsheetId: string;
  settingsSheetName: string;
  leadsSheetName: string;
  startRow: number; // 1-based sheet row number (includes header row 1)
  endRow: number; // 1-based sheet row number (includes header row 1)
};

function getViewFromSearch(params: URLSearchParams | null) {
  const view = (params?.get("view") ?? "").toLowerCase();
  if (view === "googlesheet") return "googleSheet";
  return "leadScraper";
}

function PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialView = useMemo(() => getViewFromSearch(searchParams), [searchParams]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [activeView, setActiveView] = useState<"leadScraper" | "googleSheet">(initialView);

  const [settings, setSettings] = useState<Settings>({
    spreadsheetId: "1R5P2K0qBAGCIi3avjtxlUNkDVoG08RiSMtdHyYbpIag",
    settingsSheetName: "Niche Settings",
    leadsSheetName: "Scraped Leads",
    startRow: 2,
    endRow: 2,
  });
  const [tabs, setTabs] = useState<{ title: string; sheetId: number; dataRowCount: number }[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsResult, setTabsResult] = useState<TabsResult | null>(null);
  const [scrapedRows, setScrapedRows] = useState<number[]>([]);
  const [scrapedRowsResult, setScrapedRowsResult] = useState<ScrapedRowsResult | null>(null);
  const [scrapedRowsLoading, setScrapedRowsLoading] = useState(false);
  const [settingsRows, setSettingsRows] = useState<SettingsRowsResult | null>(null);
  const [settingsRowsOpen, setSettingsRowsOpen] = useState(false);
  const [settingsRowsLoading, setSettingsRowsLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [credentialsFiles, setCredentialsFiles] = useState<string[]>([]);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<string>("");
  const [activeCredential, setActiveCredential] = useState<string>("");
  const [messageLogLoading, setMessageLogLoading] = useState(true);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteName, setConfirmDeleteName] = useState("");
  const [credentialMessage, setCredentialMessage] = useState<string>("");
  const [pushingRows, setPushingRows] = useState<Record<number, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepInFlightRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Settings> & { sheetName?: string };
      setSettings((s) => ({
        spreadsheetId: typeof parsed.spreadsheetId === "string" ? parsed.spreadsheetId : s.spreadsheetId,
        settingsSheetName:
          typeof parsed.settingsSheetName === "string"
            ? parsed.settingsSheetName
            : typeof parsed.sheetName === "string"
              ? parsed.sheetName
              : s.settingsSheetName,
        leadsSheetName: typeof parsed.leadsSheetName === "string" ? parsed.leadsSheetName : s.leadsSheetName,
        startRow: typeof parsed.startRow === "number" && Number.isFinite(parsed.startRow) ? parsed.startRow : s.startRow,
        endRow: typeof parsed.endRow === "number" && Number.isFinite(parsed.endRow) ? parsed.endRow : s.endRow,
      }));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const active = window.localStorage.getItem("leadScraperActiveCredential") ?? "";
    setActiveCredential(active);
    setSelectedCredential(active);
  }, []);

  useEffect(() => {
    if (!activeCredential) return;
    setSelectedCredential(activeCredential);
  }, [activeCredential]);

  useEffect(() => {
    void loadCredentialsList();
  }, []);

  function getStoredCredentials(): Record<string, string> {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("leadScraperCredentials");
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  function setStoredCredentials(entries: Record<string, string>) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("leadScraperCredentials", JSON.stringify(entries));
  }

  function getAuthTokenForCredential(name: string) {
    if (!name || typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(`leadScraperToken:${name}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function getEffectiveCredential() {
    return selectedCredential || activeCredential;
  }

  useEffect(() => {
    const handle = window.setTimeout(() => setMessageLogLoading(false), 800);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    if (!settings.spreadsheetId.trim()) return;
    const token = getAuthTokenForCredential(getEffectiveCredential());
    if (!token) return;
    void loadTabs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.spreadsheetId, activeCredential, selectedCredential]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!loading) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [loading]);

  useEffect(() => {
    setActiveView((prev) => (prev === initialView ? prev : initialView));
  }, [initialView]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(CREDENTIAL_KEY, selectedCredential);
    } catch {
      // ignore
    }
  }, [selectedCredential]);

  const authUrl = useMemo(() => {
    if (!result) return null;
    if ("authUrl" in result && result.authUrl) return result.authUrl;
    return null;
  }, [result]);

  const tabsAuthUrl = useMemo(() => {
    if (!tabsResult) return null;
    if ("authUrl" in tabsResult && tabsResult.authUrl) return tabsResult.authUrl;
    return null;
  }, [tabsResult]);

  const canShowSheetConfig = tabsResult ? isOkTabsResult(tabsResult) : false;

  function buildSheetTabUrl(tabTitle: string, tabSheetId?: number) {
    const spreadsheetId = settings.spreadsheetId.trim();
    if (!spreadsheetId) return "#";
    const resolvedSheetId =
      typeof tabSheetId === "number"
        ? tabSheetId
        : tabs.find((tab) => tab.title === tabTitle)?.sheetId;
    if (typeof resolvedSheetId === "number") {
      return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${resolvedSheetId}`;
    }
    const encodedTitle = encodeURIComponent(tabTitle);
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#sheet=${encodedTitle}`;
  }


  async function readJson<T>(res: Response): Promise<T> {
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (!text) {
      throw new Error(`Empty response (HTTP ${res.status}). content-type=${contentType || "unknown"}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      const snippet = text.slice(0, 200);
      throw new Error(
        `Non-JSON response (HTTP ${res.status}). content-type=${contentType || "unknown"} body=${snippet}`,
      );
    }
  }

  async function loadTabs() {
    const startedAt = Date.now();
    setTabsLoading(true);
    setTabsResult(null);
    try {
      const token = getAuthTokenForCredential(getEffectiveCredential());
      if (!token) {
        setTabsResult({ error: "not_authorized", message: "Authorize Google Sheets access first." });
        return;
      }
      const res = await fetch("/api/sheets/tabs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spreadsheetId: settings.spreadsheetId, authToken: token }),
      });
      const data = await readJson<TabsResult>(res);
      setTabsResult(data);
      if (isOkTabsResult(data)) setTabs(data.tabs);
    } catch (e) {
      setTabsResult({ error: "network_error", message: String(e) });
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 300 - elapsed);
      window.setTimeout(() => setTabsLoading(false), remaining);
    }
  }

  async function loadCredentialsList() {
    setCredentialsLoading(true);
    setCredentialMessage("");
    try {
      const entries = getStoredCredentials();
      setCredentialsFiles(Object.keys(entries));
    } catch (e) {
      setCredentialMessage(String(e));
    } finally {
      setCredentialsLoading(false);
    }
  }

  async function uploadCredentialFile(file: File) {
    setCredentialMessage("");
    try {
      const content = await file.text();
      JSON.parse(content);
      const safeName = (file.name ?? "credentials.json").replace(/[^a-zA-Z0-9._-]/g, "_");
      const entries = getStoredCredentials();
      entries[safeName] = content;
      setStoredCredentials(entries);
      await loadCredentialsList();
      setSelectedCredential(safeName);
      setCredentialMessage("Credential uploaded. Please authorize.");
    } catch (e) {
      setCredentialMessage(String(e));
    }
  }

  async function deleteCredentialFile(file: string) {
    setCredentialMessage("");
    try {
      const entries = getStoredCredentials();
      delete entries[file];
      setStoredCredentials(entries);
      window.localStorage.removeItem(`leadScraperToken:${file}`);
      if (selectedCredential === file) setSelectedCredential("");
      if (activeCredential === file) {
        setActiveCredential("");
        window.localStorage.removeItem("leadScraperActiveCredential");
      }
      await loadCredentialsList();
      setCredentialMessage("Credential deleted.");
    } catch (e) {
      setCredentialMessage(String(e));
    }
  }
  async function loadScrapedRows() {
    setScrapedRowsLoading(true);
    setScrapedRowsResult(null);
    try {
      const token = getAuthTokenForCredential(getEffectiveCredential());
      if (!token) {
        setScrapedRowsResult({ error: "not_authorized", message: "Authorize Google Sheets access first." });
        return;
      }
      const res = await fetch("/api/sheets/scraped-rows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: settings.spreadsheetId,
          sheetName: settings.settingsSheetName,
          scrapedHeader: "Scraped",
          authToken: token,
        }),
      });
      const data = await readJson<ScrapedRowsResult>(res);
      setScrapedRowsResult(data);
      if (isOkScrapedRowsResult(data)) {
        setScrapedRows(data.rows);
      }
    } catch (e) {
      setScrapedRowsResult({ error: "network_error", message: String(e) });
    } finally {
      setScrapedRowsLoading(false);
    }
  }

  async function loadSettingsRows() {
    setSettingsRowsLoading(true);
    try {
      const token = getAuthTokenForCredential(getEffectiveCredential());
      if (!token) {
        setSettingsRows({ error: "not_authorized", message: "Authorize Google Sheets access first." });
        return;
      }
      const res = await fetch("/api/sheets/settings-rows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: settings.spreadsheetId,
          sheetName: settings.settingsSheetName,
          authToken: token,
        }),
      });
      const data = await readJson<SettingsRowsResult>(res);
      setSettingsRows(data);
    } catch (e) {
      setSettingsRows({ error: "network_error", message: String(e) });
    } finally {
      setSettingsRowsLoading(false);
    }
  }

  async function pushSettingsRow(rowNumber: number, datasetUrl: string) {
    if (!settings.spreadsheetId.trim() || !settings.settingsSheetName.trim() || !settings.leadsSheetName.trim()) return;
    const token = getAuthTokenForCredential(getEffectiveCredential());
    if (!token) {
      setCredentialMessage("Authorize Google Sheets access first.");
      return;
    }
    setPushingRows((prev) => ({ ...prev, [rowNumber]: true }));
    try {
      const res = await fetch("/api/sheets/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: settings.spreadsheetId,
          settingsSheetName: settings.settingsSheetName,
          leadsSheetName: settings.leadsSheetName,
          rowNumber,
          datasetUrl,
          authToken: token,
        }),
      });
      const data = await readJson<{ ok?: boolean; error?: string; message?: string }>(res);
      if (!data.ok) {
        setCredentialMessage(data.message ?? data.error ?? "Push failed.");
      } else {
        await loadSettingsRows();
      }
    } catch (e) {
      setCredentialMessage(String(e));
    } finally {
      setPushingRows((prev) => ({ ...prev, [rowNumber]: false }));
    }
  }


  // Auto-load tab list whenever Spreadsheet ID changes (debounced).
  useEffect(() => {
    const id = settings.spreadsheetId.trim();
    if (!id) {
      setTabs([]);
      return;
    }

    const handle = window.setTimeout(() => {
      void loadTabs();
    }, 500);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.spreadsheetId]);

  useEffect(() => {
    const id = settings.spreadsheetId.trim();
    if (!id || !settings.settingsSheetName.trim()) {
      setScrapedRows([]);
      return;
    }
    void loadScrapedRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.spreadsheetId, settings.settingsSheetName]);

  useEffect(() => {
    if (activeView !== "leadScraper") return;
    if (!canShowSheetConfig) return;
    void loadScrapedRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, canShowSheetConfig]);

  // Keep selected tab valid after tabs load/change.
  useEffect(() => {
    if (!tabs.length) return;
    setSettings((s) => {
      const next = { ...s };
      if (!tabs.some((t) => t.title === next.settingsSheetName)) {
        next.settingsSheetName = tabs[0]?.title ?? next.settingsSheetName;
      }
      if (!tabs.some((t) => t.title === next.leadsSheetName)) {
        next.leadsSheetName = tabs[0]?.title ?? next.leadsSheetName;
      }
      return next;
    });
  }, [tabs]);

  const settingsTabInfo = useMemo(() => {
    return tabs.find((t) => t.title === settings.settingsSheetName) ?? null;
  }, [tabs, settings.settingsSheetName]);

  const leadsTabInfo = useMemo(() => {
    return tabs.find((t) => t.title === settings.leadsSheetName) ?? null;
  }, [tabs, settings.leadsSheetName]);

  const settingsRowMin = 2;
  const settingsRowMax = useMemo(() => {
    if (!settingsTabInfo) return 2;
    // dataRowCount excludes header row 1. So max sheet row index = 1 + dataRowCount.
    return Math.max(2, 1 + settingsTabInfo.dataRowCount);
  }, [settingsTabInfo]);

  const availableRows = useMemo(() => {
    const rows = Array.from({ length: settingsRowMax - settingsRowMin + 1 }, (_, i) => settingsRowMin + i);
    if (scrapedRowsLoading) return rows;
    if (scrapedRowsResult && !isOkScrapedRowsResult(scrapedRowsResult)) return rows;
    const scrapedSet = new Set(scrapedRows);
    return rows.filter((r) => !scrapedSet.has(r));
  }, [scrapedRows, settingsRowMax, scrapedRowsLoading, scrapedRowsResult]);

  useEffect(() => {
    setSettings((s) => {
      const next = { ...s };
      const minRow = availableRows[0] ?? settingsRowMin;
      const maxRow = availableRows[availableRows.length - 1] ?? settingsRowMax;
      if (next.startRow < minRow) next.startRow = minRow;
      if (next.startRow > maxRow) next.startRow = maxRow;
      if (next.endRow < next.startRow) next.endRow = next.startRow;
      if (next.endRow > maxRow) next.endRow = maxRow;
      return next;
    });
  }, [settingsRowMax, availableRows, settingsRowMin]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function stepRun(activeRunId: string) {
    if (stepInFlightRef.current) return;
    stepInFlightRef.current = true;
    try {
      const token = getAuthTokenForCredential(getEffectiveCredential());
      if (!token) {
        setResult({ error: "not_authorized", message: "Authorize Google Sheets access first." });
        stopPolling();
        setLoading(false);
        setCanceling(false);
        setRunId(null);
        return;
      }
      const res = await fetch("/api/run/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: activeRunId, authToken: token }),
      });
      const data = await readJson<RunResult>(res);
      if (!isOkResult(data) && data.error === "no_active_run") {
        stopPolling();
        setLoading(false);
        setCanceling(false);
        setRunId(null);
        return;
      }
      setResult(data);
      if (isOkResult(data) && data.done) {
        stopPolling();
        setLoading(false);
        setCanceling(false);
        setRunId(null);
      }
    } catch (e) {
      setResult({ error: "network_error", message: String(e) });
      stopPolling();
      setLoading(false);
      setCanceling(false);
      setRunId(null);
    } finally {
      stepInFlightRef.current = false;
    }
  }

  function startPolling(activeRunId: string) {
    stopPolling();
    pollRef.current = setInterval(() => {
      void stepRun(activeRunId);
    }, 1500);
  }

  async function run() {
    setLoading(true);
    setResult(null);
    setCanceling(false);
    setRunId(null);
    stopPolling();
    try {
      const token = getAuthTokenForCredential(getEffectiveCredential());
      if (!token) {
        setResult({ error: "not_authorized", message: "Authorize Google Sheets access first." });
        setLoading(false);
        return;
      }
      const res = await fetch("/api/run/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: settings.spreadsheetId,
          settingsSheetName: settings.settingsSheetName,
          leadsSheetName: settings.leadsSheetName,
          startRow: settings.startRow,
          endRow: settings.endRow,
          authToken: token,
        }),
      });
      const data = await readJson<RunResult>(res);
      setResult(data);
      if (isOkResult(data) && data.runId) {
        setRunId(data.runId);
        startPolling(data.runId);
      } else {
        setLoading(false);
      }
    } catch (e) {
      setResult({ error: "network_error", message: String(e) });
      setLoading(false);
    } finally {
      void loadScrapedRows();
    }
  }

  async function stopRun() {
    if (!runId) return;
    setCanceling(true);
    try {
      await fetch("/api/run/cancel", { method: "POST" });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white px-4 py-5 lg:w-64 lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
          <div className="text-lg font-semibold tracking-tight">Lead Scraper</div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm lg:mt-6 lg:grid-cols-1">
            <button
              type="button"
              onClick={() => {
                setActiveView("leadScraper");
                router.replace("?view=leadscraper");
              }}
              className={`w-full rounded-lg px-3 py-2 text-left font-medium transition ${
                activeView === "leadScraper"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <FontAwesomeIcon icon={faBolt} className="mr-2 h-4 w-4" />
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveView("googleSheet");
                router.replace("?view=googlesheet");
              }}
              className={`w-full rounded-lg px-3 py-2 text-left font-medium transition ${
                activeView === "googleSheet"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <FontAwesomeIcon icon={faTable} className="mr-2 h-4 w-4" />
              Google Sheet
            </button>
          </div>
        </aside>

        <main className="flex-1">
          <div className="px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
            {activeView === "leadScraper" ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
                  <p className="mt-2 text-sm text-slate-600">
                    Select a Google credential, authorize access, and choose the Settings rows to run. The scraper
                    processes rows sequentially, writes status and Dataset URL back to the Settings sheet, and appends
                    leads to your Leads sheet.
                  </p>

                  <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch">
                  <div className="order-2 flex h-full flex-col space-y-4 lg:border-l lg:border-slate-200 lg:pl-6">
                    {tabsLoading ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <div className="skeleton h-4 w-32" />
                          <div className="skeleton h-11 w-full" />
                          <div className="skeleton h-4 w-40" />
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="skeleton h-11 w-full" />
                          <div className="skeleton h-11 w-full" />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 mb-4">
                        <label className="text-sm font-medium text-slate-700 mb-2 block">Spreadsheet ID</label>
                        <input
                          className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm shadow-sm focus-visible:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                          value={settings.spreadsheetId}
                          onChange={(e) => setSettings((s) => ({ ...s, spreadsheetId: e.target.value }))}
                          placeholder="Paste spreadsheet ID"
                        />
                        <div className="flex items-center gap-3">
                          <button
                            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                            onClick={loadTabs}
                            disabled={tabsLoading || !settings.spreadsheetId.trim()}
                          >
                            <FontAwesomeIcon icon={faRotate} className="mr-1.5 h-3 w-3" />
                            {tabsLoading ? "Loading tabs…" : "Refresh tabs"}
                          </button>
                        </div>
                        {tabsResult && !isOkTabsResult(tabsResult) ? (
                          <div className="text-xs text-slate-600">
                            {tabsResult.error}
                            {tabsResult.message ? ` — ${tabsResult.message}` : null}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {canShowSheetConfig ? (
                      tabsLoading ? (
                        <>
                          <div className="space-y-2">
                            <div className="skeleton h-4 w-20" />
                            <div className="skeleton h-11 w-full" />
                            <div className="skeleton h-3 w-2/3" />
                          </div>
                          <div className="space-y-2">
                            <div className="skeleton h-4 w-16" />
                            <div className="skeleton h-11 w-full" />
                            <div className="skeleton h-3 w-2/3" />
                          </div>
                          <div className="space-y-2">
                            <div className="skeleton h-4 w-24" />
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div className="skeleton h-11 w-full" />
                              <div className="skeleton h-11 w-full" />
                            </div>
                            <div className="skeleton h-3 w-3/4" />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-slate-700">Settings</label>
                              <a
                                className={`inline-flex h-7 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-[11px] font-medium text-slate-700 shadow-sm ${
                                    settings.spreadsheetId.trim()
                                      ? "hover:bg-slate-50"
                                      : "cursor-not-allowed opacity-60"
                                  }`}
                                  href={buildSheetTabUrl(settings.settingsSheetName, settingsTabInfo?.sheetId)}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-disabled={!settings.spreadsheetId.trim()}
                                >
                                <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="mr-1.5 h-3 w-3" />
                                  View
                                </a>
                              </div>
                              <select
                                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                                value={settings.settingsSheetName}
                                onChange={(e) => setSettings((s) => ({ ...s, settingsSheetName: e.target.value }))}
                              >
                                {tabs.length ? (
                                  tabs.map((t) => (
                                    <option key={t.title} value={t.title}>
                                      {t.title} ({t.dataRowCount})
                                    </option>
                                  ))
                                ) : (
                                  <>
                                    <option value="Niche Settings">Niche Settings</option>
                                    <option value={settings.settingsSheetName}>{settings.settingsSheetName}</option>
                                  </>
                                )}
                              </select>
                              <p className="text-xs text-slate-500">
                                Tabs load automatically after you enter a Spreadsheet ID (requires Google authorization).
                              </p>
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-slate-700">Leads</label>
                              <a
                                className={`inline-flex h-7 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-[11px] font-medium text-slate-700 shadow-sm ${
                                    settings.spreadsheetId.trim()
                                      ? "hover:bg-slate-50"
                                      : "cursor-not-allowed opacity-60"
                                  }`}
                                  href={buildSheetTabUrl(settings.leadsSheetName, leadsTabInfo?.sheetId)}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-disabled={!settings.spreadsheetId.trim()}
                                >
                                <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="mr-1.5 h-3 w-3" />
                                  View
                                </a>
                              </div>
                              <select
                                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                                value={settings.leadsSheetName}
                                onChange={(e) => setSettings((s) => ({ ...s, leadsSheetName: e.target.value }))}
                              >
                                {tabs.length ? (
                                  tabs.map((t) => (
                                    <option key={t.title} value={t.title}>
                                      {t.title} ({t.dataRowCount})
                                    </option>
                                  ))
                                ) : (
                                  <>
                                    <option value="Scraped Leads">Scraped Leads</option>
                                    <option value={settings.leadsSheetName}>{settings.leadsSheetName}</option>
                                  </>
                                )}
                              </select>
                              <p className="text-xs text-slate-500">
                                This is where scraped leads will be written (Dataset URL writeback still uses Settings tab).
                              </p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <label className="text-sm font-medium text-slate-700">Settings rows</label>
                              <button
                                type="button"
                                className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                                onClick={loadScrapedRows}
                                disabled={!settings.spreadsheetId.trim() || scrapedRowsLoading}
                              >
                                <FontAwesomeIcon icon={faRotate} className="mr-1.5 h-3 w-3" />
                                {scrapedRowsLoading ? "Refreshing…" : "Refresh rows"}
                              </button>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div className="space-y-1">
                                <div className="text-xs text-slate-600">Start row</div>
                                <select
                                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                                  value={settings.startRow}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setSettings((s) => ({
                                      ...s,
                                      startRow: v,
                                      endRow: Math.max(v, s.endRow),
                                    }));
                                  }}
                                  disabled={!availableRows.length}
                                >
                                  {availableRows.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <div className="text-xs text-slate-600">End row</div>
                                <select
                                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                                  value={settings.endRow}
                                  onChange={(e) => setSettings((s) => ({ ...s, endRow: Number(e.target.value) }))}
                                  disabled={!availableRows.length}
                                >
                                  {availableRows.filter((r) => r >= settings.startRow).map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <p className="text-xs text-slate-500">
                              Select which Settings rows to run (sheet row numbers; row 1 is the header).
                              {scrapedRowsLoading ? (
                                <span className="ml-2 inline-block align-middle">
                                  <span className="skeleton inline-block h-3 w-24" />
                                </span>
                              ) : null}
                              {scrapedRowsResult && !isOkScrapedRowsResult(scrapedRowsResult)
                                ? ` Unable to load scraped rows (${scrapedRowsResult.error}).`
                                : ""}
                              {!availableRows.length ? " All rows are already scraped." : ""}
                            </p>
                          </div>
                        </>
                      )
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        Select a credential and authorize Google to load Settings and Leads fields.
                      </div>
                    )}
                  </div>

                  <div className="order-1 flex h-full flex-col space-y-2">
                    {!credentialsLoading &&
                    (!activeCredential || !credentialsFiles.includes(activeCredential)) ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        No connected credentials yet. Select a credential on the Dashboard and authorize it.
                      </div>
                    ) : null}
                    <label className="text-sm font-medium text-slate-700">Google Credentials</label>
                    <div className="flex flex-col gap-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-medium text-slate-700">Select credential</div>
                        <div className="mt-2 space-y-2">
                          {credentialsLoading ? (
                            <div className="space-y-2">
                              {Array.from({ length: 3 }, (_, i) => (
                                <div key={i} className="skeleton h-4 w-2/3" />
                              ))}
                            </div>
                          ) : credentialsFiles.length ? (
                            credentialsFiles.map((f) => (
                              <label key={f} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                                <span className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={selectedCredential === f}
                                    onChange={() => setSelectedCredential(f)}
                                  />
                                  {f}
                                </span>
                                {activeCredential === f ? (
                                  <span className="text-xs font-semibold text-emerald-600">✓ CONNECTED</span>
                                ) : null}
                              </label>
                            ))
                          ) : (
                            <div className="text-xs text-slate-500">No uploaded credentials yet.</div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                          <FontAwesomeIcon icon={faUpload} className="mr-1.5 h-3 w-3" />
                          Upload JSON
                          <input
                            type="file"
                            accept=".json,application/json"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadCredentialFile(file);
                              if (e.currentTarget) e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center rounded-lg bg-slate-900 px-2.5 text-[11px] font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                          onClick={async () => {
                            if (!selectedCredential) return;
                            const entries = getStoredCredentials();
                            const credentialsJson = entries[selectedCredential];
                            if (!credentialsJson) {
                              setCredentialMessage("Missing credentials JSON. Upload again.");
                              return;
                            }
                            const res = await fetch("/api/auth/start", {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({
                                credentialsJson,
                                credentialName: selectedCredential,
                              }),
                            });
                            const data = await readJson<{ ok?: boolean; authUrl?: string; error?: string; message?: string }>(res);
                            if (data.ok && data.authUrl) {
                              window.location.href = data.authUrl;
                            } else {
                              setCredentialMessage(data.message ?? data.error ?? "Authorization failed.");
                            }
                          }}
                          disabled={!selectedCredential}
                        >
                          <FontAwesomeIcon icon={faKey} className="mr-1.5 h-3 w-3" />
                          {selectedCredential === activeCredential ? "Reauthorize Google" : "Authorize Google"}
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center rounded-lg bg-red-600 px-2.5 text-[11px] font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
                          onClick={() => {
                            if (!selectedCredential) return;
                            setConfirmDeleteName(selectedCredential);
                            setConfirmDeleteOpen(true);
                          }}
                          disabled={!selectedCredential}
                        >
                          <FontAwesomeIcon icon={faTrash} className="mr-1.5 h-3 w-3" />
                          Delete
                        </button>
                      </div>
                      {credentialsLoading ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <div className="skeleton h-8 w-24" />
                          <div className="skeleton h-8 w-28" />
                          <div className="skeleton h-8 w-20" />
                        </div>
                      ) : null}
                    </div>
                    {credentialMessage ? <div className="text-xs text-slate-600">{credentialMessage}</div> : null}
                  </div>

                  <div className="order-3 flex h-full flex-col space-y-3 lg:border-l lg:border-slate-200 lg:pl-6">
                    <div className="text-sm font-medium text-slate-700">Message Log</div>
                    {result ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                      {isOkResult(result) ? (
                        result.done ? (
                          <div className="space-y-3">
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                              Scraper completed successfully.
                            </div>
                            <div>
                              <span className="font-medium">Rows:</span> {result.startRow}–{result.endRow} (
                              {result.processed} processed, {result.skipped} skipped)
                            </div>
                            <div>
                              <span className="font-medium">Leads appended:</span> {result.totalLeads}
                            </div>
                            <div>
                              <span className="font-medium">Started:</span> {result.startedAt}
                            </div>
                            <div>
                              <span className="font-medium">Finished:</span> {result.finishedAt}
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="text-xs font-medium text-slate-700">Per row</div>
                              <ul className="mt-2 max-h-56 space-y-2 overflow-auto text-xs text-slate-700">
                                {result.perRow.map((r) => (
                                  <li key={r.row} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <span className="font-medium">Row {r.row}</span> — {r.status}
                                        {typeof r.leads === "number" ? ` (${r.leads} leads)` : ""}
                                      </div>
                                      {r.datasetUrl ? (
                                        <a
                                          className="text-slate-700 underline"
                                          href={r.datasetUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          Dataset URL
                                        </a>
                                      ) : null}
                                    </div>
                                    {r.message ? <div className="mt-1 text-slate-600">{r.message}</div> : null}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                              Scraper is running. Log details will appear when the run finishes.
                            </div>
                            <div>
                              <span className="font-medium">Started:</span> {result.startedAt}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-600">
                              <span className="inline-flex h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                              <span>Working…</span>
                            </div>
                            {result.perRow.length ? (
                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="text-xs font-medium text-slate-700">Per row</div>
                                <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                                  <span className="inline-flex h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                                  <span>
                                    Row {result.startRow + result.processed + result.skipped} is in progress…
                                  </span>
                                </div>
                                <ul className="mt-2 max-h-56 space-y-2 overflow-auto text-xs text-slate-700">
                                  {result.perRow.map((r) => (
                                    <li key={r.row} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <span className="font-medium">Row {r.row}</span> — {r.status}
                                          {typeof r.leads === "number" ? ` (${r.leads} leads)` : ""}
                                        </div>
                                        {r.datasetUrl ? (
                                          <a
                                            className="text-slate-700 underline"
                                            href={r.datasetUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Dataset URL
                                          </a>
                                        ) : null}
                                      </div>
                                      {r.message ? <div className="mt-1 text-slate-600">{r.message}</div> : null}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        )
                      ) : (
                          <div className="space-y-2">
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                              Scraper failed.
                            </div>
                            <div>
                              <span className="font-medium">Error:</span> {result.error}
                            </div>
                            {result.message ? <div className="text-slate-700">{result.message}</div> : null}
                            {authUrl ? (
                              <div>
                                <a className="text-slate-700 underline" href={authUrl}>
                                  Click here to authorize Google
                                </a>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : loading || messageLogLoading ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                        <div className="space-y-3">
                          <div className="skeleton h-4 w-1/3" />
                          <div className="skeleton h-4 w-1/4" />
                          <div className="skeleton h-4 w-1/2" />
                          <div className="skeleton h-4 w-2/5" />
                          <div className="skeleton h-4 w-1/3" />
                        </div>
                        <div className="mt-4 space-y-2">
                          {Array.from({ length: 3 }, (_, i) => (
                            <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="skeleton h-3 w-1/2" />
                              <div className="mt-2 skeleton h-3 w-1/3" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                        No messages yet.
                      </div>
                    )}
                  </div>
                </div>
                </div>

                <div className="sticky bottom-0 mt-8 -mx-6 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur sm:-mx-8 sm:px-8">
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-end lg:grid lg:grid-cols-3 lg:items-center lg:gap-6">
                    <div className="hidden lg:block" />
                    <div className="hidden lg:block" />
                    <div>
                      {tabsLoading ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <div className="skeleton h-11 w-36" />
                          <div className="skeleton h-11 w-36" />
                        </div>
                      ) : canShowSheetConfig ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                          <button
                            className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                            onClick={run}
                            disabled={loading}
                          >
                            <FontAwesomeIcon icon={faPlay} className="mr-2 h-4 w-4" />
                            {loading ? "Running…" : "Run scraper"}
                          </button>
                          {loading ? (
                            <button
                              className="inline-flex h-11 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
                              onClick={stopRun}
                              disabled={canceling}
                            >
                              <FontAwesomeIcon icon={faStop} className="mr-2 h-4 w-4" />
                              {canceling ? "Stopping…" : "Stop Scraper"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Google Sheet</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Authorize access, then review available tabs in your spreadsheet.
                </p>

                <div className="mt-6 space-y-4">
                  {!credentialsLoading &&
                  (!activeCredential || !credentialsFiles.includes(activeCredential)) ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        No connected credentials yet. Select a credential on the Dashboard and authorize it.
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                        onClick={() => {
                          setActiveView("leadScraper");
                          router.replace("?view=leadscraper");
                        }}
                      >
                        Go to Dashboard
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Spreadsheet ID</label>
                        <input
                          className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm shadow-sm focus-visible:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                          value={settings.spreadsheetId}
                          onChange={(e) => setSettings((s) => ({ ...s, spreadsheetId: e.target.value }))}
                          placeholder="Paste spreadsheet ID"
                        />
                        <div className="flex items-center gap-3">
                          <button
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                            onClick={loadTabs}
                            disabled={tabsLoading || !settings.spreadsheetId.trim()}
                          >
                            <FontAwesomeIcon icon={faRotate} className="mr-2 h-3.5 w-3.5" />
                            {tabsLoading ? "Loading tabs…" : "Refresh tabs"}
                          </button>
                          {tabsAuthUrl ? (
                            <a className="text-sm text-slate-700 underline" href={tabsAuthUrl}>
                              Authorize to load tabs
                            </a>
                          ) : null}
                        </div>
                        {tabsResult && !isOkTabsResult(tabsResult) ? (
                          <div className="text-xs text-slate-600">
                            {tabsResult.error}
                            {tabsResult.message ? ` — ${tabsResult.message}` : null}
                          </div>
                        ) : null}
                      </div>

                      {canShowSheetConfig ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                            <span>Tabs</span>
                            <span className="text-xs font-normal text-slate-500">{tabs.length} total</span>
                          </div>
                          {tabsLoading || !tabsResult ? (
                            <ul className="mt-3 space-y-2 text-sm">
                              {Array.from({ length: 4 }, (_, i) => (
                                <li key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                                  <div className="space-y-2">
                                    <div className="skeleton h-4 w-1/2" />
                                    <div className="skeleton h-3 w-1/3" />
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : tabs.length ? (
                            <ul className="mt-3 space-y-2 text-sm">
                          {tabs.map((tab) => (
                            <li
                              key={tab.title}
                              className={`rounded-lg border bg-white px-3 py-2 ${
                                tab.title === settings.settingsSheetName
                                  ? "border-emerald-400"
                                  : "border-slate-200"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="font-medium text-slate-800">{tab.title}</div>
                                  <div className="text-xs text-slate-500">{tab.dataRowCount} rows</div>
                                </div>
                                <button
                                  type="button"
                                  className={`inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium ${
                                    settings.spreadsheetId.trim()
                                      ? "bg-slate-900 text-white hover:bg-slate-800"
                                      : "cursor-not-allowed bg-slate-200 text-slate-500"
                                  }`}
                                  onClick={() => {
                                    if (!settings.spreadsheetId.trim()) return;
                                    if (tab.title !== settings.settingsSheetName) {
                                      window.open(buildSheetTabUrl(tab.title, tab.sheetId), "_blank", "noreferrer");
                                      return;
                                    }
                                    setSettingsRowsOpen((prev) => !prev);
                                    if (!settingsRowsOpen && !settingsRowsLoading) {
                                      void loadSettingsRows();
                                    }
                                  }}
                                  disabled={!settings.spreadsheetId.trim()}
                                >
                                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="mr-1.5 h-3 w-3" />
                                  {tab.title === settings.settingsSheetName
                                    ? settingsRowsOpen
                                      ? "Hide"
                                      : "View"
                                    : "View"}
                                </button>
                              </div>

                              {tab.title === settings.settingsSheetName && settingsRowsOpen ? (
                                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                                  {settingsRowsLoading ? (
                                    <div className="space-y-2">
                                      <div className="skeleton h-3 w-1/2" />
                                      <div className="skeleton h-3 w-2/3" />
                                      <div className="skeleton h-3 w-1/3" />
                                    </div>
                                  ) : settingsRows && isOkSettingsRowsResult(settingsRows) ? (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-[80px_minmax(120px,1fr)_90px_minmax(120px,1fr)_100px_110px] gap-2 font-medium text-slate-600">
                                        <div>Row</div>
                                        <div>Dataset URL</div>
                                        <div>Max Limit</div>
                                        <div>Push Status</div>
                                        <div>Status</div>
                                        <div className="text-right">Action</div>
                                      </div>
                                      {settingsRows.rows.length ? (
                                        settingsRows.rows.map((row) => (
                                          <div
                                            key={row.rowNumber}
                                            className="grid grid-cols-[80px_minmax(120px,1fr)_90px_minmax(120px,1fr)_100px_110px] gap-2 items-center"
                                          >
                                            <div>{row.rowNumber}</div>
                                            <div className="truncate">
                                              {row.datasetUrl ? (
                                                <a
                                                  className="text-slate-700 underline"
                                                  href={row.datasetUrl}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                >
                                                  Dataset URL
                                                </a>
                                              ) : (
                                                <span className="text-slate-400">No URL</span>
                                              )}
                                            </div>
                                            <div>{row.maxLimit || "-"}</div>
                                            <div className="truncate">{row.pushStatus || "-"}</div>
                                            <div className="text-xs">
                                              {pushingRows[row.rowNumber]
                                                ? "Pushing"
                                                : row.pushed
                                                  ? "Pushed"
                                                  : row.pushStatus.toLowerCase().includes("0 leads")
                                                    ? "Failed"
                                                    : ""}
                                            </div>
                                            <div className="flex justify-end">
                                              <button
                                                type="button"
                                                className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-600 px-3 text-[11px] font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                                                disabled={!row.datasetUrl || pushingRows[row.rowNumber]}
                                                onClick={() => void pushSettingsRow(row.rowNumber, row.datasetUrl)}
                                              >
                                                {pushingRows[row.rowNumber] ? "Pushing…" : "Push"}
                                              </button>
                                            </div>
                                          </div>
                                        ))
                                      ) : (
                                        <div className="text-slate-500">No rows found.</div>
                                      )}
                                    </div>
                                  ) : settingsRows ? (
                                    <div className="text-slate-600">
                                      {"error" in settingsRows ? settingsRows.message ?? settingsRows.error : "Failed to load rows."}
                                    </div>
                                  ) : (
                                    <div className="text-slate-500">No rows loaded.</div>
                                  )}
                                </div>
                              ) : null}
                            </li>
                          ))}
                            </ul>
                          ) : (
                            <div className="mt-3 text-xs text-slate-600">No tabs loaded yet.</div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <div className="skeleton h-4 w-1/3" />
                          <div className="skeleton h-3 w-1/4" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
      {confirmDeleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Delete credential</h2>
            <p className="mt-2 text-sm text-slate-600">
              Are you sure you want to delete <span className="font-medium text-slate-900">{confirmDeleteName}</span>?
              This action cannot be undone.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                onClick={() => setConfirmDeleteOpen(false)}
              >
                <FontAwesomeIcon icon={faXmark} className="mr-2 h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-700"
                onClick={() => {
                  void deleteCredentialFile(confirmDeleteName);
                  setConfirmDeleteOpen(false);
                }}
              >
                <FontAwesomeIcon icon={faTrash} className="mr-2 h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <PageContent />
    </Suspense>
  );
}
