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
  type Consumer,
  type DeleteMode,
  type DeleteOutcome,
  type DeleteRequest,
  type DiskInfo,
  type Health,
  type Kind,
  type MalwareStatus,
  type Overview,
  type ScanScope,
  type ScanStatus,
} from "./api";
import { SAMPLE_CPU } from "./mock";
import { configureFormat, formatBytes } from "./format";
import { initLanguage, setLanguage, t, tn, type Lang } from "./i18n";

export type View = "health" | "overview" | "apps" | "files" | "folders" | "cleanup" | "protection" | "bloat";

/** The check-up of the Health tab: which step it is at, and when it last finished. */
export interface Check {
  running: boolean;
  step: number;
  at: number | null;
  /** Did the last check-up get through all of its steps (a malware scan that was stopped or failed does not count)? */
  complete: boolean;
}

/** What is remembered of the last finished malware scan (kept between starts). */
export interface LastScan {
  at: number;
  scope: ScanScope;
  files: number;
  threats: number;
}

const LAST_SCAN_KEY = "roomy.lastScan";
const INTENDED_KEY = "roomy.intended";
/** How many processor readings the little chart shows. */
export const CPU_POINTS = 40;

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
  /** How the computer is doing right now; refreshed while the Health tab is open. */
  health: Health | null;
  cpuHistory: number[];
  /** Consumers that were asked to quit and have not gone yet (by path). */
  quitting: string[];
  malware: MalwareStatus | null;
  lastScan: LastScan | null;
  check: Check;
  /** Security settings the user said are the way they want them (by id). */
  intended: string[];
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
  view: "health",
  scan: IDLE,
  overview: null,
  bloat: null,
  bloatBusy: false,
  health: null,
  cpuHistory: [],
  quitting: [],
  malware: null,
  lastScan: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_SCAN_KEY) ?? "null") as LastScan | null;
      return saved && typeof saved.at === "number" ? saved : null;
    } catch {
      return null;
    }
  })(),
  check: { running: false, step: 0, at: null, complete: false },
  intended: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(INTENDED_KEY) ?? "[]") as unknown;
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  })(),
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
  // The sample computer comes with a few minutes of processor history.
  setState({ meta, lang, disks, diskRoot, folderPath: meta.home, cpuHistory: meta.demo ? SAMPLE_CPU.slice(0, -1) : [] });
  void refreshLists();
  void pollHealth(true);
  void loadMalware();
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
  if (root === state.diskRoot) {
    // Already the one in view: from a tab that is not about a disk, a click still means "show me this disk".
    if (state.view !== "overview" && state.view !== "files" && state.view !== "folders") setState({ view: "overview" });
    return;
  }
  const disk = state.disks.find((d) => d.root === root);
  setState({ diskRoot: root, folderPath: disk?.system && state.meta ? state.meta.home : root, view: state.view === "files" || state.view === "folders" ? state.view : "overview" });
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
// Health
// ---------------------------------------------------------------------------

let healthTimer = 0;
let healthWatchers = 0;

let healthReadings = 0;

/** Reads the live numbers. The regular refresh rests while nobody is looking. */
async function pollHealth(always = false) {
  if (document.hidden && !always) return;
  try {
    const health = await api.health();
    healthReadings += 1;
    // The very first reading is Roomy starting up, not the computer at work: it is shown, but not drawn.
    const cpuHistory = healthReadings === 1 && !state.meta?.demo ? state.cpuHistory : [...state.cpuHistory, health.cpu].slice(-CPU_POINTS);
    setState({ health, cpuHistory });
  } catch {
    /* keep what is shown */
  }
}

/** Reads the live numbers now, whether or not the window can be seen. */
export const refreshHealth = () => pollHealth(true);

/** Keeps the live numbers fresh while something on screen shows them. Returns how to stop. */
export function watchHealth(): () => void {
  healthWatchers += 1;
  if (healthWatchers === 1) {
    void pollHealth();
    healthTimer = window.setInterval(() => void pollHealth(), 2500);
  }
  return () => {
    healthWatchers -= 1;
    if (healthWatchers === 0) window.clearInterval(healthTimer);
  };
}

/** Asks an app to quit, the polite way: it may still ask to save. */
export async function quitConsumer(consumer: Consumer) {
  setState({ quitting: [...state.quitting, consumer.path] });
  try {
    const asked = await api.healthQuit(consumer.pids);
    if (asked > 0) toast(t("health.quitAsked", { name: consumer.name }));
    else toast(t("health.quitFailed", { name: consumer.name }), "warn");
  } catch (error) {
    toast(t("toast.error", { error: String(error) }), "warn");
  }
  // Give it a moment to go, then look again.
  window.setTimeout(() => {
    setState({ quitting: state.quitting.filter((path) => path !== consumer.path) });
    void pollHealth(true);
  }, 1600);
}

// ---------------------------------------------------------------------------
// Malware scan
// ---------------------------------------------------------------------------

