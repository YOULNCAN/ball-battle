import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173");
  const fixture = await page.evaluate(async () => {
    const sim = await import("/src/sim.ts"),
      hazards = await import("/src/hazards.ts");
    const w = sim.createWorld({
      ...sim.DEFAULTS,
      kingdoms: 3,
      perKingdom: 40,
      events: false,
      seed: "fire-preview",
      map: "grassland",
    });
    w.cells.forEach((c, i) => {
      if (!c.blocked) c.owner = i % sim.COLS < sim.COLS / 2 ? 0 : 1;
    });
    hazards.castleExplosion(w, 1600, 1200);
    w.time = 1;
    w.kingdoms.forEach((k) => (k.hp = k.maxHp = 10000));
    return w;
  });
  await page.locator("#file").setInputFiles({
    name: "hazards.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator("#game")).toBeVisible();
  const before = await page.evaluate(
    () => window.__orbDiagnostics.simulationTime,
  );
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => window.__orbDiagnostics.simulationTime),
  ).toBe(before);
  await page.screenshot({
    path: "test-results/v5-fire-territory.png",
    fullPage: true,
  });
  await page.locator("#single").click();
  expect(
    await page.evaluate(() => window.__orbDiagnostics.simulationTime),
  ).toBeGreaterThan(before);
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("手动存档已保存");
  await page.reload();
  await page.locator("#continue").click();
  await page.getByRole("button", { name: /手动存档 fire-preview/ }).click();
  await expect(page.locator("#game")).toBeVisible();
  expect(await page.evaluate(() => window.__orbDiagnostics.fires)).toBe(1);
  if (await page.evaluate(() => window.__orbDiagnostics.paused))
    await page.locator("#pause").click();
  await page.waitForTimeout(1600);
  expect(
    await page.evaluate(() => window.__orbDiagnostics.simulationTime),
  ).toBeGreaterThan(2);
  await page.locator("#pause").click();
  expect(errors).toEqual([]);
  await fs.writeFile(
    "test-results/v5-hazards-browser.json",
    JSON.stringify(
      {
        pause: true,
        singleStep: true,
        saveReload: true,
        fireResume: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Hazard rendering, pause, single-step, save and reload passed.");
} finally {
  await browser.close();
}
