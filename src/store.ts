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
import { SAMPLE_CPU, SAMPLE_NET } from "./mock";
import { listIssues, type Issue } from "./findings";
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
  /** Is a malware scan one of the steps of the check-up that is running? */
  withMalware: boolean;
}

/** Deleting goes on in the background: how far it is. */
export interface Deleting {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  /** All through: shown for a moment, then gone. */
  finished: boolean;
}

/** Fixing what a scan found, in the background. */
export interface Fixing {
  done: number;
  total: number;
  finished: boolean;
}

/** What is remembered of the last finished malware scan (kept between starts). */
export interface LastScan {
  at: number;
  scope: ScanScope;
  files: number;
  threats: number;
}

const LAST_SCAN_KEY = "roomy.lastScan";
const KNOWN_THREATS_KEY = "roomy.threats";
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
  /** Bytes per second coming in, reading by reading. */
  netHistory: number[];
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
  deleting: Deleting | null;
  /** Paths that are queued to be deleted: lists leave them out at once. */
  pending: Set<string>;
  fixing: Fixing | null;
  /** Findings waiting for a yes before they are all fixed. */
  fixAsk: Issue[] | null;
  /** The one finding whose button was pressed and that is being dealt with. */
  fixingOne: { id: string; name: string } | null;
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
  netHistory: [],
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
  check: { running: false, step: 0, at: null, complete: false, withMalware: false },
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
  pending: new Set(),
  fixing: null,
  fixAsk: null,
  fixingOne: null,
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
  setState({ meta, lang, disks, diskRoot, folderPath: meta.home, cpuHistory: meta.demo ? SAMPLE_CPU.slice(0, -1) : [], netHistory: meta.demo ? SAMPLE_NET.slice(0, -1) : [] });
  void refreshLists();
  void pollHealth(true);
  // The check-up runs by itself once at the start: Health then says how things are without a click.
  void checkAll();
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
  if (state.bloatBusy || busyNow()) return;
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
let lastReading = 0;
/** Longer than this between two readings and the curve starts over: nobody was looking in between. */
const READING_GAP = 12_000;

/** Reads the live numbers. The regular refresh rests while nobody is looking. */
async function pollHealth(always = false) {
  if (document.hidden && !always) return;
  try {
    const health = await api.health();
    healthReadings += 1;
    const now = Date.now();
    const paused = lastReading > 0 && now - lastReading > READING_GAP && !state.meta?.demo;
    lastReading = now;
    // The very first reading is Roomy starting up, not the computer at work: it is shown, but not drawn.
    const first = healthReadings === 1 && !state.meta?.demo;
    if (paused) {
      // After a pause the curves start over ("busy for over a minute" must
      // be a minute on end), and the network rate of this one reading is
      // the average over the pause, not what is going on now.
      setState({ health: { ...health, netDown: state.health?.netDown ?? 0, netUp: state.health?.netUp ?? 0 }, cpuHistory: [health.cpu], netHistory: [] });
      // Look again shortly: that reading is about now.
      window.setTimeout(() => void pollHealth(always), 1200);
      return;
    }
    const cpuHistory = first ? state.cpuHistory : [...state.cpuHistory, health.cpu].slice(-CPU_POINTS);
    const netHistory = first ? state.netHistory : [...state.netHistory, health.netDown].slice(-CPU_POINTS);
    setState({ health, cpuHistory, netHistory });
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
    else rememberThreats(malware);
  } catch {
    /* an older backend: the tab says so */
  }
}

/**
 * Files a scan found and that are still there. The next start looks at them
 * again wherever they are, so a finding of a deep scan does not vanish
 * behind a quick one. (Microsoft Defender keeps its own record.)
 */
function knownThreats(): string[] {
  if (state.meta?.demo) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(KNOWN_THREATS_KEY) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  } catch {
    return [];
  }
}