let malwareTimer = 0;
/** The scan being followed right now. There is only ever one: whoever asks again gets the same answer. */
let following: Promise<MalwareStatus | null> | null = null;

/** Which scanner there is, and whether a scan is already running. */
export async function loadMalware() {
  try {
    const malware = await api.malwareStatus();
    setState({ malware });
    if (malware.state === "scanning") void followScan();
  } catch {
    /* an older backend: the tab says so */
  }
}

/** Remembers the outcome of a scan for the next start (not of the sample computer's). */
function rememberScan(lastScan: LastScan) {
  if (!state.meta?.demo) {
    try {
      localStorage.setItem(LAST_SCAN_KEY, JSON.stringify(lastScan));
    } catch {
      /* private mode */
    }
  }
  setState({ lastScan });
}

function followScan(): Promise<MalwareStatus | null> {
  if (following) return following;
  following = new Promise<MalwareStatus | null>((resolve) => {
    malwareTimer = window.setInterval(async () => {
      const malware = await api.malwareStatus().catch(() => null);
      // Answers can overtake each other: only the first one that says "over" ends the following.
      if (!malware || !following) return;
      setState({ malware });
      if (malware.state === "scanning") return;
      window.clearInterval(malwareTimer);
      following = null;
      if (malware.state === "done" && !malware.cancelled) {
        rememberScan({ at: Date.now(), scope: malware.scope, files: malware.files, threats: malware.threats.filter((x) => !x.handled && !x.test).length });
      }
      resolve(malware);
    }, 250);
  });
  return following;
}

/** Starts a scan and resolves when it is over. */
export async function scanMalware(scope: ScanScope): Promise<MalwareStatus | null> {
  if (!state.malware) await loadMalware();
  const before = state.malware;
  if (!before || before.state === "scanning") return null;
  try {
    await api.malwareStart(scope);
  } catch (error) {
    toast(t("toast.error", { error: String(error) }), "warn");
    return null;
  }
  setState({ malware: { ...before, state: "scanning", scope, files: 0, bytes: 0, current: "", skipped: 0, threats: [], durationMs: 0, cancelled: false, error: null } });
  return followScan();
}

export function stopMalwareScan() {
  void api.malwareCancel();
}

/** Roomy scans itself on a Mac; on Windows Microsoft Defender does, and takes its time. */
export function scansQuickly(): boolean {
  return state.malware?.engine.engine === "xprotect" && state.malware.engine.available;
}

/**
 * The check-up: security settings, startup items and unwanted software (one
 * scan of the Bloat Scanner), then a quick malware scan where Roomy does that itself.
 */
export async function checkAll() {
  if (state.check.running) return;
  const before = state.check;
  const step = (n: number) => setState({ check: { ...before, running: true, step: n } });
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  step(0);
  if (!state.malware) await loadMalware();
  // The first three steps are one scan: let them tick by while it runs.
  const ticking = window.setInterval(() => state.check.running && state.check.step < 2 && step(state.check.step + 1), 480);
  try {
    const started = Date.now();
    const bloat = await api.bloatScan();
    await pause(Math.max(0, 1500 - (Date.now() - started)));
    window.clearInterval(ticking);
    setState({ bloat });
    let complete = true;
    if (scansQuickly()) {
      step(3);
      const scanned = Date.now();
      // A scan that is running already (a full one, started in Protection) is waited for rather than doubled.
      const result = state.malware?.state === "scanning" ? await followScan() : await scanMalware("quick");
      complete = result?.state === "done" && !result.cancelled;
      await pause(Math.max(0, 700 - (Date.now() - scanned)));
    }
    setState({ check: { running: false, step: 0, at: Date.now(), complete } });
  } catch (error) {
    toast(t("toast.error", { error: String(error) }), "warn");
    setState({ check: { ...before, running: false } });
  } finally {
    window.clearInterval(ticking);
  }
}

/** "Yes, I want it that way": a security setting stops counting as something to look at (or counts again). */
export function toggleIntended(id: string) {
  const intended = state.intended.includes(id) ? state.intended.filter((x) => x !== id) : [...state.intended, id];
  try {
    localStorage.setItem(INTENDED_KEY, JSON.stringify(intended));
  } catch {
    /* private mode */
  }
  setState({ intended });
}

/** The security settings come with the Bloat Scanner's report: fetch it quietly when nobody has yet. */
export function ensureBloat() {
  if (!state.bloat && !state.bloatBusy && !state.check.running) void refreshBloat();
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
  // A threat that was removed is no longer one.
  const gone = new Set(outcomes.filter((o) => o.ok).map((o) => o.path));
  if (state.malware?.threats.some((x) => gone.has(x.container ?? x.path))) {
    const threats = state.malware.threats.filter((x) => !gone.has(x.container ?? x.path));
    setState({ malware: { ...state.malware, threats } });
    // What is remembered for the next start must not keep counting it either.
    if (state.lastScan) rememberScan({ ...state.lastScan, threats: threats.filter((x) => !x.handled && !x.test).length });
  }

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
