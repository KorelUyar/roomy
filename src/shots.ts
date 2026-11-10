// Development only: when the app is started with ROOMY_SHOTS=<folder>, walk
// through every screen, save a picture of each and quit. This is how the real
// app is checked on machines without a person in front of the screen.

import { debugInvoke } from "./api";
import { getState, navigate, scanBloat, setState } from "./store";

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
    await shot("0-scanning");
    await until(() => getState().overview !== null);
    await until(() => getState().apps !== null && getState().cleanup !== null);
    await shot("1-overview");
    navigate("apps");
    await shot("2-apps");
    navigate("files");
    await shot("3-files");
    navigate("folders");
    await shot("4-folders");
    navigate("cleanup");
    await shot("5-cleanup");
    navigate("bloat");
    await scanBloat();
    await shot("6-bloat");
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
          apps: s.apps?.length,
          cleanup: s.cleanup?.map((g) => [g.id, g.size, g.items.length]),
          categories: s.overview?.categories,
        },
        null,
        2,
      ),
    });
    setState({ view: "overview" });
  } finally {
    await debugInvoke("debug_exit");
  }
}
