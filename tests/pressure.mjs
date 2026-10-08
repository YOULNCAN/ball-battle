import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.ORB_URL || "http://127.0.0.1:5173");
  const fixture = await page.evaluate(async () => {
    const sim = await import("/src/sim.ts");
    const w = sim.createWorld({
      ...sim.DEFAULTS,
      population: 2000,
      kingdoms: 8,
      perKingdom: 250,
      map: "grassland",
      seed: "sustained-pressure",
      events: false,
    });
    // Keep all 2000 bodies alive to measure sustained collision/render load.
    for (const b of w.balls) {
      b.kingdom = 0;
      b.king = false;
      b.hp = b.maxHp = 10000;
    }
    w.balls[0].king = true;
    for (const k of w.kingdoms) k.hp = k.maxHp = 1e6;
    return w;
  });
  await page.locator("#file").setInputFiles({
    name: "stress.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator("#game")).toBeVisible();
  await page.locator("#pause").click();
  const measures = [];
  for (const mode of ["全图1倍", "近景1倍", "全图4倍"]) {
    if (mode === "近景1倍") await page.locator('[data-kingdom="0"]').click();
    if (mode === "全图4倍") {
      await page.locator("#fit").click();
      await page.locator('[data-speed="4"]').click();
    }
    const start = await page.evaluate(() => ({
      ...window.__orbDiagnostics,
      wall: performance.now(),
    }));
    const samples = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      samples.push(await page.evaluate(() => window.__orbDiagnostics));
    }
    const end = await page.evaluate(() => ({
      ...window.__orbDiagnostics,
      wall: performance.now(),
    }));
    expect(end.population).toBe(2000);
    const record = {
      mode,
      population: end.population,
      averageFPS: samples.reduce((n, s) => n + s.fps, 0) / samples.length,
      minimumSampleFPS: Math.min(...samples.map((s) => s.fps)),
      actualSpeed:
        (end.simulationTime - start.simulationTime) /
        ((end.wall - start.wall) / 1000),
      samples: samples.length,
    };
    measures.push(record);
    console.log(JSON.stringify(record));
  }
  expect(errors).toEqual([]);
  await fs.mkdir("test-results", { recursive: true });
  await fs.writeFile(
    "test-results/pressure-metrics.json",
    JSON.stringify(
      {
        environment:
          "Headless Chromium, 1440×1000, deviceScaleFactor 1, 30s wall time",
        fixture:
          "2000 friendly balls with increased health; full collision/territory/render paths, no random events",
        measures,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