function rememberThreats(malware: MalwareStatus) {
  // Only a scan that ran to its end knows what is still there.
  if (state.meta?.demo || malware.engine.engine !== "xprotect" || malware.state !== "done" || malware.cancelled) return;
  try {
    localStorage.setItem(KNOWN_THREATS_KEY, JSON.stringify(malware.threats.filter((x) => !x.handled).map((x) => x.path)));
  } catch {
    /* private mode */
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
        rememberThreats(malware);
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
    await api.malwareStart(scope, knownThreats());
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
 * scan of the Bloat Scanner), then a malware scan. `scope` is how far that
 * one looks. `thorough` also runs it where it is not Roomy's own and takes
 * minutes (Microsoft Defender); the check-up at the start leaves that out.
 */
export async function checkAll(scope: ScanScope = "quick", thorough = false) {
  if (state.check.running || fixingNow()) return;
  const before = state.check;
  let withMalware = before.withMalware;
  const step = (n: number) => setState({ check: { ...before, running: true, step: n, withMalware } });
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Said before the first question to the backend, so that a second click finds it running.
  step(0);
  // The first three steps are one scan: let them tick by while it runs.
  const ticking = window.setInterval(() => state.check.running && state.check.step < 2 && step(state.check.step + 1), 380);
  try {
    const started = Date.now();
    if (!state.malware) await loadMalware();
    const engine = state.malware?.engine;
    withMalware = !!engine?.available && (engine.engine === "xprotect" || (engine.engine === "defender" && thorough));
    step(state.check.step);
    const bloat = await api.bloatScan();
    await pause(Math.max(0, 1200 - (Date.now() - started)));
    window.clearInterval(ticking);
    setState({ bloat });
    let complete = true;
    if (withMalware) {
      step(3);
      const scanned = Date.now();
      // A scan that is running already is waited for rather than doubled.
      let result = state.malware?.state === "scanning" ? await followScan() : await scanMalware(scope);
      // But a quick one that happened to be running is no answer to "look everywhere".
      if (scope === "full" && result?.state === "done" && !result.cancelled && result.scope !== "full") result = await scanMalware(scope);
      complete = result?.state === "done" && !result.cancelled;
      await pause(Math.max(0, 500 - (Date.now() - scanned)));
    }
    setState({ check: { running: false, step: 0, at: Date.now(), complete, withMalware } });
  } catch (error) {
    toast(t("toast.error", { error: String(error) }), "warn");
    setState({ check: { ...before, running: false } });
  } finally {
    window.clearInterval(ticking);
  }
}

// ---------------------------------------------------------------------------
// Fixing what the scans found
// ---------------------------------------------------------------------------

/** Something is being fixed right now: one finding or a whole list. */
const fixingNow = () => state.fixingOne !== null || (state.fixing !== null && !state.fixing.finished);

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What the scans say right now. */
const currentIssues = () => listIssues({ malware: state.malware, bloat: state.bloat, intended: state.intended, windows: isWin() });

/** An error as a sentence: without the "Error:" JavaScript puts in front, and with words for the codes of the backend. */
function reason(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error).replace(/^Error:\s*/, "");
  return text === "protected" ? t("fix.protected") : text;
}

/** Does what one finding needs. Throws when it could not be done. */
async function fixOne(issue: Issue) {
  if (issue.defender) {
    // Microsoft Defender removes all it lists as active (Windows asks for an administrator first).
    const malware = await api.malwareClean();
    setState({ malware });
    if (malware.threats.some((x) => !x.handled)) throw new Error(t("fix.defender.left"));
  } else if (issue.threat) {
    const threat = issue.threat;
    if (threat.pids.length > 0) {
      await api.malwareQuit(threat.pids);
      await settle(400);
    }
    const [outcome] = await api.deleteItems([{ path: threat.container ?? threat.path, mode: "trash" }]);
    if (!outcome?.ok) throw new Error(outcome?.error ?? "not deleted");
  } else if (issue.unwanted) {
    const item = issue.unwanted;
    if (item.running && item.pids.length > 0) {
      await api.bloatQuit(item.pids);
      await settle(400);
    }
    if (item.removal === "trash") {
      // The app and what it left in the Library, like the delete dialog does by default.
      const related = await api.appRelated(item.target).catch(() => []);
      const [outcome] = await api.deleteItems([{ path: item.target, mode: "trash" }, ...related.map((r) => ({ path: r.path, mode: "trash" as const }))]);
      if (!outcome?.ok) throw new Error(outcome?.error ?? "not deleted");
    } else if (item.removal === "package") {
      await api.bloatRemovePackage(item.target);
    } else if (item.removal === "uninstaller") {
      await api.uninstallApp(item.target);
    }
  } else if (issue.startup) {
    if (issue.startup.canDisable) await api.bloatDisableStartup(issue.startup.id);
    else await api.openSettings("loginItems");
  } else if (issue.setting) {
    await api.openSettings(issue.setting.id);
  }
}

/** Something is being fixed or checked: nothing else that changes the same lists should start. */
export const busyNow = () => fixingNow() || state.check.running;

/** The finding with this id, as the scans see it right now. */
export const findIssue = (id: string): Issue | undefined => currentIssues().find((i) => i.id === id);

/**
 * Looks again after a fix and says which of `ids` are still on the list:
 * those were not fixed. A program that was asked to quit may take a moment
 * longer than the first look, so what is still there gets a second one.
 */
async function stillThere(ids: string[]): Promise<Set<string>> {
  await afterFix();
  let left = new Set(currentIssues().map((i) => i.id));
  if (ids.some((id) => left.has(id))) {
    await settle(1500);
    await afterFix();
    left = new Set(currentIssues().map((i) => i.id));
  }
  return new Set(ids.filter((id) => left.has(id)));
}

