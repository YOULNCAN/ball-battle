import { type World, type Ball, log } from "./sim";
import { BattleGrid } from "./combat";
export const ceased = (w: World, kingdom: number) =>
  w.kingdoms[kingdom].ceasefireUntil > w.time;
export const orderMultiplier = (w: World, b: Ball) =>
  b.orderUntil > w.time ? 1.15 : 1;
export const guardMultiplier = (w: World, b: Ball) =>
  b.king && b.guardUntil > w.time ? 0.75 : 1;
export function royalSkills(w: World) {
  const kings = w.balls.filter((b) => b.king && b.hp > 0);
  const grid = new BattleGrid(w.balls);
  for (const k of kings) {
    if (k.hp <= k.maxHp * 0.6 && k.nextGuard <= w.time) {
      k.guardUntil = w.time + 4;
      k.nextGuard = w.time + 25;
      log(w, `${w.kingdoms[k.kingdom].name}：国王发动自身防护。`);
    }
    if (k.nextOrder > w.time) continue;
    const enemies = Array.from(grid.query(k.x, k.y, 224, k.kingdom));
    const threat =
      enemies.some(
        (b) =>
          b.hp > 0 &&
          b.kingdom !== k.kingdom &&
          Math.hypot(b.x - k.x, b.y - k.y) <= 200 + b.r,
      ) ||
      w.kingdoms.some(
        (c) =>
          c.alive &&
          c.id !== k.kingdom &&
          Math.hypot(c.x - k.x, c.y - k.y) <= 242,
      );
    if (!threat) continue;
    k.nextOrder = w.time + 20;
    for (const b of grid.query(k.x, k.y, 200, -2))
      if (
        b.hp > 0 &&
        b.kingdom === k.kingdom &&
        Math.hypot(b.x - k.x, b.y - k.y) <= 200
      )
        b.orderUntil = Math.max(b.orderUntil, w.time + 6);
    log(w, `${w.kingdoms[k.kingdom].name}：进攻号令，附近友军攻击提高15%。`);
  }
}
