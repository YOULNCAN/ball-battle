import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  measures = [];
const shape = process.env.ORB_SHAPE === "circle" ? "circle" : "rectangle";
const layout = process.env.ORB_LAYOUT || "normal";
const selected = process.env.ORB_SCENARIOS?.split(",");
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(process.env.ORB_URL || "http://127.0.0.1:5173");
  for (const scenario of [
    "grassland",
    "desert",
    "snow",
    "forest",
    "valley",
    "islands",
    "dense-melee",
    "arrow-rain",
  ]) {
    if (selected && !selected.includes(scenario)) continue;
    const fixture = await page.evaluate(
      async ({ scenario, shape, layout }) => {
        const sim = await import("/src/sim.ts");
        const dense = scenario === "dense-melee" || scenario === "arrow-rain";
        const w = sim.createWorld({
          ...sim.DEFAULTS,
          shape,
          layout,
          kingdoms: dense ? 2 : 8,
          perKingdom: dense ? 1000 : 250,
          cap: 2000,
          map: dense ? "grassland" : scenario,
          seed: `pressure-${scenario}`,
          musicVolume: 0,
          volume: 0,
          events: false,
        });
        for (const k of w.kingdoms) k.hp = k.maxHp = 1e6;
        for (const [i, b] of w.balls.entries()) {
          b.hp = b.maxHp = 10000;
          b.attack = 1;
          b.defense = 35;
          b.king = false;
          if (!dense) b.kingdom = 0;
          else {
            b.chargeUntil = 0;
            b.r = 8;
            b.mass = 1;
            b.vx = i % 2 ? 75 : -75;
            b.vy = 0;
            if (scenario === "dense-melee") {
              b.kingdom = i % 2;
              b.weapon = i % 3 ? "axe" : "hammer";
              b.x = 1100 + (i % 40) * 25;
              b.y = 550 + Math.floor(i / 40) * 25;
            } else {
              b.kingdom = i < 1000 ? 0 : 1;
              b.weapon = b.kingdom ? "crossbow" : "bow";
              b.x = (b.kingdom ? 1750 : 1400) + (i % 20) * 9;
              b.y = 550 + Math.floor((i % 1000) / 20) * 25;
            }
            b.nextAttack = (i % 31) * 0.025;
          }
        }
        for (const k of w.kingdoms) {
          const king = w.balls.find((b) => b.kingdom === k.id);
          if (king) king.king = true;
        }
        if (dense) w.obstacles = [];
        // Let deployment separation settle before measuring a sustained, fixed population.
        for (let i = 0; i < 120; i++) sim.step(w);
        return w;
      },
      { scenario, shape, layout },
    );
    await page.locator("#file").setInputFiles({
      name: "pressure.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await expect(page.locator("#game")).toBeVisible();
    await page.locator("#pause").click();
    for (const speed of [1, 2, 4]) {
      await page.locator(`[data-speed="${speed}"]`).click();
      const start = await page.evaluate(() => ({
        ...window.__orbDiagnostics,
        wall: performance.now(),
      }));
      const samples = [];
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(1000);
        samples.push(await page.evaluate(() => window.__orbDiagnostics));
      }
      const end = await page.evaluate(() => ({
        ...window.__orbDiagnostics,
        wall: performance.now(),
      }));
      expect(end.population).toBe(2000);
      const record = {
        scenario,
        speed,
        population: end.population,
        averageFPS: samples.reduce((sum, s) => sum + s.fps, 0) / samples.length,
        minimumSampleFPS: Math.min(...samples.map((s) => s.fps)),
        actualSpeed:
          (end.simulationTime - start.simulationTime) /
          ((end.wall - start.wall) / 1000),
        maximumArrows: Math.max(...samples.map((s) => s.projectiles)),
        maximumEffects: Math.max(...samples.map((s) => s.particles)),
      };
      measures.push(record);
      console.log(JSON.stringify(record));
    }
    await page.screenshot({
      path: `test-results/pressure-${scenario}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
  await fs.writeFile(
    `test-results/v6-arena-${shape}-${layout}-war-pressure.json`,
    JSON.stringify(
      {
        environment: "Headless Chromium, 1440×1000, device scale factor 1",
        shape,
        version: 6,
        layout,
        fixture:
          "2000 high-health low-attack balls, high-health castles; no rendering or attack rules disabled; muted audio; each speed sampled for 4 seconds after deployment warmup",
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
