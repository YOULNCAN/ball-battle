import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173");
  const fixture = await page.evaluate(async () => {
    const sim = await import("/src/sim.ts");
    const w = sim.createWorld({
      ...sim.DEFAULTS,
      kingdoms: 2,
      perKingdom: 16,
      events: false,
      seed: "batch-browser",
      map: "grassland",
    });
    w.kingdoms.forEach((k) => (k.resources = 0));
    w.kingdoms[0].resources = 180;
    w.kingdoms[0].recruitProgress = 1;
    w.version = 4;
    delete w.blasts;
    delete w.fires;
    return w;
  });
  await page
    .locator("#file")
    .setInputFiles({
      name: "old-v4.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
  await expect(page.locator("#game")).toBeVisible();
  await expect(page.locator(".production-info").first()).toContainText("10球");
  await page.locator("#single").click();
  expect((await page.evaluate(() => window.__orbDiagnostics)).population).toBe(
    42,
  );
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("手动存档已保存");
  const saved = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("ball-kingdom", 1);
        req.onsuccess = () => {
          const db = req.result,
            r = db.transaction("saves").objectStore("saves").get("manual");
          r.onsuccess = () => {
            resolve(r.result.world);
            db.close();
          };
        };
      }),
  );
  expect(saved.kingdoms[0].recruited).toBe(10);
  expect(saved.kingdoms[0].resources).toBe(0);
  expect(saved.kingdoms.map((k) => [k.x, k.y])).toEqual(
    fixture.kingdoms.map((k) => [k.x, k.y]),
  );
  expect(saved.version).toBe(7);
  expect(errors).toEqual([]);
  console.log(
    "Batch browser passed: v4 castle positions retained, ten recruits, 180 cost, batch UI and save.",
  );
} finally {
  await browser.close();
}
