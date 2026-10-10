import { describe, it, expect } from "vitest";
import {
  createWorld,
  DEFAULTS,
  step,
  collide,
  damage,
  cleanup,
  recruit,
  COLS,
  TILE,
  WIDTH,
  HEIGHT,
  type World,
} from "../src/sim";
import {
  advanceWeather,
  lightning,
  initialWeather,
  raining,
} from "../src/weather";
import { royalSkills } from "../src/royal";
import { resolveRoyalDeaths } from "../src/hazards";
import { weaponCombat } from "../src/combat";
import { motionScale } from "../src/physics";
import {
  terrainAt,
  terrainBlocked,
  moveOnTerrain,
  MAP_TYPES,
  connectedCastles,
  syncNaturalWorld,
} from "../src/maps";
import { invalidateNatural, naturalMap, naturalRay } from "../src/natural";
import { importSave } from "../src/storage";
import { ARENA_WALL } from "../src/arena";
function fixture(): World {
  const w = createWorld({
    ...DEFAULTS,
    kingdoms: 2,
    perKingdom: 16,
    events: false,
    map: "grassland",
    seed: "weather-royal",
  });
  w.obstacles = [];
  w.resources = [];
  w.balls.forEach((b, i) =>
    Object.assign(b, {
      king: false,
      hp: 112,
      maxHp: 112,
      x: 400 + i * 35,
      y: 450,
      vx: 0,
      vy: 0,
      chargeUntil: 0,
      nextAttack: 1000,
      skills: [],
    }),
  );
  w.kingdoms.forEach((k) => {
    k.resources = 0;
    k.recruitProgress = 0;
  });
  return w;
}
describe("weather and royal command", () => {
  it("schedules independently, warns a second early and delivers six random ground strikes", () => {
    const w = fixture();
    w.settings.events = true;
    w.weather.nextRain = 0;
    w.weather.nextStorm = 0;
    advanceWeather(w);
    expect(w.weather.rain!.until).toBe(15);
    expect(w.weather.storm!.until).toBe(12);
    expect(w.weather.strikes).toEqual([]);
    w.time = 1;
    advanceWeather(w);
    expect(w.weather.strikes[0].at).toBe(2);
    expect(w.blasts).toEqual([]);
    expect(w.weather.nextRain).toBeGreaterThanOrEqual(45);
    expect(w.weather.nextRain).toBeLessThanOrEqual(75);
    expect(w.weather.nextStorm).not.toBe(w.weather.nextRain);
    for (let i = 1; i <= 12; i++) {
      w.time = i;
      advanceWeather(w);
    }
    expect(w.blasts.filter((b) => b.lightning)).toHaveLength(6);
    expect(w.blasts.filter((b) => b.lightning).map((b) => b.born)).toEqual([
      2, 4, 6, 8, 10, 12,
    ]);
    expect(w.weather.storm).toBeNull();
  });
  it("kills only wet, unshielded-by-terrain balls in the lightning blast and preserves castles and rewards", () => {
    const w = fixture(),
      [a, b, c] = w.balls;
    w.weather.rain = { x: 200, y: 900, radius: 450, born: 0, until: 15 };
    Object.assign(a, {
      x: 630,
      y: 900,
      king: true,
      guardUntil: 4,
      hp: 10000,
      maxHp: 10000,
    });
    Object.assign(b, { x: 680, y: 900, hp: 500, maxHp: 500 });
    Object.assign(c, { x: 1000, y: 900 });
    const castles = w.kingdoms.map((k) => k.hp);
    lightning(w, 680, 900);
    expect(a.hp).toBe(0);
    expect(b.hp).toBe(340); // normal lightning plus the king's passive death blast
    expect(c.hp).toBe(112);
    expect(w.kingdoms.map((k) => k.hp)).toEqual(castles);
    expect(w.kingdoms[a.kingdom].ceasefireUntil).toBe(10);
    expect(w.kingdoms.every((k) => k.kills === 0)).toBe(true);
  });
  it("uses the same mountain and obstacle shielding for lightning", () => {
    const w = fixture(),
      b = w.balls[0];
    Object.assign(b, { x: 900, y: 900 });
    w.obstacles = [{ x: 850, y: 900, r: 20 }];
    lightning(w, 800, 900);
    expect(b.hp).toBe(112);
  });
  it("multiplies rain with terrain, charge and speed skill without changing base velocity", () => {
    const w = fixture(),
      b = w.balls[0];
    Object.assign(b, {
      x: 660,
      y: 660,
      vx: 75,
      chargeUntil: 3,
      skills: ["加速"],
    });
    w.cells[5 + 5 * COLS].terrain = "sand";
    invalidateNatural(w);
    w.weather.rain = { x: b.x, y: b.y, radius: 450, born: 0, until: 15 };
    expect(motionScale(w, b)).toBeCloseTo((0.6 * 0.7 * 2 * 5) / 3);
    expect(b.vx).toBe(75);
    w.settings.events = false;
    advanceWeather(w);
    expect(raining(w, b.x, b.y)).toBe(false);
    expect(w.weather.strikes).toEqual([]);
  });
  it("blocks lightning at the arena wall while admitting a strike through a cardinal gate", () => {
    for (const angle of [0, Math.PI / 4]) {
      const w = fixture(),
        b = w.balls[0];
      w.arenaWall = { ...ARENA_WALL };
      w.balls = [b];
      const x = WIDTH / 2,
        y = HEIGHT / 2;
      Object.assign(b, {
        x: x + 410 * Math.cos(angle),
        y: y + 410 * Math.sin(angle),
      });
      lightning(w, x + 340 * Math.cos(angle), y + 340 * Math.sin(angle));
      expect(b.hp).toBe(angle === 0 ? 32 : 112);
    }
  });
  it("keeps orders outside their casting radius and refreshes instead of stacking", () => {
    const w = fixture(),
      [king, ally, enemy] = w.balls;
    Object.assign(king, { king: true, x: 800, y: 800 });
    Object.assign(ally, { x: 850, y: 800, kingdom: king.kingdom });
    Object.assign(enemy, { x: 900, y: 800, kingdom: 1 });
    royalSkills(w);
    const boosted = damage(w, ally, enemy, 0);
    ally.x = 1600;
    w.time = 5;
    royalSkills(w);
    expect(damage(w, ally, enemy, 0)).toBe(boosted);
    w.time = 6;
    expect(damage(w, ally, enemy, 0)).toBeLessThan(boosted);
    ally.x = 850;
    w.time = 20;
    royalSkills(w);
    expect(ally.orderUntil).toBe(26);
    expect(damage(w, ally, enemy, 0)).toBe(boosted);
  });
  it("grants a timed non-stacking order and a separate defensive cooldown", () => {
    const w = fixture(),
      [k, ally, enemy] = w.balls;
    Object.assign(k, { king: true, x: 800, y: 800, hp: 60 });
    Object.assign(ally, { x: 850, y: 800, kingdom: k.kingdom });
    Object.assign(enemy, { x: 900, y: 800, kingdom: 1 });
    royalSkills(w);
    expect(k.nextOrder).toBe(20);
    expect(k.guardUntil).toBe(4);
    expect(k.nextGuard).toBe(25);
    expect(ally.orderUntil).toBe(6);
    const boosted = damage(w, ally, enemy, 0);
    ally.orderUntil = 0;
    expect(boosted).toBeGreaterThan(damage(w, ally, enemy, 0));
    const guarded = damage(w, enemy, k, 0);
    k.guardUntil = 0;
    expect(guarded).toBeCloseTo(damage(w, enemy, k, 0) * 0.75);
    w.time = 1;
    royalSkills(w);
    expect(k.nextOrder).toBe(20);
    expect(k.nextGuard).toBe(25);
  });
  it("ceases only outgoing ball damage and resumes at exactly ten seconds", () => {
    const w = fixture(),
      [a, b] = w.balls;
    Object.assign(a, { x: 800, y: 800 });
    Object.assign(b, { x: 809, y: 800, kingdom: 1 });
    w.kingdoms[a.kingdom].ceasefireUntil = 10;
    collide(w, a, b);
    expect(a.hp).toBeLessThan(112);
    expect(b.hp).toBe(112);
    w.time = 10;
    expect(damage(w, a, b, 0)).toBeGreaterThan(0);
  });
  it("allows castle attacks but consumes outgoing arrows without hurting balls during mourning", () => {
    const w = fixture(),
      [a, b] = w.balls;
    w.kingdoms[0].ceasefireUntil = 10;
    Object.assign(a, { kingdom: 0, x: 800, y: 800, weapon: "bow" });
    Object.assign(b, { kingdom: 1, x: 830, y: 800 });
    w.projectiles = [
      {
        id: w.nextId++,
        source: a.id,
        kingdom: 0,
        x: 810,
        y: 800,
        vx: 550,
        vy: 0,
        remaining: 200,
        attack: 20,
        heavy: false,
        vamp: false,
        weapon: "bow",
      },
    ];
    weaponCombat(w, 0.1, []);
    expect(b.hp).toBe(112);
    expect(w.projectiles).toHaveLength(0);
    const castle = w.kingdoms[1];
    Object.assign(a, {
      x: castle.x - 70,
      y: castle.y,
      weapon: "spear",
      nextAttack: 0,
    });
    const hp = castle.hp;
    weaponCombat(w, 0.1, []);
    expect(castle.hp).toBeLessThan(hp);
  });
  it("restarts mourning for the heir and applies it to new recruits", () => {
    const w = fixture(),
      k = w.balls[0];
    k.king = true;
    k.hp = 0;
    resolveRoyalDeaths(w);
    cleanup(w);
    const heir = w.balls.find((b) => b.king && b.kingdom === k.kingdom)!;
    w.time = 7;
    heir.hp = 0;
    resolveRoyalDeaths(w);
    expect(w.kingdoms[k.kingdom].ceasefireUntil).toBe(17);
    cleanup(w);
    w.kingdoms[k.kingdom].resources = 180;
    w.kingdoms[k.kingdom].recruitProgress = 1;
    recruit(w, 1 / 30);
    const newest = w.balls.at(-1)!;
    expect(
      damage(w, newest, w.balls.find((b) => b.kingdom !== newest.kingdom)!, 0),
    ).toBe(0);
  });
  it("preserves pending strikes, cooldowns, mourning and RNG across save continuation", () => {
    const w = fixture();
    w.settings.events = true;
    w.time = 1;
    w.weather.rain = { x: 1500, y: 1200, radius: 450, born: 1, until: 16 };
    w.weather.strikes = [{ x: 1500, y: 1200, warned: 1, at: 2 }];
    w.kingdoms[0].ceasefireUntil = 11;
    w.balls[0].nextOrder = 21;
    const copy = importSave(JSON.stringify(w));
    for (let i = 0; i < 120; i++) {
      step(w);
      step(copy);
    }
    expect(copy).toEqual(w);
  });
  it("round-trips a warning emitted on a fractional fixed-step boundary", () => {
    const w = fixture();
    w.settings.events = true;
    w.time = 2 - 1e-12;
    w.weather.storm = {
      x: 900,
      y: 900,
      radius: 450,
      born: 1,
      until: 13,
      warnings: 0,
      nextWarning: 2,
    };
    advanceWeather(w);
    expect(w.weather.strikes).toHaveLength(1);
    expect(() => importSave(JSON.stringify(w))).not.toThrow();
  });
  it("migrates v6 without RNG consumption or retrospective mourning, rejects broken new state", () => {
    const w = fixture(),
      raw = JSON.parse(JSON.stringify(w));
    raw.version = 6;
    delete raw.weather;
    delete raw.terrainBoundaryVersion;
    raw.balls[0].level = 10;
    raw.balls[0].hp = 45;
    const next = importSave(JSON.stringify(raw));
    expect(next.rng).toBe(raw.rng);
    expect(next.version).toBe(7);
    expect(next.balls[0]).toMatchObject({ level: 10, hp: 45 });
    expect(next.kingdoms.every((k) => k.ceasefireUntil === 0)).toBe(true);
    expect(next.weather).toEqual(initialWeather(raw.settings.seed, raw.time));
    expect(importSave(JSON.stringify(next))).toEqual(next);
    for (const weather of [
      { ...next.weather, rain: false },
      { ...next.weather, nextRain: NaN },
      { ...next.weather, strikes: [{ x: 1, y: 2, warned: 0, at: 99 }] },
    ])
      expect(() => importSave(JSON.stringify({ ...next, weather }))).toThrow();
  });
});
describe("shared natural terrain", () => {
  it("relocates obstructed units and resources around rocks without changing direction, health or RNG", () => {
    const w = fixture(),
      b = w.balls[0],
      rng = w.rng;
    w.cells[10 + 8 * COLS].terrain = "water";
    w.obstacles = [{ x: 1140, y: 900, r: 25 }];
    Object.assign(b, { x: 1260, y: 1020, vx: 75, vy: 30, hp: 45 });
    w.resources = [{ id: w.nextId++, x: 1260, y: 1020, value: 18 }];
    syncNaturalWorld(w);
    expect(b).toMatchObject({ vx: 75, vy: 30, hp: 45 });
    expect(w.rng).toBe(rng);
    for (const p of [b, { ...w.resources[0], r: 9 }]) {
      expect(terrainBlocked(w, p.x, p.y, p.r)).toBe(false);
      expect(Math.hypot(p.x - 1140, p.y - 900)).toBeGreaterThanOrEqual(
        25 + p.r,
      );
    }
    expect(w.resources[0].value).toBe(18);
  });
  it("uses continuous round edges for movement, sampling and swept obstruction", () => {
    const w = fixture(),
      i = 10 + 8 * COLS;
    w.cells[i].terrain = "water";
    w.cells[i].blocked = true;
    invalidateNatural(w);
    expect(terrainAt(w, 1260, 1020)).toBe("water");
    expect(terrainAt(w, 1201, 961)).toBe("grass");
    expect(terrainBlocked(w, 1201, 961, 3)).toBe(false);
    expect(terrainBlocked(w, 1309, 1020, 6)).toBe(true);
    expect(naturalRay(w, 1190, 1020, 1340, 1020, true)).toBeLessThan(1);
    expect(naturalRay(w, 1190, 1020, 1340, 1020)).toBe(Infinity);
    const b = w.balls[0];
    Object.assign(b, { x: 1200, y: 1020, vx: 75, vy: 0 });
    moveOnTerrain(w, b, 20, 0);
    expect(b.vx).toBeLessThan(0);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(75);
    expect(naturalMap(w).regions.get("water")![0].length).toBeGreaterThan(4);
  });
  it("keeps every biome, shape and layout connected and deterministic", () => {
    for (const map of MAP_TYPES)
      for (const shape of ["rectangle", "circle"] as const)
        for (const layout of ["normal", "lake", "arena"] as const) {
          const s = {
            ...DEFAULTS,
            kingdoms: 6,
            perKingdom: 8,
            map,
            shape,
            layout,
            seed: "natural-" + map,
          };
          const w = createWorld(s);
          expect(connectedCastles(w), map + shape + layout).toBe(true);
          expect(
            w.kingdoms.every((k) => !terrainBlocked(w, k.x, k.y, 42)),
          ).toBe(true);
          expect(createWorld(s)).toEqual(w);
          expect(importSave(JSON.stringify(w))).toEqual(w);
        }
  });
});
