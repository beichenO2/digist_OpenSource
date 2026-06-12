#!/usr/bin/env node
/**
 * Phase 10 冒烟：需先启动生产服务（仓库根目录已安装 playwright）
 *   cd web && npm run build && npm run start
 *   另开终端: node web/scripts/smoke-e2e.mjs
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pwPath = path.join(__dirname, "..", "..", "node_modules", "playwright");
const { chromium } = require(pwPath);

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3810";
const routes = ["/", "/items", "/graph", "/reports", "/evolution", "/scheduler"];

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
for (const r of routes) {
  const url = BASE.replace(/\/$/, "") + r;
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (!res || !res.ok()) {
    errors.push(`${r} -> ${res?.status() ?? "no response"}`);
  }
}
await browser.close();
if (errors.length) {
  console.error("SMOKE FAIL:\n", errors.join("\n"));
  process.exit(1);
}
console.log("SMOKE OK:", routes.length, "routes @", BASE);
