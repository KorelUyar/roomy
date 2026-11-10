import { getLocale, t } from "./i18n";

let unitBase = 1000;
let homeDir = "";
let pathSep = "/";

/** macOS counts in powers of 1000, Windows in powers of 1024. Match the OS. */
export function configureFormat(platform: string, home: string) {
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
