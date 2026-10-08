import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const out = path.resolve("test-results");
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [],
  network = [],
  metrics = {};
page.on("pageerror", (e) => errors.push(e.message));
page.on("requestfailed", (r) =>
  network.push(`${r.url()}: ${r.failure()?.errorText}`),
);
await page.addInitScript(() => {
  window.__audioNotes = 0;
  const original = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function (...args) {
    window.__audioNotes++;
    return original.apply(this, args);
  };
});
const diag = () => page.evaluate(() => window.__orbDiagnostics);
async function screenshot(name) {
  await page.screenshot({
    path: path.join(out, `${name}.png`),
    fullPage: true,
  });
}
async function saveRecords() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("ball-kingdom", 1);
        req.onsuccess = () => {
          const db = req.result,
            r = db.transaction("saves").objectStore("saves").getAll();
          r.onsuccess = () => {
            resolve(r.result);
            db.close();
          };
          r.onerror = reject;
        };
        req.onerror = reject;
      }),
  );
}
async function importWorld(w) {
  await page.locator("#file").setInputFiles({
    name: "world.json",
    mimeType: "application/json",
    buffer: Buffer.from(typeof w === "string" ? w : JSON.stringify(w)),
  });
}
try {
  await page.goto(process.env.ORB_URL || "http://127.0.0.1:5173");
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator("#continue")).toBeDisabled();
  await screenshot("01-menu");
  await page.locator("#help").click();
  await expect(page.locator("#dialog")).toBeVisible();
  await page.locator("#close-dialog").click();
  await page.locator("#new").click();
  await page.locator("[name=seed]").fill("browser-pressure");
  await page.locator("[name=kingdoms]").fill("8");
  await page.locator("[name=perKingdom]").fill("250");
  await page.locator("[name=map]").selectOption("grassland");
  await page.locator("[name=cap]").fill("1000");
  await page.getByRole("button", { name: "诞生，开始观察" }).click();
  await expect(page.locator("#form-error")).toContainText("不能超过");
  await page.locator("[name=cap]").fill("2000");
  await page.getByRole("button", { name: "诞生，开始观察" }).click();
  await expect(page.locator("#game")).toBeVisible();
  await page.waitForTimeout(12000);
  metrics.oneX = await diag();
  await screenshot("02-world");
  await page.locator('[data-speed="2"]').click();
  await page.waitForTimeout(7000);
  metrics.twoX = await diag();
  await page.locator('[data-speed="4"]').click();
  await page.waitForTimeout(8000);
  metrics.fourX = await diag();
  console.log("2000球运行采样", JSON.stringify(metrics));
  await page.keyboard.press("Space");
  expect((await diag()).paused).toBe(true);
  const stopped = (await diag()).simulationTime;
  await page.waitForTimeout(500);
  expect((await diag()).simulationTime).toBe(stopped);
  await page.locator("#single").click();
  expect((await diag()).simulationTime).toBeCloseTo(stopped + 1 / 30, 8);
  const beforeZoom = await page.locator("#performance").textContent();
  await page.locator("#zoom-in").click();
  await page.waitForTimeout(400);
  expect(await page.locator("#performance").textContent()).not.toBe(beforeZoom);
  const bounds = await page.locator("#world").boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 90,
    bounds.y + bounds.height / 2 + 35,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await page.keyboard.press("f");
  await page.locator('[data-kingdom="0"]').click();
  await expect(page.locator("#inspector")).toContainText("城堡生命");
  await screenshot("03-kingdom-detail");
  // Persist both independent slots, then verify a refresh can restore them.
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("手动存档已保存");
  const manual = (await saveRecords()).find((s) => s.slot === "manual");
  expect(manual).toBeTruthy();
  await page.locator("#settings").click();
  await page.locator("[name=quality]").selectOption("low");
  await page.locator("[name=volume]").fill("0");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.locator("#back").click();
  await expect(page.locator("#menu")).toBeVisible();
  expect((await saveRecords()).map((s) => s.slot).sort()).toEqual([
    "auto",
    "manual",
  ]);
  metrics.audioNotes = await page.evaluate(() => window.__audioNotes);
  await page.reload();
  await expect(page.locator("#continue")).toBeEnabled();
  await page.locator("#continue").click();
  await page.locator('[data-slot="manual"]').click();
  await page.locator("#pause").click();
  expect((await diag()).simulationTime).toBeGreaterThanOrEqual(
    manual.world.time,
  );
  // Native file export round-trip and non-destructive import failure.
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadPromise;
  const exportPath = path.join(out, "export.json");
  await download.saveAs(exportPath);
  const exported = JSON.parse(await fs.readFile(exportPath, "utf8"));
  expect(exported.version).toBe(5);
  expect(exported.balls.length).toBeGreaterThan(0);
  await page.locator("#import").click(); // File picker is intercepted by setInputFiles.
  const beforeBad = await diag();
  await importWorld("{invalid");
  await expect(page.locator("#toast")).toContainText("存档损坏");
  expect((await diag()).simulationTime).toBe(beforeBad.simulationTime);
  expect((await diag()).population).toBe(beforeBad.population);
  await importWorld(exported);
  await expect(page.locator("#toast")).toContainText("导入成功");
  expect((await diag()).paused).toBe(true);
  expect((await diag()).simulationTime).toBe(exported.time);
  // Select a known ball using actual projection, then inspect skills / health UI.
  await page.locator("#fit").click();
  const box = await page.locator("#world").boundingBox();
  const selected =
    exported.balls.find(
      (b) => b.x > 800 && b.x < 2200 && b.y > 600 && b.y < 1500,
    ) || exported.balls[0];
  const zoom = Math.min(box.width / 3800, box.height / 2600);
  await page.mouse.click(
    box.x + box.width / 2 + (selected.x - 1800) * zoom,
    box.y + box.height / 2 + (selected.y - 1200) * zoom,
  );
  await expect(page.locator("#inspector")).toContainText("球球 #");
  // Deterministic fixture exercises the same production conquest and settlement path.
  const result = await page.evaluate(async () => {
    const sim = await import("/src/sim.ts");
    const w = sim.createWorld({
      ...sim.DEFAULTS,
      kingdoms: 2,
      population: 20,
      cap: 100,
    });
    sim.conquer(
      w,
      w.kingdoms[1],
      w.balls.find((b) => b.kingdom === 0),
    );
    for (let i = 0; i < 12; i++) {
      w.time++;
      sim.updateTerritory(w, 1);
    }
    return w;
  });
  await importWorld(result);
  await expect(page.locator("#dialog")).toBeVisible();
  await expect(page.locator("#dialog-body")).toContainText("统一世界");
  await expect(page.locator("#history-chart")).toBeVisible();
  await expect.poll(async () => (await diag()).music.track).toBe("victory");
  await expect.poll(async () => (await diag()).music.playing).toBe(true);
  await screenshot("04-result");
  await page.locator("#result-map").click();
  await page.locator("#back").click();
  // Import and frame layout also work at a smaller desktop viewport.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator("#continue").click();
  await page.locator('[data-slot="manual"]').click();
  await page.locator("#pause").click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  await screenshot("05-small-desktop");
  metrics.audioNotes += await page.evaluate(() => window.__audioNotes);
  expect(metrics.audioNotes).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  expect(network).toEqual([]);
  metrics.errors = errors;
  metrics.networkFailures = network;
  await fs.writeFile(
    path.join(out, "browser-metrics.json"),
    JSON.stringify(metrics, null, 2),
  );
  console.log(
    "浏览器检查通过：菜单、设置、2000球、镜头、暂停单步、双槽存档、刷新、JSON、结算、音效、无脚本错误。",
  );
} finally {
  await browser.close();
}
