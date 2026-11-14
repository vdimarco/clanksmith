#!/usr/bin/env node
// Screenshots of the board. Serves public/ if needed, then writes PNGs.
//   node board/scripts/shot.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const boardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(boardDir, "screenshots");
const publicDir = path.join(boardDir, "public");

function loadPlaywright() {
  const candidates = [
    path.join(boardDir, "node_modules/playwright/package.json"),
    path.resolve("node_modules/playwright/package.json"),
  ];
  for (const pkg of candidates) {
    if (fs.existsSync(pkg)) return createRequire(pkg)("playwright");
  }
  throw new Error("Install playwright, then run node board/scripts/shot.mjs from the repo root.");
}

const { chromium } = loadPlaywright();
fs.mkdirSync(outDir, { recursive: true });
const port = 8766;
const base = `http://127.0.0.1:${port}/`;

function serve() {
  return spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", publicDir], {
    stdio: "ignore",
  });
}

const server = serve();
await new Promise((r) => setTimeout(r, 400));
const browser = await chromium.launch({ args: ["--disable-gpu"] });
try {
  for (const [width, height, name] of [[390, 844, "board-390.png"], [1280, 800, "board-1280.png"]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const t = document.getElementById("status")?.textContent || "";
      return t.startsWith("Read ") || t.startsWith("mainnet") || t.includes("failed");
    }, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, name), fullPage: true });
    const box = await page.locator("button").first().boundingBox();
    if (!box || box.height < 44 || box.width < 44) throw new Error(`${name} control is under 44px`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (overflow) throw new Error(`${name} scrolls sideways`);
    console.log(name, "ok");
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
