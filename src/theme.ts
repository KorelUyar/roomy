import type { CategoryId, CleanGroupId } from "./api";

/** One colour per kind of content, used by the disk bar and its legend. */
export const CATEGORY_COLOR: Record<CategoryId, string> = {
  apps: "var(--c-apps)",
  documents: "var(--c-documents)",
  downloads: "var(--c-downloads)",
  media: "var(--c-media)",
  developer: "var(--c-developer)",
  appData: "var(--c-appdata)",
  otherHome: "var(--c-other)",
  otherUsers: "var(--c-users)",
  system: "var(--c-system)",
  folder: "var(--c-apps)",
};

/** Top-level folders of a disk that is not the system disk take these in turn. */
export const FOLDER_COLORS = ["var(--c-apps)", "var(--c-media)", "var(--c-downloads)", "var(--c-documents)", "var(--c-appdata)", "var(--c-developer)"];

export const CLEAN_ICON: Record<CleanGroupId, string> = {
  trash: "trash",
  caches: "bolt",
  logs: "logs",
  temp: "clock",
  developer: "code",
  installers: "installer",
  oldDownloads: "download",
  backups: "phone",
};
