// Test de fumée de l'interface web (Chromium headless).
// Prérequis : serveur lancé (stepviewer web --port 8765), puis : cd tests/ui && npm install && npm test
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";
import path from "path";

const BASE = process.env.STEPVIEWER_URL || "http://127.0.0.1:8765/";
const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../samples/featuretype.step");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  args: [...chromium.args, "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  executablePath: process.env.CHROME_PATH || (await chromium.executablePath()), headless: true,
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle0" });
await (await page.$("#file-input")).uploadFile(SAMPLE);
await page.waitForSelector("#panel:not([hidden])", { timeout: 90000 });
await wait(1500);
const dims = await page.$$eval("#dims .val", (els) => els.map((e) => e.textContent));
console.log("dimensions :", dims.join(" × "));
await page.select("#material", "pet");
await wait(500);
console.log("masse :", await page.$eval("#facts dd.strong", (e) => e.textContent));
await page.keyboard.press("m"); await page.mouse.click(560, 420); await wait(200); await page.mouse.click(720, 470); await wait(400);
console.log("mesure :", await page.$eval("#measure-hud", (e) => e.textContent.split("\n")[0]));
await page.keyboard.press("Escape"); await page.keyboard.press("p"); await wait(300);
await page.keyboard.press("p");
await page.$eval("#explode", (e) => { e.value = 1; e.dispatchEvent(new Event("input")); });
await page.screenshot({ path: "smoke.png" });
await browser.close();

if (errors.length) { console.error("Erreurs JavaScript :\n" + errors.join("\n")); process.exit(1); }
console.log("OK – capture dans tests/ui/smoke.png");
