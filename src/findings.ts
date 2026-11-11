// What counts as "something to look at", what can be done about it, and how
// much it takes off the health of the computer. One place, so the Health
// tab, Protection, the sidebar and the fix button always agree.

import type { BloatReport, DiskInfo, Health, MalwareStatus, SecurityCheck, StartupItem, Threat, Unwanted } from "./api";
import { baseName, formatBytes, formatPercent, shortPath } from "./format";
import { hasText, t, tn, tx } from "./i18n";
import type { View } from "./store";

/** Protections of the system that are off and that the user has not said they want that way. */
export const securityToCheck = (bloat: BloatReport | null, intended: string[]): SecurityCheck[] =>
  bloat?.security.filter((c) => c.status === "warn" && !intended.includes(c.id)) ?? [];

/** Startup items that still start and are more than just unsigned: unwanted, left over, or in an odd place. */
export const flaggedStartup = (bloat: BloatReport | null): StartupItem[] => bloat?.startup.filter((i) => i.enabled && i.flags.some((f) => f !== "unsigned")) ?? [];

/** Files that match a malware signature and are still there (Microsoft Defender deals with its own; the test file is no threat). */
export const openThreats = (malware: MalwareStatus | null): Threat[] => malware?.threats.filter((x) => !x.handled && !x.test) ?? [];

/** The harmless test file, when a scan found it and it is still there. */
export const testFiles = (malware: MalwareStatus | null): Threat[] => malware?.threats.filter((x) => x.test && !x.handled) ?? [];

/** Unwanted software that is a risk or a nuisance, as opposed to what merely came with the computer (a matter of taste). */
export const harmful = (bloat: BloatReport | null): Unwanted[] => bloat?.unwanted.filter((u) => u.reason === "adware" || u.reason === "pup") ?? [];

/** Share of a disk that is in use, 0–100. */
export const usedPercent = (disk: DiskInfo | null | undefined): number => (disk && disk.total > 0 ? (disk.used / disk.total) * 100 : 0);

/** "warn" when less than a tenth is free, "bad" below a twentieth. */
export function diskTone(disk: DiskInfo | null | undefined): "" | "warn" | "bad" {
  if (!disk || disk.total <= 0) return "";
  const free = disk.free / disk.total;
  return free < 0.05 ? "bad" : free < 0.1 ? "warn" : "";
}

/** The name of a security setting, as its system calls it. */
export function securityTitle(check: SecurityCheck, windows: boolean): string {
  return tx(hasText(`sec.${check.id}.title`) ? `sec.${check.id}.title` : `sec.${check.id}.title.${windows ? "win" : "mac"}`);
}

/** What the state of a security setting means, in a sentence. */
export function securityText(check: SecurityCheck): string {
  // "Last update installed 12 days ago" when the system told us a number.
  const withDays = `sec.${check.id}.${check.status}Days`;
  const plain = `sec.${check.id}.${check.status}`;
  if (check.status === "unknown") return t("sec.unknown");
  if (check.detail && hasText(withDays)) return tx(withDays, { days: check.detail });
  return hasText(plain) ? tx(plain) : "";
}

// ---------------------------------------------------------------------------
// What a scan found, and what can be done about each
// ---------------------------------------------------------------------------

export interface Issue {
  id: string;
  kind: "threat" | "unwanted" | "startup" | "setting";
  tone: "bad" | "warn";
  name: string;
  /** One word in colour: why it is on the list. */
  tag: string | null;
  detail: string;
  /** A file to show the icon of. Without one the row gets the sign of its kind. */
  icon: string | null;
  /** Roomy can do it by itself, or it takes the user in a window of the system. */
  fix: "auto" | "manual";
  /** What the button says. */
  action: string;
  /** What will happen, spelled out (for the question before everything is fixed). */
  does: string;
  /** How loud the word in colour is: a signature match, something unwanted, or merely a note. */
  weight: "bad" | "warn" | "note";
  /**
   * Yours to decide: something that came with the computer, and whose removal
   * cannot be taken back. "Fix all" leaves it unticked.
   */
  optional: boolean;
  /** The button in the row asks first: more goes than the row's one file (a whole app, which is quit before). */
  ask: boolean;
  threat?: Threat;
  /** Everything Microsoft Defender has found and not dealt with: it removes all of it or none. */
  defender?: Threat[];
  unwanted?: Unwanted;
  startup?: StartupItem;
  setting?: SecurityCheck;
}

