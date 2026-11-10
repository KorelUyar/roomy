// App state in one place: a tiny store (no library) plus the actions that
// talk to the backend.

import { useSyncExternalStore } from "react";
import {
  api,
  switchToDemoData,
  TRASH_TOKEN,
  type AppInfo,
  type AppMeta,
  type BloatReport,
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
import { initLanguage, setLanguage, t, tn, type Lang } from "./i18n";

export type View = "overview" | "apps" | "files" | "folders" | "cleanup" | "bloat";

const IDLE: ScanStatus = { state: "idle", files: 0, bytes: 0, current: "" };

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
  lang: Lang;
  /** Every disk of this computer, the system disk first. */
  disks: DiskInfo[];
  /** Mount point of the disk the user is looking at. */
  diskRoot: string;
  /** Scan progress and result per disk (keyed by mount point). */
  scans: Record<string, ScanStatus>;
  overviews: Record<string, Overview>;
  /** The three below always describe the disk in `diskRoot`. */
  disk: DiskInfo | null;
  view: View;
  scan: ScanStatus;
  overview: Overview | null;
  bloat: BloatReport | null;
  bloatBusy: boolean;
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
  lang: "en",
  disks: [],
  diskRoot: "",
  scans: {},
  overviews: {},
  disk: null,
  view: "overview",
  scan: IDLE,
  overview: null,
  bloat: null,
  bloatBusy: false,
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
  // Keep the "current disk" fields in step with the selection.
  if ("diskRoot" in patch || "scans" in patch || "overviews" in patch || "disks" in patch) {
    state.scan = state.scans[state.diskRoot] ?? IDLE;
    state.overview = state.overviews[state.diskRoot] ?? null;
    state.disk = state.overviews[state.diskRoot]?.disk ?? state.disks.find((d) => d.root === state.diskRoot) ?? null;
  }
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

const pollers = new Map<string, number>();

export async function init() {
  let meta = await api.appInfo();
  if (meta.demo && window.__TAURI_INTERNALS__) {
    switchToDemoData(meta);
    meta = { ...(await api.appInfo()), shotsDir: meta.shotsDir };
  }
  const lang = initLanguage();
  configureFormat(meta.platform, meta.home, lang);
  document.documentElement.dataset.platform = meta.platform;
  const disks = await api.listDisks().catch(() => []);
  const diskRoot = disks.find((d) => d.system)?.root ?? meta.root;
  setState({ meta, lang, disks, diskRoot, folderPath: meta.home });
  void refreshLists();
  await scanDisk(diskRoot);
}

/** English or German. Everything on screen is rebuilt in the new language. */
export function chooseLanguage(lang: Lang) {
  setLanguage(lang);
  if (state.meta) configureFormat(state.meta.platform, state.meta.home, lang);
  setState({ lang });
}

/** Apps and cleanup suggestions do not need the full scan. */
export async function refreshLists() {
  const [apps, cleanup] = await Promise.all([api.listApps().catch(() => []), api.cleanup().catch(() => [])]);
  setState({ apps, cleanup });
}

async function refreshDisks() {
  const disks = await api.listDisks().catch(() => state.disks);
  // A disk that was unplugged takes the selection back to the system disk.
  const diskRoot = disks.some((d) => d.root === state.diskRoot) ? state.diskRoot : (disks.find((d) => d.system)?.root ?? state.diskRoot);
  setState({ disks, diskRoot });
}

/** Scans one disk (again). Progress lands in `scans[root]`. */
export async function scanDisk(root: string) {
  if (state.scans[root]?.state === "scanning") return;
  setState({ scans: { ...state.scans, [root]: { state: "scanning", files: 0, bytes: 0, current: "" } } });
  try {
    await api.startScan(root);
  } catch {
    setState({ scans: { ...state.scans, [root]: IDLE } });
    return;
  }
  window.clearInterval(pollers.get(root));
  pollers.set(
    root,
    window.setInterval(async () => {
      const scan = await api.scanStatus(root).catch(() => IDLE);
      if (scan.state === "scanning") {
        setState({ scans: { ...state.scans, [root]: scan } });
        return;
      }
      window.clearInterval(pollers.get(root));
      pollers.delete(root);
      const overview = await api.overview(root).catch(() => null);
      const overviews = { ...state.overviews };
      if (overview) overviews[root] = overview;
      setState({ scans: { ...state.scans, [root]: scan }, overviews, version: state.version + 1 });
      void refreshDisks();
    }, 110),
  );
}

/** Scans the disk the user is looking at again. */
export function rescan() {
  return scanDisk(state.diskRoot);
}

/** Shows another disk. It is scanned the first time it is opened. */
export function selectDisk(root: string) {
  if (root === state.diskRoot) return;
  const disk = state.disks.find((d) => d.root === root);
  setState({ diskRoot: root, folderPath: disk?.system && state.meta ? state.meta.home : root, view: state.view === "apps" || state.view === "cleanup" || state.view === "bloat" ? "overview" : state.view });
  if (!state.scans[root] || state.scans[root].state === "idle") void scanDisk(root);
}

async function refreshAfterChange() {
  const roots = Object.keys(state.overviews);
  const fresh = await Promise.all(roots.map((root) => api.overview(root).catch(() => null)));
  const overviews = { ...state.overviews };
  roots.forEach((root, i) => {
    if (fresh[i]) overviews[root] = fresh[i]!;
  });
  await Promise.all([refreshLists(), refreshDisks()]);
  setState({ overviews, version: state.version + 1 });
}

// ---------------------------------------------------------------------------
// Bloat Scanner
// ---------------------------------------------------------------------------

export async function scanBloat() {
  if (state.bloatBusy) return;
  setState({ bloatBusy: true });
  const started = Date.now();
  try {
    const bloat = await api.bloatScan();
    // Long enough to see what is being looked at.
    await new Promise((r) => setTimeout(r, Math.max(0, 1400 - (Date.now() - started))));
    setState({ bloat });
  } catch (error) {
    toast(t("toast.error", { error: String(error) }), "warn");
  } finally {
    setState({ bloatBusy: false });
  }
}

/** After an action in the Bloat Scanner: look again, quietly. */
export async function refreshBloat() {
  try {
    setState({ bloat: await api.bloatScan() });
  } catch {
    /* keep what is shown */
  }
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
