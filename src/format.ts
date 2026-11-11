import { getLocale, t } from "./i18n";

let unitBase = 1000;
let homeDir = "";
let pathSep = "/";

/** macOS counts in powers of 1000, Windows in powers of 1024. Match the OS. */
export function configureFormat(platform: string, home: string, _lang?: string) {
  unitBase = platform === "windows" ? 1024 : 1000;
  pathSep = platform === "windows" ? "\\" : "/";
  homeDir = home;
}

export const sep = () => pathSep;

export function formatBytes(bytes: number): string {
  const units = ["KB", "MB", "GB", "TB"];
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  let value = bytes / unitBase;
  let unit = 0;
  while (value >= unitBase && unit < units.length - 1) {
    value /= unitBase;
    unit += 1;
  }
  // Two significant steps are enough: 3.4 GB, 34 GB, 340 MB, 12 KB.
  const digits = unit >= 2 && value < 100 ? 1 : unit === 1 && value < 10 ? 1 : 0;
  const number = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: unit >= 2 && value < 100 ? digits : 0,
    maximumFractionDigits: digits,
  }).format(value < 1 && unit === 0 ? 1 : value);
  return `${number} ${units[unit]}`;
}

/** Memory is counted in powers of 1024 everywhere: a "16 GB" computer has 16 × 1024³ bytes. */
export function formatMemory(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) {
    return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: gb < 100 && Math.abs(gb - Math.round(gb)) > 0.04 ? 1 : 0 }).format(gb)} GB`;
  }
  return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024 ** 2))} MB`;
}

/** 12.4 → "12%" (written the way the language writes it). */
export function formatPercent(value: number, digits = 0): string {
  return new Intl.NumberFormat(getLocale(), { style: "percent", maximumFractionDigits: digits }).format(value / 100);
}

/** How long something has been going on, roughly: "3 days", "5 hours", "12 minutes". */
export function formatDuration(seconds: number): string {
  const [value, unit] = seconds >= 2 * 86400 ? [seconds / 86400, "day"] : seconds >= 2 * 3600 ? [seconds / 3600, "hour"] : [Math.max(1, seconds / 60), "minute"];
  return new Intl.NumberFormat(getLocale(), { style: "unit", unit, unitDisplay: "long", maximumFractionDigits: 0 }).format(Math.floor(value));
}

/** How long a scan took: "0.9 sec", "14 sec", "2 min 5 sec". */
export function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  const unit = (value: number, name: string, digits = 0) =>
    new Intl.NumberFormat(getLocale(), { style: "unit", unit: name, unitDisplay: "short", maximumFractionDigits: digits }).format(value);
  if (seconds < 10) return unit(seconds, "second", 1);
  const whole = Math.round(seconds);
  if (whole < 60) return unit(whole, "second");
  return `${unit(Math.floor(whole / 60), "minute")} ${unit(whole % 60, "second")}`;
}

/** The time of day of a moment (milliseconds since 1970): "14:02", "2:02 PM". */
export function formatClock(ms: number): string {
  return new Intl.DateTimeFormat(getLocale(), { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/** "3 months ago", "yesterday", … from a unix timestamp in seconds. */
export function formatAgo(unixSeconds: number | null): string {
  if (!unixSeconds) return t("time.never");
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  if (days <= 0) return t("time.today");
  if (days < 7) return rtf.format(-days, "day");
  if (days < 31) return rtf.format(-Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(-Math.floor(days / 30.4), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}

/** `/Users/alex/Movies` → `~/Movies` */
export function shortPath(path: string): string {
  // "~" means nothing to Windows users.
  if (pathSep === "\\") return path;
  if (homeDir && path === homeDir) return "~";
  if (homeDir && path.startsWith(homeDir + pathSep)) return "~" + path.slice(homeDir.length);
  return path;
}

export function baseName(path: string): string {
  const trimmed = path.endsWith(pathSep) && path.length > 1 ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf(pathSep);
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

export function parentPath(path: string, root: string): string | null {
  if (path === root) return null;
  const trimmed = path.endsWith(pathSep) ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf(pathSep);
  if (idx < 0) return null;
  const parent = trimmed.slice(0, idx);
  // "C:" → "C:\", "" → "/"
  if (parent.length < root.length) return root;
  return parent;
}

/** Path split into clickable crumbs, starting at the disk root. */
export function crumbs(path: string, root: string): { name: string | null; path: string }[] {
  const out: { name: string | null; path: string }[] = [{ name: null, path: root }];
  if (path === root) return out;
  const rest = path.slice(root.length).split(pathSep).filter(Boolean);
  let current = root;
  for (const part of rest) {
    current = current.endsWith(pathSep) ? current + part : current + pathSep + part;
    out.push({ name: part, path: current });
  }
  return out;
}
