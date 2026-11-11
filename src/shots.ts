// Development only: when the app is started with ROOMY_SHOTS=<folder>, walk
// through every screen, save a picture of each and quit. This is how the real
// app is checked on machines without a person in front of the screen.

import { debugInvoke } from "./api";
import { checkAll, getState, navigate, refreshHealth, scanBloat, setState } from "./store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(test: () => boolean, timeout = 120_000) {
  const started = Date.now();
  while (!test() && Date.now() - started < timeout) await sleep(100);
}

async function shot(name: string) {
  await sleep(700); // let icons and transitions settle
  await debugInvoke("debug_snapshot", { name });
}

let started = false;

export async function runShots() {
  const dir = getState().meta?.shotsDir;
  if (!dir || started) return;
  started = true;
  // Anything that goes wrong in the page ends up next to the pictures.
  const report = (what: string) => void debugInvoke("debug_write", { name: "error.txt", contents: what });
  window.addEventListener("error", (e) => report(`${e.message}\n${e.error?.stack ?? ""}`));
  window.addEventListener("unhandledrejection", (e) => report(String(e.reason?.stack ?? e.reason)));
  try {
    await sleep(300);
    navigate("overview");
    await shot("0-scanning");
    await until(() => getState().overview !== null);
    await until(() => getState().apps !== null && getState().cleanup !== null);
    await shot("1-storage");
    navigate("health");
    // The check-up starts by itself; a few looks at the numbers so the charts have something to draw.
    for (let i = 0; i < 4; i++) {
      await refreshHealth();
      await sleep(900);
    }
    await until(() => getState().check.at !== null && !getState().check.running);
    await refreshHealth();
    await shot("2-health");
    await checkAll("quick", true);
    await refreshHealth();
    await shot("3-health-again");
    navigate("apps");
    await shot("4-apps");
    navigate("files");
    await shot("5-files");
    navigate("folders");
    await shot("6-folders");
    navigate("cleanup");
    await shot("7-cleanup");
    navigate("protection");
    await shot("8-protection");
    navigate("bloat");
    if (!getState().bloat) await scanBloat();
    await shot("9-bloat");
    const s = getState();
    await debugInvoke("debug_write", {
      name: "state.json",
      contents: JSON.stringify(
        {
          meta: s.meta,
          disk: s.disk,
          scan: s.scan,
          disks: s.disks,
          bloat: s.bloat && { unwanted: s.bloat.unwanted.length, startup: s.bloat.startup.length, security: s.bloat.security },
          health: s.health,
          malware: s.malware && { ...s.malware, current: "" },
          check: s.check,
          apps: s.apps?.length,
          cleanup: s.cleanup?.map((g) => [g.id, g.size, g.items.length]),
          categories: s.overview?.categories,
        },
        null,
        2,
      ),
    });
    setState({ view: "health" });
  } finally {
    await debugInvoke("debug_exit");
  }
}