/** One finding, right away (the button in its row). */
export async function fixIssue(issue: Issue) {
  if (busyNow()) return;
  // More goes than the one file the row is about, or it cannot be taken back: said and asked first.
  if (issue.ask) {
    setState({ fixAsk: [issue] });
    return;
  }
  if (issue.fix === "manual") {
    // A window of the system, or the program's own uninstaller: Roomy opens it, the rest is the user's.
    try {
      await fixOne(issue);
      if (issue.unwanted) {
        toast(t("apps.uninstallStarted", { name: issue.name }));
        // Back from the uninstaller: look whether it is gone.
        window.addEventListener("focus", () => void afterFix(), { once: true });
      }
    } catch (error) {
      toast(t("toast.error", { error: reason(error) }), "warn");
    }
    return;
  }
  setState({ fixingOne: { id: issue.id, name: issue.name } });
  try {
    let failed: string | null = null;
    try {
      await fixOne(issue);
    } catch (error) {
      failed = reason(error);
    }
    // The scan that follows has the last word: what is still on the list was not fixed.
    const left = await stillThere([issue.id]);
    if (failed === null && left.has(issue.id)) failed = "";
    // Microsoft Defender's findings are a group with a sentence of their own.
    if (issue.defender) toast(failed === null ? t("fix.defender.done") : failed || t("fix.defender.left"), failed === null ? "ok" : "warn");
    else if (failed === null) toast(t("fix.one", { name: issue.name }));
    else toast([t("fix.failedOne", { name: issue.name }), failed].filter(Boolean).join(" "), "warn");
  } finally {
    setState({ fixingOne: null });
  }
}

async function afterFix() {
  await Promise.all([refreshBloat(), loadMalware(), refreshAfterChange()]);
}

/** Startup entries first: once the app they belong to is in the Trash, there is nothing left to switch off properly. */
const FIX_ORDER: Record<Issue["kind"], number> = { startup: 0, threat: 1, unwanted: 2, setting: 3 };

/**
 * Everything on `list` that Roomy can fix by itself, one after the other,
 * in the background. What needs the user (a system window) is left alone.
 */
