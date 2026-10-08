import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.ORB_URL || "http://127.0.0.1:5173");
  const old = JSON.parse(await fs.readFile("tests/fixtures/v3.json", "utf8"));
  await page
    .locator("#file")
    .setInputFiles({
      name: "v3.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(old)),
    });
  await expect(page.locator("#toast")).toContainText("旧存档已升级");
  await expect(page.locator(".production-info").first()).toContainText(
    "秒 / 批",
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
  expect(saved.version).toBe(5);
  expect(saved.rng).toBe(old.rng);
  expect(
    saved.balls
      .filter((b) => !b.king)
      .every(
        (b) =>
          b.level === 1 &&
          b.skills.length === 0 &&
          b.r === 6 &&
          b.maxHp === 112,
      ),
  ).toBe(true);
  for (const b of saved.balls.filter((b) => b.king))
    expect(b).toEqual(old.balls.find((o) => o.id === b.id));
  await page.locator(".kingdom-card").first().click();
  await expect(page.locator("#inspector")).toContainText("生产倍率");
  await expect(page.locator("#inspector")).toContainText("招募进度");
  // Check what Canvas actually draws, independently of side-panel text.
  await page.evaluate(() => {
    window.__castleLabels = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.__castleLabels.push(text);
      return original.call(this, text, ...args);
    };
  });
  await page.waitForTimeout(250);
  const labels = await page.evaluate(() => window.__castleLabels);
  expect(labels.some((text) => text === old.kingdoms[0].name)).toBe(true);
  expect(labels).not.toContain("八兵种混编");
  await page.screenshot({
    path: "test-results/medieval-castle.png",
    fullPage: true,
  });
  await page.locator("#pause").click();
  await page.waitForTimeout(1200);
  await page.locator("#pause").click();
  expect(errors).toEqual([]);
  console.log(
    "领地生产浏览器检查通过：真实v3重置、国王保留、倍率/进度面板、中世纪城堡文字、暂停续播。",
  );
} finally {
  await browser.close();
}
