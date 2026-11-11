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
// Where only a deep scan looks.
const elsewhere = join(homedir(), `roomy-e2e-${id}-deep`);
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
  // Yes means go: the dialog is gone at once, the work shows in the corner, the row is out of the list.
  await page.locator(".dialog").waitFor({ state: "detached", timeout: 1500 });
  await page.locator('.activity-row[data-activity="delete"]').waitFor();
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

  // 7. Health: live numbers, a check-up that runs by itself, and a score that is the sum of what it lists.
  await nav("health").click();
  // Storage, memory, processor and network (the first comes from the disk list, the others from the live reading).
  await page.locator(".vital").nth(3).waitFor({ timeout: 30_000 });
  const health = await rpc("health");
  assert.ok(health.cores > 0 && health.memoryTotal > 0 && health.memoryUsed > 0, "the computer's numbers must be there");
  assert.ok(["normal", "fair", "serious", "critical", "unknown"].includes(health.thermal));
  const settled = page.locator(".condition:not(.checking) [data-check]:not([disabled])");
  await settled.waitFor({ timeout: 300_000 });
  await page.locator("[data-check]").click();
  await page.locator(".condition.checking").waitFor();
  await settled.waitFor({ timeout: 300_000 });
  await page.locator(".section", { hasText: "last checked at" }).waitFor();
  const score = Number(await page.locator(".condition .ring b").innerText());
  const points = await page.locator(".condition .band-item em").allInnerTexts();
  const off = points.reduce((sum, text) => sum + Number(text.replace(/[^0-9]/g, "")), 0);
  assert.equal(score, Math.max(0, 100 - off), `the score (${score}) is 100 minus what is listed (${off})`);
  console.log(`ok  health check (${health.os}, ${health.cores} cores, score ${score}, ${points.length} deductions)`);

  // 8. Bloat Scanner shows what the check-up found; Protection lists the system's protections.
  await nav("bloat").click();
  await page.locator(".section").first().waitFor({ timeout: 120_000 });
  await nav("protection").click();
  await page.locator('.band [data-scan="quick"]').first().waitFor({ timeout: 60_000 });
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
    await page.locator('.band-actions [data-scan="quick"]').click();
    const threat = page.locator(".row", { hasText: "eicar.com" });
    await threat.waitFor({ timeout: 300_000 });
    // The buttons are back when the check-up is over.
    await page.locator('.band-actions [data-scan="quick"]').waitFor({ timeout: 60_000 });
    assert.equal(await threat.count(), 1, "exactly the test file is reported");
    assert.match(await threat.innerText(), /Test file/);
    // Found, but no alarm: it is the test file, and the band says so.
    assert.match(await page.locator(".band").innerText(), /harmless test file/);
    assert.equal(await page.locator(".band.bad").count(), 0);
    assert.equal(await page.locator(".row", { hasText: "harmless.txt" }).count(), 0);
    assert.equal(existsSync(testFile), true, "a scan only reads");
    // Its button deals with it at once: to the Trash, no second question.
    await threat.locator('[data-fix="auto"]').click();
    await threat.waitFor({ state: "detached", timeout: 30_000 });
    assert.equal(existsSync(testFile), false, "the test file should be gone");
    await threat.waitFor({ state: "detached" });
    // Gone for good: not back after looking elsewhere, nor for the backend.
    await nav("health").click();
    await page.locator(".vital").first().waitFor();
    await nav("protection").click();
    await page.locator('.band-actions [data-scan="quick"]').waitFor();
    assert.equal(await threat.count(), 0, "a removed finding must not come back");
    assert.equal((await rpc("malware_status")).threats.length, 0);
    console.log(`ok  malware scan (${engine.rules} signatures, version ${engine.version})`);

    // 9b. A match inside an app is about the whole app: the row says so, and its button asks first.
    const app = join(downloaded, "Roomy Test.app");
    mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(app, "Contents", "Info.plist"), '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleName</key><string>Roomy Test</string></dict></plist>\n');
    writeFileSync(join(app, "Contents", "Resources", "part.com"), TEST_FILE);
    // A folder that merely has such a name is no app: its file is a file, and only the file goes.
    const notAnApp = join(downloaded, "site.app");
    mkdirSync(join(notAnApp, "public"), { recursive: true });
    writeFileSync(join(notAnApp, "public", "plain.com"), TEST_FILE);
    writeFileSync(join(notAnApp, "public", "keep.txt"), "stays");
    // 9c. What an earlier run found where a quick scan does not look is looked at again
    // (here: remembered by the browser, never seen by this backend).
    mkdirSync(elsewhere, { recursive: true });
    const deepFile = join(elsewhere, "deep.com");
    writeFileSync(deepFile, TEST_FILE);
    await page.evaluate((path) => localStorage.setItem("roomy.threats", JSON.stringify([path])), deepFile);
    await page.locator('.band-actions [data-scan="quick"]').click();
    const appRow = page.locator('.row[data-issue="threat"]', { hasText: "Roomy Test" });
    const deepRow = page.locator('.row[data-issue="threat"]', { hasText: "deep.com" });
    await appRow.waitFor({ timeout: 300_000 });
    await deepRow.waitFor();
    await page.locator('.band-actions [data-scan="quick"]').waitFor({ timeout: 60_000 });
    assert.match(await appRow.locator(".row-title").innerText(), /^Roomy Test/);
    assert.match(await appRow.locator(".row-sub").innerText(), /part\.com in /);
    const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem("roomy.threats")));
    assert.ok(remembered.includes(deepFile) && remembered.length === 3, "what is still there is remembered for the next start");
    const plainRow = page.locator('.row[data-issue="threat"]', { hasText: "plain.com" });
    assert.match(await plainRow.locator(".row-title").innerText(), /^plain\.com/, "a folder called .app is not an app");
    await plainRow.locator('[data-fix="auto"]').click();
    await plainRow.waitFor({ state: "detached", timeout: 60_000 });
    assert.equal(existsSync(join(notAnApp, "public", "plain.com")), false);
    assert.equal(existsSync(join(notAnApp, "public", "keep.txt")), true, "only the file went, not the folder around it");
    await appRow.locator('[data-fix="auto"]').click();
    await page.locator(".dialog").waitFor();
    assert.match(await page.locator(".dialog").innerText(), /whole app to the Trash/);
    assert.equal(existsSync(app), true, "nothing goes before the answer");
    await page.locator(".dialog .btn", { hasText: "Cancel" }).click();
    await page.locator(".dialog").waitFor({ state: "detached" });
    assert.equal(existsSync(app), true);
    await appRow.locator('[data-fix="auto"]').click();
    await page.locator(".dialog [data-fix-go]").click();
    await appRow.waitFor({ state: "detached", timeout: 60_000 });
    assert.equal(existsSync(app), false, "the app should be in the Trash");
    await deepRow.locator('[data-fix="auto"]').click();
    await deepRow.waitFor({ state: "detached", timeout: 60_000 });
    assert.equal(existsSync(deepFile), false);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("roomy.threats"))), [], "and what is gone is forgotten");
    console.log("ok  a match inside an app asks first; earlier findings are looked at again");
  } else {
    console.log(`--  malware scan skipped (${engine.engine}, available: ${engine.available})`);
  }

  // 10. "Quit" ends only what a scan reported, nothing else.
  const bystander = spawn("/bin/sleep", ["60"]);
  try {
    assert.equal(await rpc("bloat_quit", { pids: [bystander.pid] }), 0);
    assert.equal(await rpc("health_quit", { pids: [bystander.pid] }), 0);
    assert.equal(await rpc("malware_quit", { pids: [bystander.pid] }), 0);
    assert.equal(bystander.exitCode, null, "an unrelated process must be left alone");
    // Nor can a folder that is not a disk be scanned, or another startup item be switched off.
    await assert.rejects(rpc("start_scan", { root: homedir() }));
    await assert.rejects(rpc("bloat_disable_startup", { id: "/Library/LaunchDaemons/com.example.plist" }));
  } finally {
    bystander.kill();
  }
  console.log("ok  actions are limited to what was reported");

  // 11. The sample computer (nothing real is touched): a deep scan finds things,
  // one button fixes what can be fixed, and deleting many things does not have to be waited for.
  const sample = await browser.newPage({ viewport: { width: 1120, height: 2400 } });
  sample.on("pageerror", (e) => console.error("page error:", e.message));
  await sample.goto("http://localhost:4173/?fast=1");
  const snav = (view) => sample.locator(`.nav-item[data-view="${view}"]`);
  await sample.locator(".condition:not(.checking) [data-check]:not([disabled])").waitFor({ timeout: 60_000 });
  await snav("protection").click();
  await sample.locator('.band [data-scan="full"]').click();
  await sample.locator('.row[data-issue="threat"]').first().waitFor({ timeout: 60_000 });
  const found = await sample.locator(".row[data-issue]").count();
  const manual = await sample.locator('.row[data-issue] [data-fix="manual"]').count();
  assert.ok(found > manual && manual >= 1, "the sample has things to fix and one that needs the user");
  await sample.locator(".band [data-fix-all]").click();
  // Every line can be unticked, and ticked again.
  const fixTitle = await sample.locator(".dialog h2").innerText();
  await sample.locator(".dialog-item").first().click();
  assert.notEqual(await sample.locator(".dialog h2").innerText(), fixTitle, "the question counts what is ticked");
  await sample.locator(".dialog-item").first().click();
  assert.equal(await sample.locator(".dialog h2").innerText(), fixTitle);
  await sample.locator(".dialog [data-fix-go]").click();
  await sample.locator('.activity-row[data-activity="fix"]').waitFor();
  await sample.locator('.activity-row[data-activity="fix"]').waitFor({ state: "detached", timeout: 60_000 });
  assert.equal(await sample.locator(".row[data-issue]").count(), manual, "what Roomy can fix is fixed; what needs the user is left");
  assert.equal(await sample.locator(".band [data-fix-all]").count(), 0);
  console.log(`ok  fix all (${found - manual} fixed, ${manual} left for the user)`);

  // 12. The sample PC: Microsoft Defender removes all its findings or none, so they are one line;
  // an app that came with the computer is listed, but "fix all" leaves it alone unless it is ticked.
  const pc = await browser.newPage({ viewport: { width: 1120, height: 2400 } });
  pc.on("pageerror", (e) => console.error("page error:", e.message));
  await pc.goto("http://localhost:4173/?fast=1&platform=windows");
  await pc.locator(".condition:not(.checking) [data-check]:not([disabled])").waitFor({ timeout: 60_000 });
  await pc.locator('.nav-item[data-view="protection"]').click();
  await pc.locator('.band [data-scan="full"]').click();
  await pc.locator('.row[data-issue="threat"]').waitFor({ timeout: 60_000 });
  assert.equal(await pc.locator('.row[data-issue="threat"]').count(), 1, "one line for all of Microsoft Defender's findings");
  assert.match(await pc.locator('[data-list="defender"] .row').first().innerText(), /Not removed yet/);
  const candy = pc.locator(".row[data-issue]", { hasText: "Candy Crush" });
  assert.equal(await candy.count(), 1);
  await pc.locator(".band [data-fix-all]").click();
  assert.equal(await pc.locator('.dialog-item[data-fix-item="optional"].off').count(), 1, "what cannot be taken back starts unticked");
  assert.match(await pc.locator(".dialog").innerText(), /cannot be taken back/);
  await pc.locator(".dialog [data-fix-go]").click();
  await pc.locator('.activity-row[data-activity="fix"]').waitFor();
  await pc.locator('.activity-row[data-activity="fix"]').waitFor({ state: "detached", timeout: 60_000 });
  assert.equal(await pc.locator('.row[data-issue="threat"]').count(), 0);
  assert.match(await pc.locator('[data-list="defender"] .row').first().innerText(), /Dealt with/);
  assert.equal(await candy.count(), 1, "the preinstalled app is still there");
  // Its own button asks too, because it cannot be taken back.
  await candy.locator('[data-fix="auto"]').click();
  await pc.locator(".dialog").waitFor();
  assert.match(await pc.locator(".dialog").innerText(), /for good/);
  await pc.locator(".dialog .btn", { hasText: "Cancel" }).click();
  assert.equal(await candy.count(), 1);
  await candy.locator('[data-fix="auto"]').click();
  await pc.locator(".dialog [data-fix-go]").click();
  await candy.waitFor({ state: "detached", timeout: 60_000 });
  await pc.close();
  console.log("ok  Windows sample: Defender's findings as one, preinstalled apps by choice");

  await snav("files").click();
  await sample.locator(".row.tall").first().waitFor({ timeout: 60_000 });
  let fileRows = await sample.locator(".row.tall").count();
  // A stretch with Shift: the first row, then the fifth.
  await sample.locator(".row.tall .check").nth(0).click();
  await sample.locator(".row.tall .check").nth(4).click({ modifiers: ["Shift"] });
  assert.match(await sample.locator(".selbar-count").innerText(), /^5 /);
  // "Select all" is offered for one kind of file at a time (here: the first kind in the row of filters).
  assert.equal(await sample.locator("[data-select-all]").count(), 0, "no 'Select all' for every kind at once");
  await sample.locator(".chip").nth(1).click();
  await sample.locator("[data-select-all]").click();
  fileRows = Number(/^\d+/.exec(await sample.locator(".selbar-count").innerText())?.[0] ?? fileRows);
  await sample.locator(".selbar.show .selbar-delete").click();
  await sample.locator(".dialog .btn.danger").click();
  await sample.locator(".dialog").waitFor({ state: "detached", timeout: 1500 });
  // Gone from the list at once, while the ring in the corner still counts.
  await sample.locator('.activity-row[data-activity="delete"]:not(.done)').waitFor();
  assert.equal(await sample.locator(".row.tall").count(), 0, "queued files leave the list at once");
  await snav("health").click();
  await sample.locator(".condition").waitFor();
  assert.match(await sample.locator('.activity-row[data-activity="delete"] b').innerText(), /Deleting… \d+%/);
  await sample.locator('.activity-row[data-activity="delete"].done').waitFor({ timeout: 120_000 });
  console.log(`ok  ${fileRows} files deleted in the background`);
  console.log("e2e passed");
} finally {
  await browser.close();
  for (const dir of [trashMe, deleteMe, downloaded, elsewhere]) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
