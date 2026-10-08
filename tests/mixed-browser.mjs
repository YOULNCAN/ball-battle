import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const diag = () => page.evaluate(() => window.__orbDiagnostics);
await fs.mkdir("test-results", { recursive: true });
try {
  await page.goto(process.env.ORB_URL || "http://127.0.0.1:5173");
  await page.locator("#new").click();
  await page.locator('[name="perKingdom"]').fill("201");
  await expect(page.locator("#initial-troops")).toContainText("剑兵 26");
  await expect(page.locator("#initial-troops")).toContainText("戟兵 25");
  await page.locator('[name="shape"]').selectOption("circle");
  await page.locator('[name="layout"]').selectOption("lake");
  await page.locator('[name="map"]').selectOption("snow");
  await page.getByRole("button", { name: "诞生，开始观察" }).click();
  await expect(page.locator("#world-title")).toContainText("圆形");
  await expect(page.locator("#world-title")).toContainText("中央湖泊");
  await expect(page.locator(".kingdom-card").first()).toContainText(
    "八兵种混编",
  );
  await expect(page.locator(".kingdom-card").first()).toContainText("剑兵");
  await page.waitForTimeout(1500);
  await page.locator("#pause").click();
  await page.screenshot({
    path: "test-results/circle-lake.png",
    fullPage: true,
  });
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("手动存档已保存");
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const saved = await download;
  await saved.saveAs("test-results/circle-v4.json");
  const world = JSON.parse(
    await fs.readFile("test-results/circle-v4.json", "utf8"),
  );
  expect(world.version).toBe(5);
  expect(world.settings.shape).toBe("circle");
  await page.reload();
  await page.locator("#continue").click();
  await page.locator('[data-slot="manual"]').click();
  expect((await diag()).shape).toBe("circle");
  const fixture = await page.evaluate(async () => {
    const sim = await import("/src/sim.ts");
    const w = sim.createWorld({
      ...sim.DEFAULTS,
      perKingdom: 25,
      map: "forest",
      seed: "v2-mixed-browser",
    });
    w.version = 2;
    w.kingdoms.forEach((k) => {
      k.nextRecruit = w.time + 2.5;
      delete k.recruitProgress;
    });
    delete w.settings.shape;
    delete w.settings.layout;
    for (const b of w.balls) {
      b.weapon = w.kingdoms[b.kingdom].weapon;
      delete b.warCryUsed;
      delete b.warCryUntil;
    }
    return w;
  });
  await page.locator("#file").setInputFiles({
    name: "v2.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator("#toast")).toContainText("旧存档已升级");
  expect((await diag()).paused).toBe(true);
  expect((await diag()).shape).toBe("rectangle");
  await page.locator("#back").click();
  await page.locator("#new").click();
  await page.locator('[name="shape"]').selectOption("circle");
  await page.locator('[name="layout"]').selectOption("arena");
  await page.locator('[name="map"]').selectOption("grassland");
  await page.getByRole("button", { name: "诞生，开始观察" }).click();
  await page.waitForTimeout(1000);
  await page.locator("#pause").click();
  await page.screenshot({
    path: "test-results/circle-arena.png",
    fullPage: true,
  });
  await page.locator(".kingdom-card").first().click();
  await expect(page.locator("#inspector")).toContainText("八兵种混编");
  await expect(page.locator("#inspector")).toContainText("盾兵");
  expect(errors).toEqual([]);
  console.log(
    "混编与圆形地图浏览器检查通过：组成预览、圆形湖泊/竞技场、兵种面板、v4保存恢复、v2立即迁移。",
  );
} finally {
  await browser.close();
}
