// Takes screenshots of every screen with Playwright (WebKit, the engine the
// macOS app uses).
//
//   node scripts/shots.mjs --out docs/screenshots                 sample data
//   node scripts/shots.mjs --out shots/real --real                this computer (needs the bridge)
//   options: --lang de   --platform windows   --dark   --only health,storage,apps
//
// Needs `npm run build && npx vite preview --port 4173` and, for real icons
// or real data, the backend bridge:
//   ./target/release/roomy-cli serve 4599 $ROOMY_TOKEN

import { webkit } from "playwright";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);

const out = opt("out", "shots");
const lang = opt("lang", "en");
const platform = opt("platform", "macos");
const real = flag("real");
const only = opt("only", "").split(",").filter(Boolean);
const base = opt("url", "http://localhost:4173");
const bridge = process.env.ROOMY_BRIDGE ?? "http://127.0.0.1:4599";
const token = process.env.ROOMY_TOKEN ?? "";

const query = new URLSearchParams({ frame: platform, lang });
if (real) {
  query.set("bridge", bridge);
  query.set("token", token);
} else {
  query.set("platform", platform);
  if (token && platform === "macos") query.set("icons", `${bridge}/icon?t=${token}`);
}

mkdirSync(out, { recursive: true });
const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1248, height: 868 },
  deviceScaleFactor: 2,
  colorScheme: flag("dark") ? "dark" : "light",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));

const want = (name) => only.length === 0 || only.includes(name);
const snap = async (name) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${name}.png`, omitBackground: true });
  console.log(`  ${out}/${name}.png`);
};
const nav = (view) => page.locator(`.nav-item[data-view="${view}"]`).click();
const content = page.locator(".content");

await page.goto(`${base}/?${query}`);
await page.waitForSelector(".condition");
if (want("scanning")) {
  await nav("overview");
  await page.waitForSelector(".scan");
  await page.waitForTimeout(real ? 1200 : 900);
  await snap("scanning");
}
if (want("storage")) {
  await nav("overview");
  await page.waitForSelector(".hero", { timeout: 180_000 });
  await snap("storage");
}

// Health: the check-up runs by itself at the start.
const checked = () => page.waitForSelector(".condition:not(.checking) [data-check]:not([disabled])", { timeout: 240_000 });
if (want("health")) {
  await nav("health");
  await checked();
  await page.waitForFunction(() => document.querySelectorAll(".row.line").length >= 3, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(700); // the ring has filled
  await snap("health");
  await content.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await snap("health-memory");
  await content.evaluate((el) => el.scrollTo(0, 0));
}

if (want("apps") || want("delete")) {
  await nav("apps");
  await page.waitForSelector(".row");
  if (want("apps")) await snap("apps");
  if (platform === "macos") {
    const boxes = page.locator(".row.clickable .check");
    await boxes.nth(1).click();
    await boxes.nth(2).click();
    if (want("apps")) await snap("apps-selected");
    if (want("delete")) {
      await page.locator(".selbar-delete").click();
      await page.waitForSelector(".dialog");
      await page.waitForTimeout(900); // related app data loads
      await snap("delete");
      await page.keyboard.press("Escape");
    }
    await page.locator(".selbar-clear").click();
  }
}

if (want("files")) {
  await nav("files");
  await page.waitForSelector(".row.tall", { timeout: 180_000 });
  await snap("files");
}

if (want("folders")) {
  await nav("folders");
  await page.waitForSelector(".row .bar", { timeout: 180_000 });
  await snap("folders");
}

if (want("cleanup")) {
  await nav("cleanup");
  await page.waitForSelector(".group");
  await page.locator(".group-head").nth(1).click();
  await page.locator(".group-head .check").nth(1).click();
  await snap("cleanup");
  await page.locator(".selbar-clear").click();
}

// Before anything is fixed: the full lists.
if (want("bloat")) {
  await nav("bloat");
  // Scanned already when the Health check or the Protection tab ran before.
  const start = page.locator(".bloat-intro .btn.primary");
  await page.waitForSelector(".bloat-intro, .section");
  if ((await start.count()) > 0) {
    await snap("bloat-start");
    await start.click();
  }
  await page.waitForSelector(".section", { timeout: 120_000 });
  await snap("bloat");
}

// Protection: the report of the check-up, a deep scan, and everything fixed with one button.
if (want("protection")) {
  await nav("protection");
  await page.waitForSelector('.band [data-scan="quick"]', { timeout: 240_000 });
  await page.waitForFunction(() => document.querySelectorAll(".row .status").length >= 4, null, { timeout: 120_000 });
  await page.waitForTimeout(600);
  await snap("protection");
  if (!real) {
    await page.locator('.band [data-scan="full"]').click();
    await page.waitForSelector(".band .spinner");
    await page.waitForTimeout(1400);
    await snap("protection-scanning");
    await page.waitForSelector('.band [data-scan="quick"]', { timeout: 600_000 });
    await page.waitForTimeout(700);
    await snap("protection-found");
    if ((await page.locator(".band [data-fix-all]").count()) > 0) {
      await page.locator(".band [data-fix-all]").click();
      await page.waitForSelector(".dialog");
      await snap("fix-ask");
      await page.locator(".dialog .btn.primary").click();
      await page.waitForSelector('.activity-row[data-activity="fix"]');
      await page.waitForTimeout(700);
      await snap("fixing");
      await page.waitForSelector('.activity-row[data-activity="fix"]', { state: "detached", timeout: 120_000 });
      await page.waitForTimeout(500);
      await snap("protection-fixed");
    }
  }
}

// Deleting goes on in the corner while everything else stays usable.
if (want("deleting") && !real) {
  await nav("files");
  await page.waitForSelector(".row.tall", { timeout: 180_000 });
  // "Select all" is offered for one kind of file at a time.
  await page.locator(".chip").nth(1).click();
  await page.locator("[data-select-all]").click();
  await page.locator(".chip").nth(2).click();
  await page.locator("[data-select-all]").click();
  await page.locator(".selbar-delete").click();
  await page.waitForSelector(".dialog");
  await page.locator(".dialog .btn.danger").click();
  await page.waitForSelector('.activity-row[data-activity="delete"]');
  await page.waitForTimeout(2600);
  await nav("health");
  await page.waitForTimeout(500);
  await snap("deleting");
  await page.waitForSelector('.activity-row[data-activity="delete"]', { state: "detached", timeout: 240_000 });
}

// A second disk: pick it in the sidebar, wait for its scan.
if (want("disk2")) {
  const disks = page.locator(".disk.pick");
  if ((await disks.count()) > 1) {
    await disks.nth(1).click();
    await nav("overview");
    await page.waitForSelector(".hero", { timeout: 180_000 });
    await snap("disk2");
  }
}

await browser.close();
