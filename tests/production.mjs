import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(process.env.ORB_PREVIEW_URL || "http://127.0.0.1:4173");
  await expect(page.locator("#menu")).toBeVisible();
  await page.locator("#new").click();
  await page.getByRole("button", { name: "诞生，开始观察" }).click();
  await expect(page.locator("#game")).toBeVisible();
  await page.waitForTimeout(2500);
  const snapshot = await page.evaluate(() => window.__orbDiagnostics);
  expect(snapshot.simulationTime).toBeGreaterThan(1);
  await page.locator("#pause").click();
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("手动存档已保存");
  await page.locator("#back").click();
  await page.reload();
  await expect(page.locator("#continue")).toBeEnabled();
  expect(errors).toEqual([]);
  console.log("生产构建检查通过：资源加载、新局、模拟、保存、刷新继续。");
} finally {
  await browser.close();
}
