// What counts as "something to look at". Used by the Health tab and by the
// dots in the sidebar, so both always say the same.

import type { BloatReport, DiskInfo, MalwareStatus, SecurityCheck, Threat } from "./api";

/** Protections of the system that are off and that the user has not said they want that way. */
export const securityToCheck = (bloat: BloatReport | null, intended: string[]): SecurityCheck[] =>
  bloat?.security.filter((c) => c.status === "warn" && !intended.includes(c.id)) ?? [];

/** Startup items that are more than just unsigned: unwanted, left over, or in an odd place. */
export const flaggedStartup = (bloat: BloatReport | null): number => bloat?.startup.filter((i) => i.flags.some((f) => f !== "unsigned")).length ?? 0;

/** Files that match a malware signature and are still there (Microsoft Defender deals with its own; the test file is no threat). */
export const openThreats = (malware: MalwareStatus | null): Threat[] => malware?.threats.filter((x) => !x.handled && !x.test) ?? [];

/** The harmless test file, when a scan found it. */
export const testFiles = (malware: MalwareStatus | null): Threat[] => malware?.threats.filter((x) => x.test) ?? [];

/** Share of a disk that is in use, 0–100. */
export const usedPercent = (disk: DiskInfo | null | undefined): number => (disk && disk.total > 0 ? (disk.used / disk.total) * 100 : 0);

/** "warn" when less than a tenth is free, "bad" below a twentieth. */
export function diskTone(disk: DiskInfo | null | undefined): "" | "warn" | "bad" {
  if (!disk || disk.total <= 0) return "";
  const free = disk.free / disk.total;
  return free < 0.05 ? "bad" : free < 0.1 ? "warn" : "";
}
