import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";

const url = process.env.ORB_PAGES_URL || "http://127.0.0.1:4175/ball-battle/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], failures = [];
page.on("pageerror", e => errors.push(e.message));
page.on("requestfailed", r => failures.push(r.url()));
page.on("response", r => { if(r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });

try {
  await page.goto(url);
  await expect(page).toHaveTitle(/Ball Battle/);
  await page.locator("#new").click();
  await page.getByRole("button", { name: "诞生，开始观察" }).click();
  await expect(page.locator("#game")).toBeVisible();
  await page.waitForTimeout(2500);
  expect((await page.evaluate(() => window.__orbDiagnostics)).simulationTime).toBeGreaterThan(1);
  await page.locator("#pause").click();
  const pausedTime = await page.evaluate(() => window.__orbDiagnostics.simulationTime);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__orbDiagnostics.simulationTime)).toBe(pausedTime);
  const zoom = await page.evaluate(() => document.querySelector("#world").getBoundingClientRect().width);
  expect(zoom).toBeGreaterThan(0);
  await page.locator("#zoom-in").click();
  await page.locator("#zoom-out").click();
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("手动存档已保存");
  for(const track of ["grassland","desert","snow","forest","valley","islands","battle","victory"]){
    const response=await page.request.get(new URL(`music/${track}.mp3`,url).href);
    expect(response.status()).toBe(200);
    expect((await response.body()).length).toBeGreaterThan(100000);
  }
  await expect.poll(async()=> (await page.evaluate(()=>window.__orbDiagnostics)).music.decodedTracks).toBeGreaterThan(0);
  await page.locator("#back").click();
  await page.reload();
  await expect(page.locator("#continue")).toBeEnabled();
  await page.locator("#continue").click();
  await page.getByRole("button",{name:/^手动存档/}).click();
  await expect(page.locator("#game")).toBeVisible();
  await page.locator("#pause").click();
  await page.screenshot({path:"test-results/pages-gameplay.png",fullPage:true});
  expect(errors).toEqual([]);expect(failures).toEqual([]);
  await fs.writeFile("test-results/pages-check.json",JSON.stringify({url,errors,failures,passed:true},null,2));
  console.log("Pages check passed: subdirectory assets, music decoding, simulation, pause, zoom, save, refresh and continue.");
} finally { await browser.close(); }
