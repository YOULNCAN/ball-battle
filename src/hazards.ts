import { type World, TILE, COLS } from "./sim";
import { segmentRect } from "./combat";
export interface Blast {
  x: number;
  y: number;
  radius: number;
  born: number;
  source: number | null;
}
export interface Fire {
  x: number;
  y: number;
  born: number;
  until: number;
  nextTick: number;
}
const resolved = new WeakMap<World, Set<number>>();
export function mountainBlocked(
  w: World,
  x: number,
  y: number,
  nx: number,
  ny: number,
): boolean {
  for (
    let cy = Math.max(0, Math.floor(Math.min(y, ny) / TILE));
    cy <=
    Math.min(w.cells.length / COLS - 1, Math.floor(Math.max(y, ny) / TILE));
    cy++
  )
    for (
      let cx = Math.max(0, Math.floor(Math.min(x, nx) / TILE));
      cx <= Math.min(COLS - 1, Math.floor(Math.max(x, nx) / TILE));
      cx++
    )
      if (
        w.cells[cx + cy * COLS].terrain === "mountain" &&
        segmentRect(
          x,
          y,
          nx,
          ny,
          cx * TILE,
          cy * TILE,
          (cx + 1) * TILE,
          (cy + 1) * TILE,
        ) !== null
      )
        return true;
  return false;
}
function area(w: World, x: number, y: number, radius: number, damage: number) {
  for (const b of w.balls)
    if (
      b.hp > 0 &&
      Math.hypot(b.x - x, b.y - y) <= radius + b.r &&
      !mountainBlocked(w, x, y, b.x, b.y)
    )
      b.hp -= damage;
}
export function resolveRoyalDeaths(w: World) {
  let seen = resolved.get(w);
  if (!seen) {
    seen = new Set();
    resolved.set(w, seen);
  }
  // Each pass visits only newly dead crown holders; damage cannot create another castle event.
  for (;;) {
    const deaths = w.balls
      .filter((b) => b.king && b.hp <= 0 && !seen!.has(b.id))
      .sort((a, b) => a.id - b.id);
    if (!deaths.length) break;
    for (const b of deaths) {
      seen.add(b.id);
      w.blasts.push({
        x: b.x,
        y: b.y,
        radius: 150,
        born: w.time,
        source: b.id,
      });
      area(w, b.x, b.y, 150, 80);
    }
  }
}
export function castleExplosion(w: World, x: number, y: number) {
  w.blasts.push({ x, y, radius: 140, born: w.time, source: null });
  area(w, x, y, 140, 80);
  resolveRoyalDeaths(w);
  w.fires.push({
    x,
    y,
    born: w.time,
    until: w.time + 15.8,
    nextTick: w.time + 1.3,
  });
}
export function advanceFire(w: World) {
  w.blasts = w.blasts.filter((b) => w.time - b.born < 0.8);
  for (const f of w.fires)
    while (f.nextTick <= w.time + 1e-10 && f.nextTick <= f.until + 1e-10) {
      area(w, f.x, f.y, 110, 6);
      f.nextTick += 0.5;
    }
  w.fires = w.fires.filter((f) => f.until > w.time);
  resolveRoyalDeaths(w);
}
export function forgetRemovedKings(w: World) {
  const seen = resolved.get(w);
  if (seen)
    for (const id of seen)
      if (!w.balls.some((b) => b.id === id)) seen.delete(id);
}
