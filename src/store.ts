// App state in one place: a tiny store (no library) plus the actions that
// talk to the backend.

import { useSyncExternalStore } from "react";
import {
  api,
  switchToDemoData,
  TRASH_TOKEN,
  type AppInfo,
  type AppMeta,
  type CleanGroup,
  type DeleteMode,
  type DeleteOutcome,
  type DeleteRequest,
  type DiskInfo,
  type Kind,
  type Overview,
  type ScanStatus,
} from "./api";
import { configureFormat, formatBytes } from "./format";
import { setLocale, t, tn } from "./i18n";

export type View = "overview" | "apps" | "files" | "folders" | "cleanup";

/** Something the user ticked, from any tab. */
export interface SelItem {
  path: string;
  name: string;
  size: number;
  kind: Kind;
  mode: DeleteMode;
  /** From the Cleanup tab (lives inside an otherwise protected folder). */
  cleanup: boolean;
  /** File to show the icon of. */
  icon: string | null;
  /** Set for apps: enables "also remove its data". */
  app?: AppInfo;
  unknownSize?: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "warn";
  action?: { label: string; run: () => void };
}

export interface State {
  meta: AppMeta | null;
  disk: DiskInfo | null;
  view: View;
  scan: ScanStatus;
  overview: Overview | null;
  apps: AppInfo[] | null;
  cleanup: CleanGroup[] | null;
  /** Bumps whenever the disk changed, so lists know to reload. */
  version: number;
  selection: Map<string, SelItem>;
  folderPath: string;
  appsSort: "size" | "used" | "name";
  confirmOpen: boolean;
  deleting: { done: number; total: number } | null;
  toasts: Toast[];
  fdaDismissed: boolean;
}

let state: State = {
  meta: null,
  disk: null,
  view: "overview",
  scan: { state: "idle", files: 0, bytes: 0, current: "" },
  overview: null,
  apps: null,
  cleanup: null,
  version: 0,
  selection: new Map(),
  folderPath: "",
  appsSort: "size",
  confirmOpen: false,
  deleting: null,
  toasts: [],
  fdaDismissed: (() => {
    try {
      return localStorage.getItem("roomy.fdaDismissed") === "1";
    } catch {
      return false;
    }
  })(),
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

// ---------------------------------------------------------------------------
// Start-up and scanning
// ---------------------------------------------------------------------------

let pollTimer: number | undefined;

export async function init() {
  let meta = await api.appInfo();
  if (meta.demo && window.__TAURI_INTERNALS__) {
    switchToDemoData(meta);
    meta = { ...(await api.appInfo()), shotsDir: meta.shotsDir };
  }
  // The web view knows the system language on both macOS and Windows.
  setLocale(navigator.language || meta.locale);
  configureFormat(meta.platform, meta.home);
  document.documentElement.dataset.platform = meta.platform;
  setState({ meta, folderPath: meta.home });
  void api.diskInfo().then((disk) => setState({ disk }));
  void refreshLists();
  await rescan();
}

/** Apps and cleanup suggestions do not need the full scan. */
export async function refreshLists() {
  const [apps, cleanup] = await Promise.all([api.listApps().catch(() => []), api.cleanup().catch(() => [])]);
  setState({ apps, cleanup });
}

export async function rescan() {
  if (state.scan.state === "scanning") return;
  setState({ scan: { state: "scanning", files: 0, bytes: 0, current: "" } });
  await api.startScan();
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    const scan = await api.scanStatus();
    if (scan.state === "scanning") {
      setState({ scan });
      return;
    }
    window.clearInterval(pollTimer);
    const overview = await api.overview();
    setState({ scan, overview, disk: overview?.disk ?? state.disk, version: state.version + 1 });
  }, 110);
}

