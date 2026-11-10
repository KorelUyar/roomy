// Types shared with the Rust side (see core/src) and the three ways to reach
// a backend: the desktop app, the HTTP dev bridge, or built-in sample data.

import { createMock } from "./mock";

export type Platform = "macos" | "windows" | "linux";

export interface AppMeta {
  platform: Platform;
  version: string;
  home: string;
  root: string;
  locale: string;
  fullDiskAccess: boolean;
  demo: boolean;
  shotsDir: string | null;
}

export interface DiskInfo {
  /** Mount point: "/", "/Volumes/Backup", "C:\\", "D:\\". */
  root: string;
  name: string;
  total: number;
  free: number;
  used: number;
  /** The disk the operating system runs from. */
  system: boolean;
  removable: boolean;
}

export interface ScanStatus {
  state: "idle" | "scanning" | "done";
  files: number;
  bytes: number;
  current: string;
}

export type Kind =
  | "folder"
  | "app"
  | "package"
  | "video"
  | "image"
  | "audio"
  | "archive"
  | "diskimage"
  | "installer"
  | "document"
  | "data"
  | "other";

export interface Entry {
  name: string;
  path: string;
  parent: string;
  size: number;
  files: number;
  isDir: boolean;
  package: boolean;
  kind: Kind;
  modified: number;
  protected: boolean;
  denied: boolean;
  appData: boolean;
}

export type CategoryId =
  | "apps"
  | "documents"
  | "downloads"
  | "media"
  | "developer"
  | "appData"
  | "otherHome"
  | "otherUsers"
  | "system"
  /** A top-level folder of a disk that is not the system disk (see `name`). */
  | "folder";

export interface Category {
  id: CategoryId;
  name: string | null;
  size: number;
  path: string | null;
}

export interface Overview {
  disk: DiskInfo;
  scanned: number;
  files: number;
  durationMs: number;
  finished: number;
  categories: Category[];
  topFolders: Entry[];
  bigFileCount: number;
  bigFileSize: number;
}

export interface AppInfo {
  id: string;
  name: string;
  path: string;
  icon: string;
  bundleId: string | null;
  version: string | null;
  publisher: string | null;
  size: number;
  lastUsed: number | null;
  installed: number | null;
  removal: "trash" | "uninstaller";
  running: boolean;
  store: boolean;
}

export interface RelatedItem {
  path: string;
  size: number;
  kind: "support" | "cache" | "preferences" | "container" | "logs" | "state" | "other";
}

export interface CleanItem {
  path: string;
  name: string;
  size: number;
  modified: number;
  kind: Kind;
}

export type CleanGroupId =
  | "trash"
  | "caches"
  | "logs"
  | "temp"
  | "developer"
  | "installers"
  | "oldDownloads"
  | "backups";

export type DeleteMode = "trash" | "permanent" | "emptyTrash";

export interface CleanGroup {
  id: CleanGroupId;
  safety: "safe" | "review";
  mode: DeleteMode;
  items: CleanItem[];
  size: number;
  unknown: boolean;
}

export interface DeleteRequest {
  path: string;
  mode: DeleteMode;
  cleanup?: boolean;
}

export interface DeleteOutcome {
  path: string;
  ok: boolean;
  error: string | null;
  freed: number;
  trashed: boolean;
  skipped: number;
}

export interface TrashInfo {
  size: number;
  items: number;
}

export interface Unwanted {
  id: string;
  name: string;
  reason: "adware" | "pup" | "bundled" | "promo";
  path: string;
  icon: string;
  size: number;
  running: boolean;
  pids: number[];
  removal: "trash" | "uninstaller" | "package" | "none";
  target: string;
}

export type StartupFlag = "leftover" | "unsigned" | "suspicious" | "unwanted";

export interface StartupItem {
  id: string;
  name: string;
  label: string;
  program: string;
  source: string;
  scope: "user" | "system";
  kind: "launchAgent" | "launchDaemon" | "backgroundItem" | "runKey" | "startupFolder";
  vendor: string | null;
  running: boolean;
  enabled: boolean;
  flags: StartupFlag[];
  canDisable: boolean;
  icon: string;
}

export type SecurityId =
  | "diskEncryption"
  | "firewall"
  | "gatekeeper"
  | "sip"
  | "updates"
  | "autoLogin"
  | "remoteLogin"
  | "antivirus"
  | "uac"
  | "smartScreen"
  | "remoteDesktop";

export interface SecurityCheck {
  id: SecurityId;
  status: "ok" | "warn" | "info" | "unknown";
  detail: string | null;
}

export interface BloatReport {
  unwanted: Unwanted[];
  startup: StartupItem[];
  security: SecurityCheck[];
  processes: number;
  durationMs: number;
}

