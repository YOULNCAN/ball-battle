import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  failed = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("requestfailed", (r) => failed.push(r.url()));
const diag = () => page.evaluate(() => window.__orbDiagnostics);
await fs.mkdir("test-results", { recursive: true });
async function records() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("ball-kingdom", 1);
        open.onsuccess = () => {
          const db = open.result,
            req = db.transaction("saves").objectStore("saves").getAll();
          req.onsuccess = () => {
            resolve(req.result);
            db.close();
          };
        };
      }),
  );
}
try {
  await page.goto(process.env.ORB_URL || "http://127.0.0.1:5173");
  const legacy = JSON.parse(
    await fs.readFile("tests/fixtures/v1.json", "utf8"),
  );
  // Seed the original IndexedDB store and slots, exactly as a pre-upgrade installation would.
  await page.evaluate(
    async (old) =>
      new Promise((resolve) => {
        const request = indexedDB.open("ball-kingdom", 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("saves", "readwrite");
          for (const slot of ["auto", "manual"])
            tx.objectStore("saves").put({
              slot,
              savedAt: new Date().toISOString(),
              world: old,
            });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    legacy,
  );
  await page.reload();
  await page.locator("#continue").click();
  await page.locator('[data-slot="manual"]').click();
  await page.locator("#pause").click();
  await expect
    .poll(
      async () =>
        (await records()).find((s) => s.slot === "manual").world.version,
    )
    .toBe(5);
  const migrated = (await records()).find((s) => s.slot === "manual").world;
  expect(migrated.rng).toBe(legacy.rng);
  expect(migrated.obstacles).toEqual(legacy.obstacles);
  expect(migrated.balls.map((b) => [b.id, b.x, b.y])).toEqual(
    legacy.balls.map((b) => [b.id, b.x, b.y]),
  );
  expect(migrated.balls.every((b) => b.weapon && b.chargeUntil === 0)).toBe(
    true,
  );
  await page.locator("#back").click();
  // Every biome has actual local audio and a playable seeded world.
  for (const map of [
    "grassland",
    "desert",
    "snow",
    "forest",
    "valley",
    "islands",
  ]) {
    await page.locator("#new").click();
    await page.locator("[name=map]").selectOption(map);
    await page.locator("[name=kingdoms]").fill("8");
    await page.locator("[name=perKingdom]").fill("250");
    await page.locator("[name=seed]").fill(`biome-${map}`);
    await page.locator("[name=cap]").fill("2000");
    await expect(page.locator("#initial-total")).toHaveText("2000");
    await page.getByRole("button", { name: "诞生，开始观察" }).click();
    await expect
      .poll(async () => (await diag()).music.track, { timeout: 15000 })
      .toBe(map);
    await expect.poll(async () => (await diag()).music.playing).toBe(true);
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: `test-results/map-${map}.png`,
      fullPage: true,
    });
    const first = await diag();
    expect(first.map).toBe(map);
    const points = [];
    for (const multiplier of [1, 2, 4]) {
      await page.locator(`[data-speed="${multiplier}"]`).click();
      await page.waitForTimeout(1800);
      points.push({ multiplier, ...(await diag()) });
    }
    await page.locator("#pause").click();
    const held = (await diag()).music.offset;
    await page.waitForTimeout(400);
    expect((await diag()).music.playing).toBe(false);
    expect((await diag()).music.offset).toBeCloseTo(held, 2);
    await page.locator("#settings").click();
    await page.locator("[name=musicVolume]").fill("35");
    await page.locator("[name=volume]").fill("0");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    expect((await diag()).paused).toBe(true);
    await page.locator("#pause").click();
    await page.waitForTimeout(250);
    expect((await diag()).music.playing).toBe(true);
    expect((await diag()).music.volume).toBe(0.35);
    expect((await diag()).music.offset).toBeGreaterThanOrEqual(held);
    await page.locator("#save").click();
    await expect(page.locator("#toast")).toContainText("手动存档已保存");
    const saved = (await records()).find((s) => s.slot === "manual").world;
    expect(saved.version).toBe(5);
    expect(saved.mapType).toBe(map);
    expect(new Set(saved.kingdoms.map((k) => k.weapon)).size).toBe(8);
    expect(
      saved.balls.every((b) => Number.isFinite(b.x) && Number.isFinite(b.hp)),
    ).toBe(true);
    results.push({
      map,
      initial: first,
      samples: points,
      arrowsInSave: saved.projectiles.length,
    });
    await page.locator("#back").click();
    expect((await diag()).music.playing).toBe(false);
  }
  const audio = await page.evaluate(async () => {
    const context = new AudioContext(),
      result = [];
    for (const key of [
      "grassland",
      "desert",
      "snow",
      "forest",
      "valley",
      "islands",
      "battle",
      "victory",
    ]) {
      const response = await fetch(`/music/${key}.mp3`);
      const buffer = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      let energy = 0;
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 97) energy += samples[i] ** 2;
      result.push({
        key,
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        audible: energy > 1,
      });
    }
    await context.close();
    return result;
  });
  expect(
    audio.every(
      (a) =>
        a.audible &&
        a.channels >= 1 &&
        a.duration >= (a.key === "victory" ? 19 : 59),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
  await fs.writeFile(
    "test-results/upgrade-browser.json",
    JSON.stringify({ results, audio, errors, failed }, null, 2),
  );
  console.log(
    "升级浏览器检查通过：原槽位迁移、六类地图、各国等量出兵、武器、箭矢存档、音乐解码和暂停续播。",
  );
} finally {
  await browser.close();
}
