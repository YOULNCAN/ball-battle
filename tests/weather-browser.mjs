import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const url = process.env.ORB_URL || "http://127.0.0.1:5173/",
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function input(w) {
  await page
    .locator("#file")
    .setInputFiles({
      name: "weather.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(w)),
    });
  await expect(page.locator("#game")).toBeVisible();
}
async function saved() {
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("手动存档已保存");
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const q = indexedDB.open("ball-kingdom", 1);
        q.onsuccess = () => {
          const db = q.result,
            r = db.transaction("saves").objectStore("saves").get("manual");
          r.onsuccess = () => {
            resolve(r.result.world);
            db.close();
          };
        };
      }),
  );
}
try {
  await page.goto("http://127.0.0.1:5173/");
  const fixtures = await page.evaluate(async () => {
    const { createWorld, DEFAULTS, step } = await import("/src/sim.ts");
    const w = createWorld({
      ...DEFAULTS,
      seed: "natural-rain-showcase",
      map: "islands",
      shape: "circle",
      layout: "lake",
      kingdoms: 4,
      perKingdom: 200,
    });
    for (let i = 0; i < 60; i++) step(w);
    const k = w.kingdoms[0],
      king = w.balls.find((b) => b.king && b.kingdom === 0);
    w.time = 2;
    k.ceasefireUntil = 12;
    king.orderUntil = 8;
    king.nextOrder = 22;
    king.guardUntil = 6;
    king.nextGuard = 27;
    Object.assign(king, { x: k.x + 65, y: k.y, vx: 0, vy: 0 });
    w.weather.rain = { x: k.x, y: k.y, radius: 450, born: 2, until: 17 };
    w.weather.storm = {
      x: k.x,
      y: k.y,
      radius: 450,
      born: 1,
      until: 13,
      warnings: 1,
      nextWarning: 4,
    };
    w.weather.strikes = [{ x: king.x, y: king.y, warned: 2, at: 3 }];
    const old = structuredClone(w);
    old.version = 6;
    delete old.weather;
    delete old.terrainBoundaryVersion;
    return { w, old, kingId: king.id };
  });
  if (url !== "http://127.0.0.1:5173/") await page.goto(url);
  await input(fixtures.old);
  await expect(page.locator("#toast")).toContainText("升级");
  const migrated = await saved();
  expect(migrated.version).toBe(7);
  expect(migrated.rng).toBe(fixtures.old.rng);
  expect(migrated.kingdoms.every((k) => k.ceasefireUntil === 0)).toBe(true);
  await input(fixtures.w);
  await expect(page.locator(".ceasefire").first()).toContainText("10秒");
  const before = await saved();
  await page.waitForTimeout(250);
  expect((await saved()).time).toBe(before.time);
  await page.locator(".kingdom-card").first().click();
  const box = await page.locator("#world").boundingBox();
  await page.mouse.click(
    box.x + box.width / 2 + 65 * 0.8,
    box.y + box.height / 2,
  );
  await expect(page.locator("#inspector")).toContainText("进攻号令");
  await expect(page.locator("#inspector")).toContainText("自身防护");
  await page.keyboard.press("f");
  await page.waitForTimeout(200);
  await page.screenshot({
    path: "test-results/natural-weather.png",
    fullPage: true,
  });
  if (!process.env.ORB_URL)
    await page.screenshot({ path: "docs/natural-map.png", fullPage: true });
  const malformed = {
    ...before,
    weather: {
      ...before.weather,
      strikes: [{ x: 1, y: 2, warned: 2, at: 99 }],
    },
  };
  await input(malformed);
  await expect(page.locator("#toast")).toContainText("损坏");
  expect(await saved()).toEqual(before);
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await download;
  const exported = JSON.parse(await fs.readFile(await file.path(), "utf8"));
  expect(exported).toEqual(before);
  await page.reload();
  await page.locator("#continue").click();
  await page.getByRole("button", { name: /^手动存档/ }).click();
  await page.locator("#pause").click();
  const resumed = await saved();
  expect(resumed.weather.strikes).toHaveLength(1);
  expect(resumed.kingdoms[0].ceasefireUntil).toBe(12);
  await page.locator("#settings").click();
  await page.locator('[name="events"]').uncheck();
  await page.getByRole("button", { name: "保存设置" }).click();
  const disabled = await saved();
  expect(disabled.weather.rain).toBeNull();
  expect(disabled.weather.storm).toBeNull();
  expect(disabled.weather.strikes).toEqual([]);
  await input(before);
  await page.locator('[data-speed="4"]').click();
  await page.locator("#single").click();
  expect((await saved()).time - before.time).toBeCloseTo(1 / 30);
  expect(errors).toEqual([]);
  await fs.writeFile(
    "test-results/weather-browser.json",
    JSON.stringify({ url, passed: true, errors }, null, 2),
  );
  console.log(
    "Weather browser passed: v6 migration, rain/warnings, royal details, pause, JSON, invalid import, reload, events toggle and single step.",
  );
} finally {
  await browser.close();
}