export async function fixIssues(list: Issue[]) {
  const auto = list.filter((i) => i.fix === "auto").sort((a, b) => FIX_ORDER[a.kind] - FIX_ORDER[b.kind]);
  setState({ fixAsk: null });
  if (auto.length === 0 || busyNow()) return;
  setState({ fixing: { done: 0, total: auto.length, finished: false } });
  try {
    const failed = new Set<string>();
    for (const [n, issue] of auto.entries()) {
      try {
        await fixOne(issue);
      } catch (error) {
        failed.add(issue.id);
        // Said in words where there is something to say (Windows was told no, for one).
        if (issue.defender) toast(reason(error), "warn");
      }
      setState({ fixing: { done: n + 1, total: auto.length, finished: false } });
    }
    // The scan that follows has the last word: what is still on the list was not fixed.
    for (const id of await stillThere(auto.map((i) => i.id))) failed.add(id);
    const fixed = auto.length - failed.size;
    if (fixed > 0) toast(tn("fix.done", fixed));
    if (failed.size > 0) toast(tn("fix.failed", failed.size), "warn");
  } finally {
    setState({ fixing: { done: auto.length, total: auto.length, finished: true } });
    window.setTimeout(() => state.fixing?.finished && setState({ fixing: null }), 1800);
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

/** The row that was ticked last, per list: a tick with Shift then takes everything in between. */
const lastTick = new Map<string, string>();

/**
 * Ticks `items[index]`. With Shift it ticks (or unticks) the whole stretch
 * from the last tick in the same list to this one, as far as that row is
 * still among `items` (the rows on screen): another folder, another filter
 * or another order start over.
 */
export function tickRow(list: string, items: SelItem[], index: number, shift: boolean) {
  const item = items[index];
  if (!item) return;
  const anchor = lastTick.get(list);
  const from = shift && anchor !== undefined ? items.findIndex((x) => x.path === anchor) : -1;
  const turnOn = !state.selection.has(item.path);
  if (from >= 0 && from !== index) {
    setSelected(items.slice(Math.min(from, index), Math.max(from, index) + 1), turnOn);
  } else {
    toggleSelect(item);
  }
  lastTick.set(list, item.path);
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
  window.setTimeout(() => dismissToast(id), action ? 15000 : 4500);
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

/** One thing on its way out, and how big it is (for the progress). */
export interface Outgoing {
  request: DeleteRequest;
  size: number;
}

const queue: Outgoing[] = [];
let handled: { request: DeleteRequest; outcome: DeleteOutcome }[] = [];
let working = false;

/**
 * Deletes in the background. The call comes back at once: what is queued
 * disappears from the lists and from the selection, and a ring in the
 * corner shows how far it is. More can be added while it runs.
 */
export function queueDelete(items: Outgoing[]) {
  if (items.length === 0) return;
  queue.push(...items);
  const pending = new Set(state.pending);
  const selection = new Map(state.selection);
  for (const item of items) {
    pending.add(item.request.path);
    selection.delete(item.request.path);
  }
  const before = state.deleting && !state.deleting.finished ? state.deleting : { done: 0, total: 0, bytesDone: 0, bytesTotal: 0, finished: false };
  setState({
    pending,
    selection,
    confirmOpen: false,
    deleting: { ...before, total: before.total + items.length, bytesTotal: before.bytesTotal + items.reduce((sum, i) => sum + i.size, 0) },
  });
  if (!working) void workOff();
}

/** Stops after the item that is being deleted right now; the rest stays where it is. */
export function cancelDelete() {
  if (queue.length === 0 || !state.deleting) return;
  const pending = new Set(state.pending);
  for (const item of queue) pending.delete(item.request.path);
  queue.length = 0;
  // What is left to do is the one item on its way out, if there is one.
  const d = state.deleting;
  setState({ pending, deleting: { ...d, total: d.done + (inFlight ? 1 : 0), bytesTotal: d.bytesDone + (inFlight?.size ?? 0) } });
}

/** The item the backend is deleting right now. */
let inFlight: Outgoing | null = null;

async function workOff() {
  working = true;
  try {
    while (queue.length > 0) {
      const item = queue.shift()!;
      inFlight = item;
      let outcome: DeleteOutcome;
      try {
        [outcome] = await api.deleteItems([item.request]);
      } catch (error) {
        outcome = { path: item.request.path, ok: false, error: String(error), freed: 0, trashed: false, skipped: 0 };
      }
      inFlight = null;
      handled.push({ request: item.request, outcome });
      const d = state.deleting;
      if (d) setState({ deleting: { ...d, done: d.done + 1, bytesDone: d.bytesDone + item.size } });
    }
    const outcomes = handled.map((x) => x.outcome);

    // A threat that was removed is no longer one.
    const gone = new Set(outcomes.filter((o) => o.ok).map((o) => o.path));
    if (state.malware?.threats.some((x) => gone.has(x.container ?? x.path))) {
      const malware = { ...state.malware, threats: state.malware.threats.filter((x) => !gone.has(x.container ?? x.path)) };
      setState({ malware });
      // What is remembered for the next start must not keep counting it either.
      if (state.lastScan) rememberScan({ ...state.lastScan, threats: malware.threats.filter((x) => !x.handled && !x.test).length });
      rememberThreats(malware);
    }

    // The lists are read again. Unwanted software that went this way is off its list too.
    const unwanted = state.bloat?.unwanted.some((u) => u.removal === "trash" && gone.has(u.target)) ?? false;
    await Promise.all([refreshAfterChange(), unwanted ? refreshBloat() : null]);
  } catch (error) {
    // Should not happen. If it does, nothing stays hidden and nothing is tried again by itself.
    queue.length = 0;
    handled = [];
    inFlight = null;
    working = false;
    setState({ pending: new Set(), deleting: null });
    toast(t("toast.error", { error: reason(error) }), "warn");
    void refreshAfterChange();
    return;
  } finally {
    inFlight = null;
    working = false;
  }
  // More was added while the lists were read again: carry on, the ring stays.
  if (queue.length > 0) {
    void workOff();
    return;
  }
  const done = handled;
  handled = [];

  const outcomes = done.map((x) => x.outcome);
  const trashed = outcomes.filter((o) => o.ok && o.trashed).reduce((sum, o) => sum + o.freed, 0);
  const freed = outcomes.filter((o) => o.ok && !o.trashed).reduce((sum, o) => sum + o.freed, 0);
  const failed = outcomes.filter((o) => !o.ok).length;
  const skipped = outcomes.some((o) => o.ok && o.skipped > 0);
  const emptiedTrash = done.some((x) => x.request.path === TRASH_TOKEN || x.request.mode === "emptyTrash");

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

  // What could not be deleted is back in its list.
  const d = state.deleting;
  setState({ pending: new Set(), deleting: d ? { ...d, done: d.total, bytesDone: d.bytesTotal, finished: true } : null });
  window.setTimeout(() => state.deleting?.finished && setState({ deleting: null }), 1800);
}

export function dismissFda() {
  try {
    localStorage.setItem("roomy.fdaDismissed", "1");
  } catch {
    /* private mode */
  }
  setState({ fdaDismissed: true });
}
