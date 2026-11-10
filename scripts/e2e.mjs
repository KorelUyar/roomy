// End-to-end test of the delete flow: real interface, real backend, real files.
//
// Creates two throw-away folders in the home folder, then uses the UI to move
// one to the Trash and to delete the other for good, and checks the disk.
//
//   npm run build && npx vite preview --port 4173 &
//   ./target/release/roomy-cli serve 4599 $ROOMY_TOKEN &
//   ROOMY_TOKEN=… node scripts/e2e.mjs

import { webkit } from "playwright";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const bridge = process.env.ROOMY_BRIDGE ?? "http://127.0.0.1:4599";
const token = process.env.ROOMY_TOKEN ?? "";
const id = Math.random().toString(36).slice(2, 8);
const trashMe = join(homedir(), `roomy-e2e-${id}-trash`);
const deleteMe = join(homedir(), `roomy-e2e-${id}-delete`);

for (const dir of [trashMe, deleteMe]) {
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "a.bin"), Buffer.alloc(300_000, 1));
  writeFileSync(join(dir, "sub", "b.bin"), Buffer.alloc(200_000, 2));
}

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1120, height: 2400 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
const query = new URLSearchParams({ bridge, token, lang: "en" });

try {
  await page.goto(`http://localhost:4173/?${query}`);
  await page.waitForSelector(".hero", { timeout: 180_000 });
  await page.locator(".nav-item").nth(3).click();

  const row = (path) => page.locator(".row", { hasText: path.split("/").pop() });
  await row(trashMe).waitFor();

  // 1. A protected folder cannot be ticked at all.
  const documents = page.locator(".row", { has: page.locator(".row-title", { hasText: /^Documents$/ }) });
  assert.equal(await documents.locator(".check.locked").count(), 1, "Documents must be locked");

  // 2. Move to Trash.
  await row(trashMe).locator(".check").click();
  await page.locator(".selbar.show .selbar-delete").click();
  await page.locator(".dialog").waitFor();
  assert.match(await page.locator(".dialog-summary").innerText(), /moved to the Trash/);
  assert.equal(await page.locator(".dialog .btn.danger").innerText(), "Move to Trash");
  await page.locator(".dialog .btn.danger").click();
  await page.locator(".dialog").waitFor({ state: "detached" });
  await page.locator(".toast", { hasText: "moved to the Trash" }).waitFor();
  assert.equal(existsSync(trashMe), false, "folder should be in the Trash now");
  await row(trashMe).waitFor({ state: "detached" });
  console.log("ok  move to Trash");

  // 3. Delete for good.
  await row(deleteMe).locator(".check").click();
  await page.locator(".selbar.show .selbar-delete").click();
  await page.locator(".dialog").waitFor();
  await page.locator(".option", { hasText: "Delete immediately" }).locator("input").check();
  assert.match(await page.locator(".dialog-summary").innerText(), /deleted for good/);
  assert.equal(await page.locator(".dialog .btn.danger").innerText(), "Delete");
  await page.locator(".dialog .btn.danger").click();
  await page.locator(".dialog").waitFor({ state: "detached" });
  await page.locator(".toast", { hasText: "freed" }).waitFor();
  assert.equal(existsSync(deleteMe), false, "folder should be gone");
  await row(deleteMe).waitFor({ state: "detached" });
  console.log("ok  delete for good");

  // 4. Nothing is left selected.
  assert.equal(await page.locator(".selbar.show").count(), 0);
  console.log("e2e passed");
} finally {
  await browser.close();
  for (const dir of [trashMe, deleteMe]) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
