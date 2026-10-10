import { describe, it, expect } from "vitest";
import fixture from "./fixtures/v3.json";
import {
  createWorld,
  DEFAULTS,
  production,
  recruit,
  spawn,
  step,
  STEP,
  reward,
  type Ball,
} from "../src/sim";
import { importSave } from "../src/storage";
import {
  MAP_TYPES,
  insideBoundary,
  connectedCastles,
  terrainBlocked,
} from "../src/maps";

function world(ratio = 0) {
  const w = createWorld({
    ...DEFAULTS,
    kingdoms: 2,
    perKingdom: 10,
    events: false,
    map: "grassland",
  });
  w.cells.forEach((c, i) => {
    c.blocked = i >= 400;
    c.owner = i < 400 * ratio ? 0 : -1;
  });
  w.kingdoms.forEach((k) => (k.resources = 0));
  w.kingdoms[0].resources = 10000;
  return w;
}
const stats = (b: Ball) => ({
  r: b.r,
  mass: b.mass,
  maxHp: b.maxHp,
  attack: b.attack,
  defense: b.defense,
  level: b.level,
  xp: b.xp,
  skills: b.skills,
  speed: Math.hypot(b.vx, b.vy),
});
describe("territory production and base soldiers", () => {
  it("0/50/100 percent land yields 1/1.5/2 times production, excluding blocked tiles", () => {
    for (const ratio of [0, 0.5, 1]) {
      const w = world(ratio),
        rate = production(w)[0];
      expect(rate).toEqual({
        ratio,
        multiplier: 1 + ratio,
        interval: 2.5 / (1 + ratio),
      });
      w.cells.filter((c) => c.blocked).forEach((c) => (c.owner = 0));
      expect(production(w)[0]).toEqual(rate);
    }
  });
  it("fixed-step accumulation achieves exact average cadence without one-second rounding", () => {
    for (const ratio of [0, 0.5, 1]) {
      const w = world(ratio);
      for (let i = 0; i < 900; i++) recruit(w, STEP);
      expect(w.kingdoms[0].recruited).toBe(
        10 * Math.floor((30 * (1 + ratio)) / 2.5),
      );
      expect(w.kingdoms[0].resources).toBe(
        10000 - 18 * w.kingdoms[0].recruited,
      );
    }
  });
  it("changes speed immediately after land transfer, without restarting progress", () => {
    const w = world(0);
    recruit(w, 1);
    expect(w.kingdoms[0].recruitProgress).toBeCloseTo(0.4);
    w.cells.filter((c) => !c.blocked).forEach((c) => (c.owner = 0));
    recruit(w, 0.75);
    expect(w.kingdoms[0].recruited).toBe(10);
  });
  it("shortage and population cap store at most one ready recruit, not a burst backlog", () => {
    const w = world(1),
      k = w.kingdoms[0];
    k.resources = 0;
    for (let i = 0; i < 900; i++) recruit(w, STEP);
    expect(k.recruitProgress).toBe(1);
    expect(k.recruited).toBe(0);
    k.resources = 1000;
    recruit(w, STEP);
    expect(k.recruited).toBe(10);
    expect(k.recruitProgress).toBe(0);
    w.settings.cap = w.balls.length;
    for (let i = 0; i < 900; i++) recruit(w, STEP);
    expect(k.recruitProgress).toBe(1);
    w.settings.cap += 10;
    recruit(w, STEP);
    expect(k.recruited).toBe(20);
    expect(k.recruitProgress).toBe(0);
  });
  it("all ordinary starting and recruited soldiers share the minimum base state, while kings are reinforced", () => {
    const w = world();
    for (const b of [...w.balls.filter((b) => !b.king), spawn(w, 0)]) {
      expect(stats(b)).toEqual({
        r: 6,
        mass: 0.6,
        maxHp: 112,
        attack: 8,
        defense: 2,
        level: 1,
        xp: 0,
        skills: [],
        speed: expect.closeTo(75, 8),
      });
      expect(b.hp).toBe(112);
    }
    const king = w.balls.find((b) => b.king)!;
    expect(king.maxHp).toBeCloseTo(112 * 1.8);
    expect(king.attack).toBeCloseTo(8 * 1.2);
    const b = spawn(w, 0);
    reward(w, b);
    expect(b.level).toBe(2);
    expect(b.skills).toHaveLength(1);
  });
  it("v4 saves preserve recruitment fractions, accumulated growth and deterministic continuation", () => {
    const w = world(0.5);
    w.kingdoms[0].recruitProgress = 0.73;
    const b = w.balls.find((b) => !b.king)!;
    reward(w, b);
    const restored = importSave(JSON.stringify(w));
    expect(restored.balls.find((other) => other.id === b.id)!.level).toBe(2);
    for (let i = 0; i < 200; i++) {
      step(w);
      step(restored);
    }
    expect(restored).toEqual(w);
    const bad = structuredClone(w);
    bad.kingdoms[0].recruitProgress = 1.01;
    expect(() => importSave(JSON.stringify(bad))).toThrow();
  });
  it("genuine v3 upgrade resets ordinary units once but preserves kings, positions, injury ratio, arrows and RNG", () => {
    const original = structuredClone(fixture);
    const text = JSON.stringify(original),
      next = importSave(text);
    expect(next.version).toBe(7);
    expect(next.rng).toBe(original.rng);
    expect(next.cells).toEqual(original.cells);
    expect(next.projectiles).toEqual(original.projectiles);
    expect(next.resources.map(({ id, value }) => ({ id, value }))).toEqual(
      original.resources.map(({ id, value }) => ({ id, value })),
    );
    for (const r of next.resources) {
      const old = original.resources.find((p) => p.id === r.id)!;
      if (r.x !== old.x || r.y !== old.y)
        expect(terrainBlocked(next, old.x, old.y, 9)).toBe(true);
      expect(terrainBlocked(next, r.x, r.y, 9)).toBe(false);
    }
    expect(next.obstacles).toEqual(original.obstacles);
    expect(next.history).toEqual(original.history);
    for (const b of next.balls) {
      const old = original.balls.find((old) => old.id === b.id)!;
      if (b.king) expect(b).toMatchObject(old);
      else {
        expect(b.level).toBe(1);
        expect(b.xp).toBe(0);
        expect(b.skills).toEqual([]);
        expect(b.hp / b.maxHp).toBeCloseTo(old.hp / old.maxHp);
        expect([
          b.id,
          b.x,
          b.y,
          b.weapon,
          b.kingdom,
          b.kills,
          b.chargeUntil,
        ]).toEqual([
          old.id,
          old.x,
          old.y,
          old.weapon,
          old.kingdom,
          old.kills,
          old.chargeUntil,
        ]);
        expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(75);
      }
    }
    expect(next).toEqual(importSave(text));
    const soldier = next.balls.find((b) => !b.king)!;
    reward(next, soldier);
    expect(
      importSave(JSON.stringify(next)).balls.find((b) => b.id === soldier.id)!
        .level,
    ).toBe(2);
  });
  it("every biome and shape randomizes obstacles with the seed and preserves castle routes", () => {
    for (const map of MAP_TYPES)
      for (const shape of ["circle", "rectangle"] as const) {
        const a = createWorld({
            ...DEFAULTS,
            map,
            shape,
            perKingdom: 8,
            seed: "obstacle-a",
          }),
          b = createWorld({
            ...DEFAULTS,
            map,
            shape,
            perKingdom: 8,
            seed: "obstacle-b",
          });
        expect(a.obstacles).toEqual(createWorld(a.settings).obstacles);
        expect(a.obstacles, map + " " + shape).not.toEqual(b.obstacles);
        expect(connectedCastles(a)).toBe(true);
        expect(a.obstacles.every((o) => insideBoundary(a, o.x, o.y, o.r))).toBe(
          true,
        );
        expect(a.kingdoms.every((k) => !terrainBlocked(a, k.x, k.y, 90))).toBe(
          true,
        );
      }
  });
});