export function listIssues(s: { malware: MalwareStatus | null; bloat: BloatReport | null; intended: string[]; windows: boolean }): Issue[] {
  const out: Issue[] = [];
  const open = s.malware?.state === "done" ? s.malware.threats.filter((x) => !x.handled) : [];

  if (s.malware?.engine.engine === "defender") {
    // Microsoft Defender's command to remove takes no name: it is all of them
    // or none. One line, then, that says so, and not a button per file that
    // would do more than it says.
    if (open.length > 0) {
      const signatures = [...new Set(open.map((x) => x.signature))];
      out.push({
        id: "defender",
        kind: "threat",
        tone: "bad",
        name: tn("fix.defender.name", open.length),
        tag: null,
        detail: signatures.slice(0, 3).join(", ") + (signatures.length > 3 ? " …" : ""),
        icon: null,
        fix: "auto",
        action: t(open.length > 1 ? "fix.defender.action" : "bloat.remove"),
        does: t("fix.does.defender"),
        weight: "bad",
        optional: false,
        ask: false,
        defender: open,
      });
    }
  } else {
    // The app a file sits in is what goes: then the row is about the app,
    // one row however many of its files matched. A real match decides what
    // the row says, not a test file beside it.
    const appOf = (x: Threat) => (x.container && x.container !== x.path ? x.container : null);
    const rows = new Map<string, Threat>();
    for (const threat of open) {
      const id = `threat:${appOf(threat) ?? threat.path}`;
      const first = rows.get(id);
      if (!first || (first.test && !threat.test)) rows.set(id, threat);
    }
    for (const [id, threat] of rows) {
      const app = appOf(threat);
      out.push({
        id,
        kind: "threat",
        tone: threat.test ? "warn" : "bad",
        name: app ? baseName(app).replace(/\.app$/i, "") : threat.name,
        tag: threat.test ? t("protection.threat.test") : threat.signature,
        detail: app ? t("fix.inApp", { file: threat.name, path: shortPath(app) }) : shortPath(threat.path),
        icon: app ?? threat.path,
        fix: "auto",
        action: t(app ? "fix.trashApp" : "confirm.trash"),
        does: app ? t(threat.pids.length > 0 ? "fix.does.quitTrashApp" : "fix.does.trashApp") : t(threat.pids.length > 0 ? "fix.does.quitTrash" : "fix.does.trash"),
        weight: threat.test ? "note" : "bad",
        optional: false,
        ask: app !== null,
        threat,
      });
    }
  }

  for (const item of s.bloat?.unwanted ?? []) {
    const manual = item.removal === "uninstaller";
    // Adware and its kind are a finding. What came with the computer is a matter of taste.
    const taste = item.reason === "bundled" || item.reason === "promo";
    out.push({
      id: `unwanted:${item.id}`,
      kind: "unwanted",
      tone: "warn",
      name: item.name,
      tag: tx(`bloat.reason.${item.reason}`),
      detail: [item.running ? t("bloat.running") : null, item.path ? shortPath(item.path) : null, item.size > 0 ? formatBytes(item.size) : null].filter(Boolean).join("  ·  "),
      icon: item.icon || null,
      fix: manual ? "manual" : "auto",
      action: manual ? `${t("apps.uninstall")}…` : item.removal === "none" ? t("bloat.quit") : t("bloat.remove"),
      does: manual ? t("fix.does.uninstaller") : item.removal === "none" ? t("fix.does.quit") : item.removal === "package" ? t("fix.does.package") : t(item.running ? "fix.does.quitTrashData" : "fix.does.trashData"),
      weight: taste ? "note" : "warn",
      // A Store app that is removed is gone with its data: never part of "all" unasked,
      // and its own button asks too.
      optional: item.removal === "package",
      ask: item.removal === "package",
      unwanted: item,
    });
  }

  for (const item of flaggedStartup(s.bloat)) {
    const reason = (["unwanted", "suspicious", "leftover"] as const).find((flag) => item.flags.includes(flag))!;
    out.push({
      id: `startup:${item.id}`,
      kind: "startup",
      tone: "warn",
      name: item.name,
      tag: tx(`bloat.flag.${reason}`),
      detail: [tx(`bloat.kind.${item.kind}`), tx(`bloat.flag.${reason}Hint`)].join("  ·  "),
      icon: item.icon || null,
      fix: item.canDisable ? "auto" : "manual",
      action: item.canDisable ? t("bloat.disable") : t("bloat.manage"),
      does: item.canDisable ? t("fix.does.startup") : t("fix.does.settings"),
      weight: reason === "leftover" ? "note" : "warn",
      optional: false,
      ask: false,
      startup: item,
    });
  }

  for (const check of securityToCheck(s.bloat, s.intended)) {
    out.push({
      id: `setting:${check.id}`,
      kind: "setting",
      tone: "warn",
      name: securityTitle(check, s.windows),
      tag: null,
      detail: securityText(check),
      icon: null,
      fix: "manual",
      action: t("bloat.security.open"),
      does: t("fix.does.settings"),
      weight: "warn",
      optional: false,
      ask: false,
      setting: check,
    });
  }
  return out;
}

