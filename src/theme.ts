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
};

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
