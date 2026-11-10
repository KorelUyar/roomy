// Takes screenshots of every screen with Playwright (WebKit, the engine the
// macOS app uses).
//
//   node scripts/shots.mjs --out docs/screenshots                 sample data
//   node scripts/shots.mjs --out shots/real --real                this computer (needs the bridge)
//   options: --lang de   --platform windows   --dark   --only overview,apps
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
const nav = (n) => page.locator(".nav-item").nth(n).click();

await page.goto(`${base}/?${query}`);
if (want("scanning")) {
  await page.waitForSelector(".scan");
  await page.waitForTimeout(real ? 1200 : 900);
  await snap("scanning");
}
await page.waitForSelector(".hero", { timeout: 180_000 });
await page.waitForFunction(() => document.querySelectorAll(".nav-item em").length >= 2, null, { timeout: 60_000 }).catch(() => {});
if (want("overview")) await snap("overview");

if (want("apps") || want("delete")) {
  await nav(1);
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
  await nav(2);
  await page.waitForSelector(".row.tall");
  await snap("files");
}

if (want("folders")) {
  await nav(3);
  await page.waitForSelector(".row .bar");
  await snap("folders");
}

if (want("cleanup")) {
  await nav(4);
  await page.waitForSelector(".group");
  await page.locator(".group-head").nth(1).click();
  await page.locator(".group-head .check").nth(1).click();
  await snap("cleanup");
}

await browser.close();