async function refreshAfterChange() {
  const [overview] = await Promise.all([api.overview().catch(() => state.overview), refreshLists()]);
  setState({ overview, disk: overview?.disk ?? state.disk, version: state.version + 1 });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export function navigate(view: View) {
  setState({ view });
}

export function openFolder(path: string) {
  setState({ view: "folders", folderPath: path });
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function isSelected(path: string) {
  return state.selection.has(path);
}

export function toggleSelect(item: SelItem) {
  const selection = new Map(state.selection);
  if (selection.has(item.path)) selection.delete(item.path);
  else selection.set(item.path, item);
  setState({ selection });
}

export function setSelected(items: SelItem[], on: boolean) {
  const selection = new Map(state.selection);
  for (const item of items) {
    if (on) selection.set(item.path, item);
    else selection.delete(item.path);
  }
  setState({ selection });
}

export function clearSelection() {
  setState({ selection: new Map(), confirmOpen: false });
}

export function selectionSize(selection: Map<string, SelItem>) {
  let size = 0;
  for (const item of selection.values()) size += item.size;
  return size;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

let toastId = 0;

export function toast(text: string, tone: Toast["tone"] = "ok", action?: Toast["action"]) {
  const id = ++toastId;
  setState({ toasts: [...state.toasts.slice(-2), { id, text, tone, action }] });
  window.setTimeout(() => dismissToast(id), action ? 9000 : 4500);
}

export function dismissToast(id: number) {
  setState({ toasts: state.toasts.filter((x) => x.id !== id) });
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

const isWin = () => state.meta?.platform === "windows";

export async function emptyTrash() {
  try {
    const freed = await api.emptyTrash();
    toast(freed > 0 ? t("toast.freed", { size: formatBytes(freed) }) : t(isWin() ? "toast.binEmptied" : "toast.trashEmptied"));
  } catch (error) {
    toast(t("toast.error", { error: String(error) }), "warn");
  }
  await refreshAfterChange();
}

/**
 * Deletes `requests` one by one (so progress can be shown), then tells the
 * user what happened and reloads everything.
 */
export async function runDelete(requests: DeleteRequest[]) {
  const outcomes: DeleteOutcome[] = [];
  setState({ deleting: { done: 0, total: requests.length } });
  for (let i = 0; i < requests.length; i++) {
    try {
      const [outcome] = await api.deleteItems([requests[i]]);
      outcomes.push(outcome);
    } catch (error) {
      outcomes.push({ path: requests[i].path, ok: false, error: String(error), freed: 0, trashed: false, skipped: 0 });
    }
    setState({ deleting: { done: i + 1, total: requests.length } });
  }

  // Whatever was deleted is no longer selected; failures stay ticked.
  const selection = new Map(state.selection);
  for (const outcome of outcomes) if (outcome.ok) selection.delete(outcome.path);
  setState({ deleting: null, confirmOpen: false, selection });

  const trashed = outcomes.filter((o) => o.ok && o.trashed).reduce((s, o) => s + o.freed, 0);
  const freed = outcomes.filter((o) => o.ok && !o.trashed).reduce((s, o) => s + o.freed, 0);
  const failed = outcomes.filter((o) => !o.ok).length;
  const skipped = outcomes.some((o) => o.ok && o.skipped > 0);
  const emptiedTrash = requests.some((r) => r.path === TRASH_TOKEN || r.mode === "emptyTrash");

  if (freed > 0) toast(t("toast.freed", { size: formatBytes(freed) }));
  else if (emptiedTrash && failed === 0) toast(t(isWin() ? "toast.binEmptied" : "toast.trashEmptied"));
  if (trashed > 0) {
    toast(t(isWin() ? "toast.binned" : "toast.trashed", { size: formatBytes(trashed) }), "ok", {
      label: t(isWin() ? "toast.emptyBin" : "toast.emptyTrash"),
      run: () => void emptyTrash(),
    });
  }
  if (failed > 0) toast(tn("toast.failed", failed), "warn");
  else if (skipped) toast(t("toast.skipped"), "warn");

  await refreshAfterChange();
  return outcomes;
}

export function dismissFda() {
  try {
    localStorage.setItem("roomy.fdaDismissed", "1");
  } catch {
    /* private mode */
  }
  setState({ fdaDismissed: true });
}
