import { describe, it, expect } from "vitest";
import {
  createWorld,
  DEFAULTS,
  collide,
  step,
  recruit,
  type World,
  type Ball,
} from "../src/sim";
import { motionScale } from "../src/physics";
import { importSave } from "../src/storage";
import {
  MAP_TYPES,
  insideBoundary,
  connectedCastles,
  terrainBlocked,
} from "../src/maps";
import { troopCounts } from "../src/weapons";
import { castlePositions } from "../src/castles";

function fixture() {
  const w = createWorld({
    ...DEFAULTS,
    kingdoms: 2,
    perKingdom: 20,
    events: false,
    map: "grassland",
  });
  w.cells.forEach((c) => {
    c.terrain = "grass";
    c.blocked = false;
  });
  w.obstacles = [];
  w.resources = [];
  w.kingdoms.forEach((k, i) => {
    k.x = 400 + i * 2800;
    k.y = 400;
    k.resources = 0;
  });
  const [a, b] = w.balls;
  w.balls = [a, b];
  for (const ball of w.balls)
    Object.assign(ball, {
      king: false,
      kingdom: 0,
      x: 1500,
      y: 1200,
      r: 6,
      mass: 1,
      vx: 0,
      vy: 0,
      chargeUntil: 0,
      hp: 10000,
      maxHp: 10000,
      skills: [],
    });
  b.x = 1510;
  return { w, a, b };
}
function conserved(w: World, balls: Ball[]) {
  return balls.reduce(
    (sum, b) => {
      const s = motionScale(w, b),
        x = b.vx * s,
        y = b.vy * s;
      return {
        x: sum.x + b.mass * x,
        y: sum.y + b.mass * y,
        e: sum.e + 0.5 * b.mass * (x * x + y * y),
      };
    },
    { x: 0, y: 0, e: 0 },
  );
}
describe("elastic physics and batch recruitment", () => {
  it("deterministically finds spaced fallback candidates even when random sampling repeats", () => {
    const w = createWorld({
      ...DEFAULTS,
      kingdoms: 8,
      perKingdom: 8,
      shape: "circle",
      layout: "arena",
    });
    for (const value of [0, 0.5, 1]) {
      const points = castlePositions(w, () => value);
      expect(points).toHaveLength(8);
      expect(castlePositions(w, () => value)).toEqual(points);
      for (const a of points)
        for (const b of points)
          if (a !== b)
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
              480,
            );
    }
  });
  it("exchanges equal mass normal speeds while retaining tangential velocity", () => {
    const { w, a, b } = fixture();
    Object.assign(a, { vx: 100, vy: 40 });
    Object.assign(b, { vx: -20, vy: 30 });
    const before = conserved(w, [a, b]);
    collide(w, a, b);
    expect(a.vx).toBeCloseTo(-20);
    expect(b.vx).toBeCloseTo(100);
    expect(a.vy).toBe(40);
    expect(b.vy).toBe(30);
    expect(conserved(w, [a, b])).toEqual(before);
  });
  it("conserves both momentum axes and kinetic energy for unequal masses and oblique contacts", () => {
    for (let i = 0; i < 30; i++) {
      const { w, a, b } = fixture(),
        angle = i * 0.19;
      b.x = a.x + 10 * Math.cos(angle);
      b.y = a.y + 10 * Math.sin(angle);
      a.mass = 0.6 + i * 0.1;
      b.mass = 3;
      Object.assign(a, {
        vx: 120 * Math.cos(angle),
        vy: 120 * Math.sin(angle),
      });
      b.vx = -20;
      b.vy = 15;
      const before = conserved(w, [a, b]);
      collide(w, a, b);
      const after = conserved(w, [a, b]);
      expect(after.x).toBeCloseTo(before.x, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
      expect(after.e).toBeCloseTo(before.e, 7);
    }
  });
  it("uses actual charge and terrain velocities and leaves separating contacts unchanged", () => {
    const { w, a, b } = fixture();
    a.chargeUntil = 0;
    a.x = 599;
    b.x = 609;
    w.cells[4 + 5 * 30].terrain = "sand";
    a.vx = 120;
    b.vx = -30;
    b.mass = 2;
    const before = conserved(w, [a, b]);
    collide(w, a, b);
    const after = conserved(w, [a, b]);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.e).toBeCloseTo(before.e, 8);
    a.x = 1500;
    b.x = 1510;
    a.vx = -100;
    b.vx = 100;
    collide(w, a, b);
    expect(a.vx).toBe(-100);
    expect(b.vx).toBe(100);
    a.kingdom = 0;
    b.kingdom = 1;
    a.x = 1500;
    b.x = 1510;
    a.chargeUntil = 3;
    a.vx = 120;
    b.vx = -30;
    const charged = conserved(w, [a, b]);
    collide(w, a, b);
    expect(conserved(w, [a, b]).e).toBeCloseTo(charged.e, 7);
  });
  it("allows rest and high speeds, prevents a fast ball passing its stationary target, and saves them", () => {
    const { w, a, b } = fixture();
    b.x = 1518;
    a.vx = 2000;
    step(w);
    expect(a.vx).toBeCloseTo(0);
    expect(b.vx).toBeCloseTo(2000);
    expect(a.x).toBeLessThan(b.x);
    const copy = importSave(JSON.stringify(w));
    expect(copy.balls[1].vx).toBeCloseTo(2000);
    const rest = fixture();
    rest.b.x = 1700;
    step(rest.w);
    expect(rest.a.vx).toBe(0);
    expect(rest.a.vy).toBe(0);
  });
  it("waits for full resource and population capacity, then creates ten balanced radial recruits", () => {
    const w = createWorld({
        ...DEFAULTS,
        kingdoms: 2,
        perKingdom: 16,
        events: false,
      }),
      k = w.kingdoms[0];
    w.kingdoms[1].resources = 0;
    k.recruitProgress = 1;
    k.resources = 179;
    const n = w.balls.length;
    recruit(w, 1);
    expect(w.balls.length).toBe(n);
    expect(k.recruitProgress).toBe(1);
    k.resources = 180;
    w.settings.cap = n + 9;
    recruit(w, 1);
    expect(w.balls.length).toBe(n);
    w.settings.cap = n + 10;
    recruit(w, 1);
    expect(w.balls.length).toBe(n + 10);
    expect(k.resources).toBe(0);
    expect(k.recruited).toBe(10);
    const counts = Object.values(
      troopCounts(w.balls.filter((b) => b.kingdom === 0)),
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    const newborn = w.balls.slice(n);
    expect(
      newborn.every(
        (b) =>
          b.chargeUntil === w.time + 3 &&
          b.level === 1 &&
          b.skills.length === 0,
      ),
    ).toBe(true);
    expect(
      new Set(
        newborn.map((b) =>
          Math.floor(((Math.atan2(b.vy, b.vx) + Math.PI) * 10) / (Math.PI * 2)),
        ),
      ).size,
    ).toBeGreaterThanOrEqual(9);
  });
  it("random castles reproduce seeds and retain clearance and connected exits across maps and layouts", () => {
    for (const map of MAP_TYPES)
      for (const shape of ["rectangle", "circle"] as const)
        for (const layout of ["normal", "lake", "arena"] as const) {
          const settings = {
            ...DEFAULTS,
            kingdoms: 8,
            perKingdom: 8,
            map,
            shape,
            layout,
            seed: `castles-${map}-${shape}-${layout}`,
          };
          const w = createWorld(settings),
            copy = createWorld(settings);
          expect(copy).toEqual(w);
          expect(connectedCastles(w)).toBe(true);
          for (const k of w.kingdoms) {
            expect(insideBoundary(w, k.x, k.y, 180)).toBe(true);
            expect(k.x).toBeGreaterThanOrEqual(180);
            expect(k.y).toBeGreaterThanOrEqual(180);
            expect(terrainBlocked(w, k.x, k.y, 42)).toBe(false);
            for (const other of w.kingdoms)
              if (other.id !== k.id)
                expect(
                  Math.hypot(k.x - other.x, k.y - other.y),
                ).toBeGreaterThanOrEqual(480);
          }
          expect(
            importSave(JSON.stringify(w)).kingdoms.map((k) => [k.x, k.y]),
          ).toEqual(w.kingdoms.map((k) => [k.x, k.y]));
        }
    expect(
      createWorld({ ...DEFAULTS, seed: "different" }).kingdoms.map((k) => [
        k.x,
        k.y,
      ]),
    ).not.toEqual(createWorld().kingdoms.map((k) => [k.x, k.y]));
  });
});
