import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(process.env.ORB_URL || "http://127.0.0.1:5173");
  const report = await page.evaluate(async () => {
    const sim = await import("/src/sim.ts"),
      weapons = await import("/src/weapons.ts");
    const types = weapons.WEAPON_TYPES,
      result = Object.fromEntries(
        types.map((type) => [
          type,
          { wins: 0, losses: 0, draws: 0, damage: 0, duels: 0 },
        ]),
      );
    for (let left = 0; left < 8; left++)
      for (let right = left + 1; right < 8; right++)
        for (let trial = 0; trial < 12; trial++) {
          const w = sim.createWorld({
            ...sim.DEFAULTS,
            kingdoms: 2,
            perKingdom: 10,
            map: "grassland",
            shape: "circle",
            events: false,
            seed: `balance-${left}-${right}-${trial}`,
          });
          const a = w.balls[0],
            b = w.balls.find((b) => b.kingdom === 1);
          w.balls = [a, b];
          w.obstacles = [];
          w.resources = [];
          w.cells.forEach((c) => {
            c.terrain = "grass";
            c.blocked = false;
            c.owner = -1;
            c.claimant = -1;
            c.progress = 0;
          });
          w.nextEconomy = w.nextHistory = 1e9;
          const distance = [35, 120, 250][trial % 3],
            angle = ((trial % 4) - 1.5) * 0.22;
          for (const [ball, x, vx, type] of [
            [a, 1800 - distance / 2, Math.cos(angle) * 100, types[left]],
            [b, 1800 + distance / 2, -Math.cos(angle) * 100, types[right]],
          ])
            Object.assign(ball, {
              x,
              y: 1200,
              vx,
              vy: Math.sin(angle) * 100,
              r: 10,
              mass: 2,
              hp: 100,
              maxHp: 100,
              attack: 20,
              defense: 5,
              king: true,
              warCryUsed: true,
              warCryUntil: 0,
              skills: [],
              chargeUntil: 0,
              nextAttack: 0,
            });
          for (let frame = 0; frame < 900 && a.hp > 0 && b.hp > 0; frame++)
            sim.step(w);
          for (const [ball, other, type] of [
            [a, b, types[left]],
            [b, a, types[right]],
          ]) {
            const row = result[type];
            row.duels++;
            row.damage += Math.max(0, Math.min(100, 100 - other.hp));
            if (ball.hp > 0 && other.hp <= 0) row.wins++;
            else if (ball.hp <= 0 && other.hp > 0) row.losses++;
            else row.draws++;
          }
        }
    return {
      rules:
        "Equal stats, no ordinary skills or royal bonus, 12 deterministic starts per pair, distances 35/120/250; original straight motion and collisions, 30 simulation seconds maximum. Draws remain draws, not half wins.",
      duels: 336,
      result,
      specs: weapons.WEAPONS,
    };
  });
  expect(report.duels).toBe(336);
  await fs.mkdir("test-results", { recursive: true });
  await fs.writeFile(
    "test-results/balance.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report.result));
} finally {
  await browser.close();
}