export const TRASH_TOKEN = "::trash";

export interface Transport {
  call<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** URL of the system icon for a file, or null when there is none. */
  iconUrl(path: string, size: number): string | null;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
  }
}

const inTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");

function tauriIconUrl(path: string, size: number): string {
  const q = `?p=${encodeURIComponent(path)}&s=${size}`;
  // Custom schemes are served from http://<scheme>.localhost on Windows.
  return navigator.userAgent.includes("Windows") ? `http://roomyicon.localhost/${q}` : `roomyicon://localhost/${q}`;
}

function tauriTransport(): Transport {
  const invoke = window.__TAURI_INTERNALS__!.invoke;
  return {
    call: <T,>(cmd: string, args?: Record<string, unknown>) => invoke("rpc", { cmd, args: args ?? null }) as Promise<T>,
    iconUrl: tauriIconUrl,
  };
}

function bridgeTransport(base: string, token: string): Transport {
  return {
    async call<T>(cmd: string, args?: Record<string, unknown>) {
      const res = await fetch(`${base}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-roomy-token": token },
        body: JSON.stringify({ cmd, args: args ?? null }),
      });
      if (!res.ok) throw new Error(`bridge: ${res.status}`);
      const body = (await res.json()) as { ok?: T; error?: string };
      if (body.error !== undefined) throw new Error(body.error);
      return body.ok as T;
    },
    iconUrl: (path, size) => `${base}/icon?t=${encodeURIComponent(token)}&s=${size}&p=${encodeURIComponent(path)}`,
  };
}

let transport: Transport = (() => {
  const bridge = params.get("bridge");
  if (inTauri) return tauriTransport();
  if (bridge) return bridgeTransport(bridge.replace(/\/$/, ""), params.get("token") ?? "");
  // A plain browser without a backend: show the sample data.
  return createMock({
    platform: (params.get("platform") as Platform) ?? "macos",
    locale: params.get("lang") ?? "en",
    iconBase: params.get("icons"),
  });
})();

/** Swap the real backend for sample data (the app was started with ROOMY_DEMO=1). */
export function switchToDemoData(meta: AppMeta) {
  const real = transport;
  transport = createMock({
    platform: meta.platform,
    locale: meta.locale,
    iconBase: null,
    iconUrl: (path, size) => real.iconUrl(path, size),
    shotsDir: meta.shotsDir,
  });
}

/** Development only: window-level commands that exist in the desktop app. */
export async function debugInvoke(cmd: "debug_snapshot" | "debug_write" | "debug_exit", args?: Record<string, unknown>) {
  if (!inTauri) return;
  await window.__TAURI_INTERNALS__!.invoke(cmd, args);
}

export const api = {
  appInfo: () => transport.call<AppMeta>("app_info"),
  listDisks: () => transport.call<DiskInfo[]>("list_disks"),
  startScan: (root: string) => transport.call<null>("start_scan", { root }),
  scanStatus: (root: string) => transport.call<ScanStatus>("scan_status", { root }),
  overview: (root: string) => transport.call<Overview | null>("get_overview", { root }),
  listDir: (path: string) => transport.call<Entry[]>("list_dir", { path }),
  largeFiles: (root: string, minSize: number, limit: number) => transport.call<Entry[]>("large_files", { root, minSize, limit }),
  listApps: () => transport.call<AppInfo[]>("list_apps"),
  appRelated: (path: string) => transport.call<RelatedItem[]>("app_related", { path }),
  uninstallApp: (id: string) => transport.call<null>("uninstall_app", { id }),
  cleanup: () => transport.call<CleanGroup[]>("cleanup_suggestions"),
  deleteItems: (items: DeleteRequest[]) => transport.call<DeleteOutcome[]>("delete_items", { items }),
  trashInfo: () => transport.call<TrashInfo | null>("trash_info"),
  emptyTrash: () => transport.call<number>("empty_trash"),
  reveal: (path: string) => transport.call<null>("reveal", { path }),
  openPath: (path: string) => transport.call<null>("open_path", { path }),
  openFullDiskAccess: () => transport.call<null>("open_full_disk_access"),
  bloatScan: () => transport.call<BloatReport>("bloat_scan"),
  bloatDisableStartup: (id: string) => transport.call<null>("bloat_disable_startup", { id }),
  bloatQuit: (pids: number[]) => transport.call<number>("bloat_quit", { pids }),
  bloatRemovePackage: (id: string) => transport.call<null>("bloat_remove_package", { id }),
  openSettings: (id: string) => transport.call<null>("open_settings", { id }),
  iconUrl: (path: string, size: number) => transport.iconUrl(path, size),
};
