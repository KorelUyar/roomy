// Renders design/icon.svg to a 1024px PNG (input for `tauri icon`).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const svg = readFileSync(new URL("../design/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
await page.screenshot({ path: "design/icon.png", omitBackground: true });
await browser.close();
console.log("design/icon.png written");
