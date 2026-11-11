// End-to-end test: real interface, real backend, real files.
//
// Creates two throw-away folders in the home folder, then uses the UI to move
// one to the Trash and to delete the other for good, and checks the disk.
// Then the check-up, the malware scan (with the harmless test file every
// scanner knows) and the limits of what the backend lets anyone do.
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
// Where a quick malware scan looks: a download.
const downloaded = join(homedir(), "Downloads", `roomy-e2e-${id}`);
// The EICAR test file, put together here so that this script is not one itself.
const TEST_FILE = Buffer.from(
  [2, 111, 21, 123, 10, 127, 26, 27, 10, 1, 110, 6, 10, 0, 2, 111, 110, 114, 10, 4, 115, 109, 25, 25, 115, 109, 39, 126, 31, 19, 25, 27, 8, 119, 9, 14, 27, 20, 30, 27, 8, 30, 119, 27, 20, 14, 19, 12, 19, 8, 15, 9, 119, 14, 31, 9, 14, 119, 28, 19, 22, 31, 123, 126, 18, 113, 18, 112].map((b) => b ^ 0x5a),
);

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
  const nav = (view) => page.locator(`.nav-item[data-view="${view}"]`);
  await page.goto(`http://localhost:4173/?${query}`);
  // Health is what Roomy opens with; the lists need the disk scan, which Storage shows.
  await page.waitForSelector(".vital", { timeout: 60_000 });
  await nav("overview").click();
  await page.waitForSelector(".hero", { timeout: 180_000 });
  await nav("folders").click();

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
  assert.match(await nav("overview").innerText(), /Storage/);
  await page.locator(".lang select").selectOption("de");
  await page.locator(".nav-item", { hasText: "Speicher" }).waitFor();
  await page.reload();
  await page.locator(".nav-item", { hasText: "Speicher" }).waitFor({ timeout: 180_000 });
  await page.locator(".lang select").selectOption("en");
  await page.locator(".nav-item", { hasText: "Storage" }).waitFor();
  console.log("ok  language choice");

  // 6. Every disk is listed, and the system disk is one of them.
  const disks = await rpc("list_disks");
  assert.ok(disks.length >= 1 && disks.some((d) => d.system), "the system disk must be listed");
  assert.equal(await page.locator(".disk").count(), disks.length);
  console.log(`ok  ${disks.length} disk(s) listed`);

  // 7. Health: live numbers, and a check-up that leaves nothing unchecked.
  await nav("health").click();
  await page.locator(".vital").first().waitFor();
  assert.ok((await page.locator(".vital").count()) >= 3, "storage, memory and processor expected");
  const health = await rpc("health");
  assert.ok(health.cores > 0 && health.memoryTotal > 0 && health.memoryUsed > 0, "the computer's numbers must be there");
  await page.locator(".band .btn").click();
  await page.locator(".steps").waitFor();
  await page.locator(".band-sub", { hasText: "Last checked" }).waitFor({ timeout: 300_000 });
  // The sentence is a verdict now, and what it counts stands right under it.
  const verdict = await page.locator(".band-title").innerText();
  assert.match(verdict, /^(Everything looks good|\d+ things? to look at)$/, `unexpected verdict: ${verdict}`);
  const counted = Number(/^\d+/.exec(verdict)?.[0] ?? 0);
  assert.equal(await page.locator(".band-item").count(), counted, "every counted thing is listed");
  console.log(`ok  health check (${health.os}, ${health.cores} cores)`);

  // 8. Bloat Scanner shows what the check-up found; Protection lists the system's protections.
  await nav("bloat").click();
  await page.locator(".section").first().waitFor({ timeout: 120_000 });
  await nav("protection").click();
  await page.locator(".band-actions .btn.primary").waitFor({ timeout: 60_000 });
  assert.ok((await page.locator(".row .status").count()) >= 5, "security settings expected");
  // A setting that is off on purpose can be marked so; that is remembered, and can be undone.
  const toCheck = page.locator(".row .status.warn");
  const before = await toCheck.count();
  if (before > 0) {
    await page.locator("[data-intended]").first().click();
    assert.equal(await toCheck.count(), before - 1, "an intended setting no longer asks for a look");
    await page.reload();
    await nav("protection").click();
    await page.locator(".row .status").first().waitFor({ timeout: 120_000 });
    assert.equal(await toCheck.count(), before - 1, "the choice is remembered");
    await page.locator(".row", { hasText: "You marked this as intended" }).locator(".btn").click();
    assert.equal(await toCheck.count(), before, "and can be taken back");
  }
  console.log(`ok  bloat scan and security settings (${before} to check)`);

  // 9. The malware scan finds the test file in Downloads, and nothing is removed without the dialog.
  const engine = (await rpc("malware_status")).engine;
  if (engine.engine === "xprotect" && engine.available) {
    assert.ok(engine.rules > 100, "Apple's signatures must have been read");
    mkdirSync(downloaded, { recursive: true });
    const testFile = join(downloaded, "eicar.com");
    writeFileSync(testFile, TEST_FILE);
    writeFileSync(join(downloaded, "harmless.txt"), "nothing to see");
    await page.locator('.band [data-scope="quick"]').click();
    const threat = page.locator(".row", { hasText: "eicar.com" });
    await threat.waitFor({ timeout: 300_000 });
    assert.equal(await threat.count(), 1, "exactly the test file is reported");
    assert.match(await threat.innerText(), /Test file/);
    // Found, but no alarm: it is the test file, and the band says so.
    assert.match(await page.locator(".band").innerText(), /harmless test file/);
    assert.equal(await page.locator(".band.bad").count(), 0);
    assert.equal(await page.locator(".row", { hasText: "harmless.txt" }).count(), 0);
    assert.equal(existsSync(testFile), true, "a scan only reads");
    await threat.locator(".btn.danger").click();
    await page.locator(".dialog").waitFor();
    await page.locator(".option", { hasText: "Delete immediately" }).locator("input").check();
    await page.locator(".dialog .btn.danger").click();
    await page.locator(".dialog").waitFor({ state: "detached" });
    assert.equal(existsSync(testFile), false, "the test file should be gone");
    await threat.waitFor({ state: "detached" });
    // Gone for good: not back after looking elsewhere, nor for the backend.
    await nav("health").click();
    await page.locator(".vital").first().waitFor();
    await nav("protection").click();
    await page.locator(".band-actions .btn.primary").waitFor();
    assert.equal(await threat.count(), 0, "a removed finding must not come back");
    assert.equal((await rpc("malware_status")).threats.length, 0);
    console.log(`ok  malware scan (${engine.rules} signatures, version ${engine.version})`);
  } else {
    console.log(`--  malware scan skipped (${engine.engine}, available: ${engine.available})`);
  }

  // 10. "Quit" ends only what a scan reported, nothing else.
  const bystander = spawn("/bin/sleep", ["60"]);
  try {
    assert.equal(await rpc("bloat_quit", { pids: [bystander.pid] }), 0);
    assert.equal(await rpc("health_quit", { pids: [bystander.pid] }), 0);
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
  for (const dir of [trashMe, deleteMe, downloaded]) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
