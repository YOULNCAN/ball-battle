import { describe, expect, it } from "vitest";
import {
  createWorld,
  DEFAULTS,
  collide,
  step,
  cleanup,
  conquer,
  reward,
  updateTerritory,
  WIDTH,
  STEP,
  territories,
  type World,
  type Ball,
} from "../src/sim";
import { importSave, validateWorld } from "../src/storage";

function small(): World {
  return createWorld({
    ...DEFAULTS,
    kingdoms: 2,
    population: 20,
    perKingdom: 10,
    map: "grassland",
    cap: 100,
    events: false,
  });
}
function pair(w: World, friendly = false): [Ball, Ball] {
  const a = w.balls[0],
    b = w.balls[1];
  for (const ball of [a, b]) {
    ball.chargeUntil = 0;
    ball.nextAttack = 1e6;
    ball.weapon = "sword";
  }
  Object.assign(a, {
    x: 1000,
    y: 1000,
    vx: 100,
    vy: 0,
    r: 10,
    mass: 2,
    hp: 200,
    maxHp: 200,
    kingdom: 0,
    king: false,
    skills: [],
  });
  Object.assign(b, {
    x: 1015,
    y: 1000,
    vx: -100,
    vy: 0,
    r: 10,
    mass: 2,
    hp: 200,
    maxHp: 200,
    kingdom: friendly ? 0 : 1,
    king: false,
    skills: [],
  });
  return [a, b];
}
describe("collision and lifecycle", () => {
  it("friendly balls bounce without damage; enemies mutually hurt with contact cooldown", () => {
    const w = small(),
      [a, b] = pair(w, true);
    collide(w, a, b);
    expect(a.hp).toBe(200);
    expect(b.hp).toBe(200);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    b.kingdom = 1;
    a.x = 1000;
    b.x = 1015;
    collide(w, a, b);
    expect(a.hp).toBeLessThan(200);
    expect(b.hp).toBeLessThan(200);
    const hp = a.hp;
    a.x = 1000;
    b.x = 1015;
    collide(w, a, b);
    expect(a.hp).toBe(hp);
  });
  it("faster and heavier impacts hurt more, and shield reduces damage", () => {
    const w = small(),
      [a, b] = pair(w);
    collide(w, a, b);
    const base = 200 - b.hp;
    Object.assign(a, { x: 1000, vx: 190, mass: 8, cooldown: 0 });
    Object.assign(b, { x: 1015, vx: -190, hp: 200, cooldown: 0 });
    collide(w, a, b);
    expect(200 - b.hp).toBeGreaterThan(base);
    Object.assign(a, { x: 1000, vx: 100, mass: 2, cooldown: 0 });
    Object.assign(b, {
      x: 1015,
      vx: -100,
      hp: 200,
      cooldown: 0,
      skills: ["护盾"],
    });
    collide(w, a, b);
    expect(200 - b.hp).toBeLessThan(base);
  });
  it("walls and obstacles reflect balls and keep them in bounds", () => {
    const w = small();
    w.balls = [w.balls[0]];
    const b = w.balls[0];
    Object.assign(b, { x: WIDTH - b.r - 1, y: 1200, vx: 150, vy: 0 });
    step(w);
    expect(b.vx).toBeLessThan(0);
    expect(b.x).toBeLessThanOrEqual(WIDTH - b.r);
    w.obstacles = [{ x: 1000, y: 1000, r: 50 }];
    Object.assign(b, { x: 1060, y: 1000, vx: -150, vy: 0, r: 12 });
    step(w);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThanOrEqual(1062);
  });
  it("death leaves resources and the highest level survivor inherits the crown", () => {
    const w = small();
    const king = w.balls.find((b) => b.kingdom === 0 && b.king)!;
    const heir = w.balls.find((b) => b.kingdom === 0 && !b.king)!;
    heir.level = 5;
    king.hp = 0;
    const before = w.resources.length;
    cleanup(w);
    expect(w.resources.length).toBe(before + 1);
    expect(heir.king).toBe(true);
    expect(w.balls.some((b) => b.id === king.id)).toBe(false);
  });
  it("collection credits resources; castles recruit without exceeding cap", () => {
    const w = small();
    w.resources = [];
    const b = w.balls[0],
      k = w.kingdoms[b.kingdom];
    Object.assign(b, { x: 1500, y: 1500, vx: 100, vy: 0 });
    w.resources.push({ id: w.nextId++, x: 1500, y: 1500, value: 99 });
    const before = k.resources;
    step(w);
    expect(k.resources).toBe(before + 99);
    expect(w.resources.length).toBe(0);
    w.time = 3;
    w.nextEconomy = 0;
    k.recruitProgress = 1;
    k.resources = 1000;
    const population = w.balls.length;
    step(w);
    expect(w.balls.length).toBeGreaterThan(population);
    expect(k.recruited).toBe(10);
    w.settings.cap = w.balls.length;
    w.time += 5;
    w.nextEconomy = 0;
    k.recruitProgress = 1;
    const cap = w.balls.length;
    step(w);
    expect(w.balls.length).toBeLessThanOrEqual(cap);
  });
  it("kills grant levels and unique skills within growth bounds", () => {
    const w = small(),
      b = w.balls[0];
    for (let i = 0; i < 100; i++) reward(w, b);
    expect(b.level).toBe(10);
    expect(b.r).toBeLessThanOrEqual(24);
    expect(b.skills.length).toBe(4);
    expect(new Set(b.skills).size).toBe(4);
    expect(b.attack).toBeLessThanOrEqual(100);
    expect(b.defense).toBeLessThanOrEqual(35);
  });
  it("attacking a castle through movement causes damage, reflects and conquers", () => {
    const w = small(),
      [a] = pair(w);
    w.balls = [a];
    w.resources = [];
    w.obstacles = [];
    const k = w.kingdoms[1];
    k.x = 1000;
    k.y = 1000;
    k.hp = 2;
    Object.assign(a, { x: 1050, y: 1000, vx: -150, vy: 0 });
    step(w);
    expect(k.alive).toBe(false);
    expect(a.vx).toBeGreaterThan(0);
    expect(w.kingdoms[0].resources).toBeGreaterThan(0);
  });
  it("fallen kingdoms transfer soldiers, resources and claims", () => {
    const w = small(),
      attacker = w.balls.find((b) => b.kingdom === 0)!;
    const troops = w.balls.filter((b) => b.kingdom === 1);
    const resources = w.kingdoms[1].resources;
    const own = w.kingdoms[0].resources;
    w.cells[0] = {
      owner: 1,
      claimant: 1,
      progress: 1,
      blocked: false,
      terrain: "grass",
    };
    conquer(w, w.kingdoms[1], attacker);
    expect(w.kingdoms[1].alive).toBe(false);
    expect(w.kingdoms[0].resources).toBe(own + resources);
    expect(troops.every((b) => b.kingdom === 0 && !b.king)).toBe(true);
    expect(w.cells[0].owner).toBe(0);
  });
});
describe("territory and replay", () => {
  it("all kingdoms receive an initial king without exceeding the requested population", () => {
    for (let i = 0; i < 20; i++) {
      const w = createWorld({
        ...DEFAULTS,
        seed: String(i),
        population: 20,
        kingdoms: 8,
        perKingdom: 3,
        cap: 100,
      });
      expect(w.balls.length).toBe(64);
      expect(
        w.kingdoms.every(
          (k) =>
            w.balls.filter((b) => b.kingdom === k.id && b.king).length === 1,
        ),
      ).toBe(true);
    }
  });
  it("real attacks conquer castles and reach unification without calling conquest directly", () => {
    const w = createWorld(DEFAULTS);
    // A seeded integration battle, rather than a deadline on a random war.
    for (const k of w.kingdoms.slice(1)) {
      k.hp = 4;
      const attacker = w.balls.filter((b) => b.kingdom === 0)[k.id];
      Object.assign(attacker, {
        x: k.x + 60,
        y: k.y,
        vx: -150,
        vy: 0,
        chargeUntil: 0,
        hp: 1000,
        maxHp: 1000,
      });
    }
    for (let i = 0; i < 900 && w.winner === null; i++) step(w);
    expect(w.winner).not.toBeNull();
    expect(w.kingdoms.filter((k) => k.alive).length).toBe(1);
    expect(() => importSave(JSON.stringify(w))).not.toThrow();
  }, 30000);
  it("mixed presence freezes occupation, then reduces enemy ownership before capturing", () => {
    const w = small(),
      [a, b] = pair(w);
    w.balls = [a, b];
    const index = Math.floor(1000 / 120) + Math.floor(1000 / 120) * 30;
    const c = w.cells[index];
    c.blocked = false;
    c.owner = 0;
    c.claimant = 0;
    c.progress = 1;
    updateTerritory(w, 1);
    expect(c.progress).toBe(1);
    a.x = 300;
    updateTerritory(w, 1);
    expect(c.progress).toBeLessThan(1);
    expect(c.owner).toBe(0);
    for (let i = 0; i < 40; i++) updateTerritory(w, 1);
    expect(c.owner).toBe(1);
    expect(c.progress).toBe(1);
  });
  it("one kingdom automatically captures remaining cells and ends the game", () => {
    const w = small();
    conquer(w, w.kingdoms[1], w.balls.find((b) => b.kingdom === 0)!);
    for (let i = 0; i < 12; i++) updateTerritory(w, 1);
    expect(w.winner).toBe(0);
    expect(territories(w)[0]).toBe(w.cells.filter((c) => !c.blocked).length);
    const time = w.time;
    step(w);
    expect(w.time).toBe(time);
  });
  it("same seed and steps replay exactly; save restore continues random events exactly", () => {
    const settings = { ...DEFAULTS, population: 100, cap: 200, events: true };
    const a = createWorld(settings),
      b = createWorld(settings);
    expect(a).toEqual(b);
    for (let i = 0; i < 600; i++) {
      step(a);
      step(b);
    }
    expect(a).toEqual(b);
    const restored = importSave(JSON.stringify(a));
    for (let i = 0; i < 1200; i++) {
      step(a);
      step(restored);
    }
    expect(restored).toEqual(a);
    expect(
      a.logs.some(
        (l) => l.text.includes("世界事件") || l.text.includes("资源雨"),
      ),
    ).toBe(true);
  }, 30000);
  it("rejects corrupt, incompatible and inconsistent saves without changing the source world", () => {
    const original = small();
    const before = JSON.stringify(original);
    expect(() => importSave("bad")).toThrow();
    for (const modify of [
      (w: World) => {
        w.version = 6 as 5;
      },
      (w: World) => {
        w.balls[0].x = Number.NaN;
      },
      (w: World) => {
        w.balls[0].id = w.balls[1].id;
      },
      (w: World) => {
        w.cells[0].owner = 100;
      },
      (w: World) => {
        w.kingdoms[0].color = "url(javascript:bad)";
      },
      (w: World) => {
        w.balls[0].skills = ["未知" as "护盾"];
      },
      (w: World) => {
        w.winner = 0;
      },
    ]) {
      const w = structuredClone(original);
      modify(w);
      expect(() => validateWorld(w)).toThrow();
    }
    expect(JSON.stringify(original)).toBe(before);
    expect(validateWorld(original)).toEqual(original);
  });
  it("2000-ball simulation remains finite, capped and serializable over 60 simulated seconds", () => {
    const w = createWorld({
      ...DEFAULTS,
      population: 2000,
      kingdoms: 8,
      perKingdom: 250,
    });
    for (let i = 0; i < 60 / STEP; i++) step(w);
    expect(w.time).toBeCloseTo(60, 5);
    expect(w.balls.length).toBeLessThanOrEqual(2000);
    expect(() => importSave(JSON.stringify(w))).not.toThrow();
  }, 30000);
});
