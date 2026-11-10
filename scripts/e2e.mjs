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
import { spawn } from "node:child_process";

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

// The backend directly, for the things the interface offers no button for.
const rpc = async (cmd, args = null) => {
  const res = await fetch(`${bridge}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-roomy-token": token },
    body: JSON.stringify({ cmd, args }),
  });
  const body = await res.json();
  if (body.error !== undefined) throw new Error(body.error);
  return body.ok;
};

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1120, height: 2400 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
const query = new URLSearchParams({ bridge, token });

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

  // 5. The language is English until chosen otherwise, and the choice is kept.
  const firstNav = page.locator(".nav-item").first();
  assert.match(await firstNav.innerText(), /Overview/);
  await page.locator(".lang select").selectOption("de");
  await page.locator(".nav-item", { hasText: "Übersicht" }).waitFor();
  await page.reload();
  await page.locator(".nav-item", { hasText: "Übersicht" }).waitFor({ timeout: 180_000 });
  await page.locator(".lang select").selectOption("en");
  await page.locator(".nav-item", { hasText: "Overview" }).waitFor();
  console.log("ok  language choice");

  // 6. Every disk is listed, and the system disk is one of them.
  const disks = await rpc("list_disks");
  assert.ok(disks.length >= 1 && disks.some((d) => d.system), "the system disk must be listed");
  assert.equal(await page.locator(".disk").count(), disks.length);
  console.log(`ok  ${disks.length} disk(s) listed`);

  // 7. Bloat Scanner: runs, and reports the system's protections.
  await page.locator(".nav-item").nth(5).click();
  await page.locator(".bloat-intro .btn.primary").click();
  await page.locator(".stats").waitFor({ timeout: 120_000 });
  assert.ok((await page.locator(".status").count()) >= 5, "security checks expected");
  console.log("ok  bloat scan");

  // 8. "Quit" ends only what the scan reported as unwanted, nothing else.
  const bystander = spawn("/bin/sleep", ["60"]);
  try {
    assert.equal(await rpc("bloat_quit", { pids: [bystander.pid] }), 0);
    assert.equal(bystander.exitCode, null, "an unrelated process must be left alone");
    // Nor can a folder that is not a disk be scanned, or another startup item be switched off.
    await assert.rejects(rpc("start_scan", { root: homedir() }));
    await assert.rejects(rpc("bloat_disable_startup", { id: "/Library/LaunchDaemons/com.example.plist" }));
  } finally {
    bystander.kill();
  }
  console.log("ok  actions are limited to what was reported");
  console.log("e2e passed");
} finally {
  await browser.close();
  for (const dir of [trashMe, deleteMe]) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