/** What "Fix N things" does without being told more: all Roomy can do itself and take back. */
export const fixableByDefault = (issues: Issue[]): Issue[] => issues.filter((i) => i.fix === "auto" && !i.optional);

// ---------------------------------------------------------------------------
// The health of the computer as one number
// ---------------------------------------------------------------------------

/** Something that takes points off, with the reason in words. */
export interface Deduction {
  key: string;
  points: number;
  /** How many separate things it stands for (two unwanted programs are two). */
  count: number;
  tone: "warn" | "bad";
  title: string;
  text: string;
  view?: View;
}

export interface Score {
  /** 100 = nothing wrong that Roomy can see. */
  value: number;
  level: "great" | "good" | "fair" | "poor";
  deductions: Deduction[];
}

/**
 * 100 minus what is wrong. Every point that is taken off is listed with its
 * reason, so the number is a summary of the list and nothing more. The
 * weights are a judgement: what loses data or lets someone in costs most,
 * what merely slows things down costs little.
 */
export function healthScore(s: {
  health: Health | null;
  disk: DiskInfo | null;
  bloat: BloatReport | null;
  malware: MalwareStatus | null;
  intended: string[];
  cpuHistory: number[];
}): Score {
  const list: Deduction[] = [];
  const add = (key: string, points: number, tone: "warn" | "bad", title: string, text: string, view?: View, count = 1) => list.push({ key, points, count, tone, title, text, view });

  const threats = openThreats(s.malware).length;
  if (threats > 0) add("malware", Math.min(60, 35 + 10 * (threats - 1)), "bad", t("health.malware"), tn("health.malware.found", threats), "protection", threats);

  if (s.health?.diskHealth === "failing") add("drive", 40, "bad", t("health.drive"), t("health.drive.failing"));

  const storage = diskTone(s.disk);
  if (storage && s.disk) {
    add("storage", storage === "bad" ? 20 : 10, storage, t("health.storage"), `${t("health.storage.low")}: ${t("disk.freeOf", { free: formatBytes(s.disk.free), total: formatBytes(s.disk.total) })}`, "overview");
  }

  if (s.health?.pressure === "critical") add("memory", 18, "bad", t("health.memory"), tx("health.pressure.critical"));
  else if (s.health?.pressure === "warn") add("memory", 8, "warn", t("health.memory"), tx("health.pressure.warn"));

  if (s.health?.thermal === "critical") add("thermal", 18, "bad", t("health.thermal"), t("health.thermal.critical"));
  else if (s.health?.thermal === "serious") add("thermal", 8, "warn", t("health.thermal"), t("health.thermal.serious"));

  // Busy for a minute and a half on end, not for a moment.
  const recent = s.cpuHistory.slice(-36);
  if (recent.length >= 36 && recent.reduce((sum, v) => sum + v, 0) / recent.length >= 90) add("cpu", 5, "warn", t("health.cpu"), t("health.cpu.busy"));

  const battery = s.health?.battery;
  if (battery?.condition === "service") add("battery", 12, "warn", t("health.battery"), t("health.battery.service"));
  else if (battery?.maxCapacity != null && battery.maxCapacity < 80) add("battery", 5, "warn", t("health.battery"), t("health.battery.capacity", { percent: formatPercent(battery.maxCapacity) }));

  const settings = securityToCheck(s.bloat, s.intended).length;
  if (settings > 0) add("security", Math.min(15, 5 * settings), "warn", t("health.security"), tn("health.security.warn", settings), "protection", settings);

  // What merely came with the computer is listed, but costs nothing: it does no harm.
  const unwanted = harmful(s.bloat).length;
  if (unwanted > 0) add("unwanted", Math.min(16, 8 * unwanted), "warn", t("health.unwanted"), tn("health.unwanted.found", unwanted), "protection", unwanted);

  const startup = flaggedStartup(s.bloat).length;
  if (startup > 0) add("startup", Math.min(12, 4 * startup), "warn", t("health.startup"), tn("health.startup.flagged", startup), "protection", startup);

  const value = Math.max(0, 100 - list.reduce((sum, d) => sum + d.points, 0));
  // "Excellent" is for a list with nothing on it, not for a small sum.
  return { value, level: list.length === 0 ? "great" : value >= 75 ? "good" : value >= 50 ? "fair" : "poor", deductions: list };
}
