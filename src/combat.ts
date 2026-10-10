import { ceased, orderMultiplier } from "./royal";
import { naturalRay } from "./natural";
import { resolveRoyalDeaths } from "./hazards";
import { wallHit } from "./arena";
import {
  COLS,
  TILE,
  WIDTH,
  HEIGHT,
  damage,
  reward,
  conquer,
  type World,
  type Ball,
  type Kingdom,
  type Effect,
} from "./sim";
import { WEAPONS, type Weapon } from "./weapons";
import { insideBoundary } from "./maps";
export interface Projectile {
  id: number;
  source: number;
  kingdom: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  remaining: number;
  attack: number;
  heavy: boolean;
  vamp: boolean;
  weapon: Weapon;
}
const SIZE = 128;

export class BattleGrid {
  readonly columns = Math.ceil(WIDTH / SIZE);
  readonly rows = Math.ceil(HEIGHT / SIZE);
  buckets = new Map<number, { kingdom: number; balls: Ball[] }>();
  constructor(balls: Ball[]) {
    for (const b of balls) {
      const gx = Math.max(
          0,
          Math.min(this.columns - 1, Math.floor(b.x / SIZE)),
        ),
        gy = Math.max(0, Math.min(this.rows - 1, Math.floor(b.y / SIZE)));
      const key = gx + gy * this.columns;
      const bucket = this.buckets.get(key);
      if (bucket) {
        bucket.balls.push(b);
        if (bucket.kingdom !== b.kingdom) bucket.kingdom = -1;
      } else this.buckets.set(key, { kingdom: b.kingdom, balls: [b] });
    }
  }
  *query(
    x: number,
    y: number,
    radius: number,
    excludeKingdom: number,
  ): Generator<Ball> {
    for (
      let gy = Math.max(0, Math.floor((y - radius) / SIZE));
      gy <= Math.min(this.rows - 1, Math.floor((y + radius) / SIZE));
      gy++
    )
      for (
        let gx = Math.max(0, Math.floor((x - radius) / SIZE));
        gx <= Math.min(this.columns - 1, Math.floor((x + radius) / SIZE));
        gx++
      ) {
        const bucket = this.buckets.get(gx + gy * this.columns);
        // Conquest only merges factions. Callers additionally check live allegiance.
        if (!bucket || bucket.kingdom === excludeKingdom) continue;
        for (const b of bucket.balls) yield b;
      }
  }
}
export function segmentCircle(
  x: number,
  y: number,
  nx: number,
  ny: number,
  cx: number,
  cy: number,
  r: number,
): number | null {
  const dx = nx - x,
    dy = ny - y,
    fx = x - cx,
    fy = y - cy,
    a = dx * dx + dy * dy;
  if (fx * fx + fy * fy <= r * r) return 0;
  if (a < 1e-10) return null;
  const b = 2 * (fx * dx + fy * dy),
    c = fx * fx + fy * fy - r * r,
    disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
export function segmentRect(
  x: number,
  y: number,
  nx: number,
  ny: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number | null {
  let lo = 0,
    hi = 1;
  for (const [start, delta, min, max] of [
    [x, nx - x, left, right],
    [y, ny - y, top, bottom],
  ]) {
    if (Math.abs(delta) < 1e-10) {
      if (start < min || start > max) return null;
    } else {
      const a = (min - start) / delta,
        b = (max - start) / delta;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
      if (lo > hi) return null;
    }
  }
  return lo;
}
export function blocker(
  w: World,
  x: number,
  y: number,
  nx: number,
  ny: number,
): number {
  let nearest = wallHit(w, x, y, nx, ny);
  for (const o of w.obstacles) {
    const t = segmentCircle(x, y, nx, ny, o.x, o.y, o.r);
    if (t !== null) nearest = Math.min(nearest, t);
  }
  if (w.terrainBoundaryVersion === 1)
    return Math.min(nearest, naturalRay(w, x, y, nx, ny));
  for (
    let cy = Math.max(0, Math.floor(Math.min(y, ny) / TILE));
    cy <= Math.min(HEIGHT / TILE - 1, Math.floor(Math.max(y, ny) / TILE));
    cy++
  )
    for (
      let cx = Math.max(0, Math.floor(Math.min(x, nx) / TILE));
      cx <= Math.min(COLS - 1, Math.floor(Math.max(x, nx) / TILE));
      cx++
    ) {
      if (w.cells[cx + cy * COLS].terrain !== "mountain") continue;
      const t = segmentRect(
        x,
        y,
        nx,
        ny,
        cx * TILE,
        cy * TILE,
        (cx + 1) * TILE,
        (cy + 1) * TILE,
      );
      if (t !== null) nearest = Math.min(nearest, t);
    }
  return nearest;
}
function showHit(
  w: World,
  target: { x: number; y: number },
  amount: number,
  kingdom: number,
  effects: Effect[],
) {
  w.combatHits++;
  if (effects.length < 100)
    effects.push({
      x: target.x,
      y: target.y,
      text: `−${Math.round(amount)}`,
      color: w.kingdoms[kingdom].color,
      kind: "hit",
    });
}
function credit(w: World, source: Ball | undefined, kingdom: number) {
  if (source && source.hp > 0) reward(w, source);
  else if (w.kingdoms[kingdom].alive) w.kingdoms[kingdom].kills++;
}
function hurtBall(
  w: World,
  attacker: Ball,
  target: Ball,
  multiplier: number,
  effects: Effect[],
  source: Ball | undefined = attacker,
) {
  if (
    target.hp <= 0 ||
    target.kingdom === attacker.kingdom ||
    ceased(w, attacker.kingdom)
  )
    return;
  const amount = damage(w, attacker, target, 0) * multiplier;
  target.hp -= amount;
  showHit(w, target, amount, attacker.kingdom, effects);
  if (
    source &&
    source.hp > 0 &&
    source.level < 10 &&
    attacker.skills.includes("吸血")
  )
    source.hp = Math.min(source.maxHp, source.hp + amount * 0.15);
  if (target.hp <= 0) {
    credit(w, source, attacker.kingdom);
    resolveRoyalDeaths(w);
  }
}
function hurtCastle(
  w: World,
  attacker: Ball,
  target: Kingdom,
  multiplier: number,
  effects: Effect[],
  source: Ball | undefined = attacker,
) {
  if (!target.alive || target.id === attacker.kingdom) return;
  const amount = Math.max(
    2,
    attacker.attack *
      multiplier *
      (attacker.skills.includes("重击") ? 1.25 : 1) *
      (attacker.king && attacker.warCryUntil > w.time ? 1.25 : 1) *
      orderMultiplier(w, attacker),
  );
  target.hp -= amount;
  showHit(w, target, amount, attacker.kingdom, effects);
  if (target.hp <= 0) conquer(w, target, source ?? attacker);
}
export function weaponCombat(w: World, dt: number, effects: Effect[]) {
  const grid = new BattleGrid(w.balls);
  for (const a of w.balls) {
    const spec = WEAPONS[a.weapon];
    if (a.hp <= 0 || a.nextAttack > w.time || a.weapon === "shield") continue;
    let target: Ball | Kingdom | undefined,
      distance = Infinity;
    for (const b of grid.query(a.x, a.y, spec.range + a.r + 24, a.kingdom)) {
      if (b.hp <= 0 || b.kingdom === a.kingdom || ceased(w, a.kingdom))
        continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y) - b.r - a.r;
      if (
        d <= spec.range &&
        d < distance &&
        (spec.projectile || blocker(w, a.x, a.y, b.x, b.y) === Infinity)
      ) {
        target = b;
        distance = d;
      }
    }
    for (const k of w.kingdoms)
      if (k.alive && k.id !== a.kingdom) {
        const d = Math.hypot(k.x - a.x, k.y - a.y) - 42 - a.r;
        if (
          d <= spec.range &&
          d < distance &&
          (spec.projectile || blocker(w, a.x, a.y, k.x, k.y) === Infinity)
        ) {
          target = k;
          distance = d;
        }
      }
    if (!target) {
      a.nextAttack = w.time + 0.1;
      continue;
    }
    const angle = Math.atan2(target.y - a.y, target.x - a.x);
    a.attackAngle = angle;
    a.attackUntil = w.time + 0.2;
    a.nextAttack = w.time + spec.cooldown;
    if (spec.projectile) {
      const speed = a.weapon === "crossbow" ? 720 : 550;
      w.projectiles.push({
        id: w.nextId++,
        source: a.id,
        kingdom: a.kingdom,
        x: a.x + Math.cos(angle) * a.r,
        y: a.y + Math.sin(angle) * a.r,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        remaining: spec.range + 60,
        attack:
          a.attack *
          (a.king && a.warCryUntil > w.time ? 1.25 : 1) *
          orderMultiplier(w, a),
        heavy: a.skills.includes("重击"),
        vamp: a.skills.includes("吸血"),
        weapon: a.weapon,
      });
    } else if (spec.arc === 0) {
      if ("kingdom" in target) hurtBall(w, a, target, spec.multiplier, effects);
      else hurtCastle(w, a, target, spec.multiplier, effects);
    } else {
      const inArc = (t: { x: number; y: number }, r: number) =>
        Math.hypot(t.x - a.x, t.y - a.y) - r - a.r <= spec.range &&
        (spec.arc >= Math.PI * 2 ||
          Math.cos(Math.atan2(t.y - a.y, t.x - a.x) - angle) >=
            Math.cos(spec.arc / 2)) &&
        blocker(w, a.x, a.y, t.x, t.y) === Infinity;
      const targets: (Ball | Kingdom)[] = [];
      for (const b of grid.query(a.x, a.y, spec.range + a.r + 24, a.kingdom))
        if (
          !ceased(w, a.kingdom) &&
          b.hp > 0 &&
          b.kingdom !== a.kingdom &&
          inArc(b, b.r)
        )
          targets.push(b);
      for (const k of w.kingdoms)
        if (k.alive && k.id !== a.kingdom && inArc(k, 42)) targets.push(k);
      targets.sort(
        (left, right) =>
          Math.hypot(left.x - a.x, left.y - a.y) -
            Math.hypot(right.x - a.x, right.y - a.y) || left.id - right.id,
      );
      const selected = targets.slice(0, 4),
        multiplier = spec.multiplier / Math.sqrt(selected.length || 1);
      for (const b of selected) {
        if (a.hp <= 0) break;
        if ("kingdom" in b) {
          hurtBall(w, a, b, multiplier, effects);
          if (a.weapon === "hammer") {
            b.vx += Math.cos(Math.atan2(b.y - a.y, b.x - a.x)) * 55;
            b.vy += Math.sin(Math.atan2(b.y - a.y, b.x - a.x)) * 55;
          }
        } else hurtCastle(w, a, b, multiplier, effects);
      }
    }
  }
  const byId = new Map(w.balls.map((b) => [b.id, b])),
    surviving: Projectile[] = [];
  for (const p of w.projectiles) {
    if (!w.kingdoms[p.kingdom].alive) continue;
    const length = Math.hypot(p.vx, p.vy),
      travel = Math.min(p.remaining, length * dt),
      nx = p.x + (p.vx / length) * travel,
      ny = p.y + (p.vy / length) * travel;
    let nearest = blocker(w, p.x, p.y, nx, ny),
      target: Ball | Kingdom | undefined;
    for (const b of grid.query(
      (p.x + nx) / 2,
      (p.y + ny) / 2,
      travel / 2 + 26,
      p.kingdom,
    )) {
      if (b.hp <= 0 || b.kingdom === p.kingdom) continue;
      const t = segmentCircle(p.x, p.y, nx, ny, b.x, b.y, b.r + 2);
      if (t !== null && t < nearest) {
        nearest = t;
        target = b;
      }
    }
    for (const k of w.kingdoms)
      if (k.alive && k.id !== p.kingdom) {
        const t = segmentCircle(p.x, p.y, nx, ny, k.x, k.y, 44);
        if (t !== null && t < nearest) {
          nearest = t;
          target = k;
        }
      }
    if (target) {
      const source = byId.get(p.source);
      // Snapshot offensive attributes while keeping allegiance current after conquest.
      const attacker = {
        ...(source ?? w.balls[0]),
        id: p.source,
        hp: source?.hp ?? 0,
        mass: source?.mass ?? 1,
        x: p.x,
        y: p.y,
        kingdom: p.kingdom,
        king: false,
        attack: p.attack,
        orderUntil: 0,
        weapon: p.weapon,
        skills: [...(p.heavy ? ["重击"] : []), ...(p.vamp ? ["吸血"] : [])],
      } as Ball;
      if ("kingdom" in target)
        hurtBall(
          w,
          attacker,
          target,
          WEAPONS[p.weapon].multiplier,
          effects,
          source,
        );
      else
        hurtCastle(
          w,
          attacker,
          target,
          WEAPONS[p.weapon].multiplier,
          effects,
          source,
        );
    } else if (
      nearest === Infinity &&
      nx >= 0 &&
      nx <= WIDTH &&
      ny >= 0 &&
      ny <= HEIGHT &&
      insideBoundary(w, nx, ny) &&
      p.remaining - travel > 1e-6
    ) {
      p.x = nx;
      p.y = ny;
      p.remaining -= travel;
      surviving.push(p);
    }
  }
  w.projectiles = surviving;
}
