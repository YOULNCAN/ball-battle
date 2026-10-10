import { describe, it, expect } from "vitest";
import {
  createWorld,
  DEFAULTS,
  spawn,
  step,
  STEP,
  cleanup,
  damage,
  kingWarCry,
  updateTerritory,
  WIDTH,
  HEIGHT,
} from "../src/sim";
import { troopCounts, WEAPON_TYPES, WEAPONS } from "../src/weapons";
import {
  MAP_TYPES,
  insideBoundary,
  constrainBoundary,
  CIRCLE_RADIUS,
  connectedCastles,
  reachableCells,
  cellIndex,
  terrainBlocked,
} from "../src/maps";
import { importSave } from "../src/storage";
import { weaponCombat } from "../src/combat";

describe("mixed armies and royal skill", () => {
  it("every nation has identical balanced counts, including its randomly armed king", () => {
    for (const perKingdom of [8, 25, 200, 250]) {
      const w = createWorld({ ...DEFAULTS, perKingdom, kingdoms: 6 });
      const expected = troopCounts(w.balls.filter((b) => b.kingdom === 0));
      for (const k of w.kingdoms) {
        const army = w.balls.filter((b) => b.kingdom === k.id);
        expect(troopCounts(army)).toEqual(expected);
        expect(army.filter((b) => b.king)).toHaveLength(1);
      }
      const counts = Object.values(expected);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      expect(counts.every((n) => n >= 1)).toBe(true);
    }
  });
  it("recruitment always fills a least numerous living class", () => {
    const w = createWorld({ ...DEFAULTS, perKingdom: 25 });
    for (let i = 0; i < 40; i++) {
      const counts = troopCounts(w.balls.filter((b) => b.kingdom === 0));
      const b = spawn(w, 0);
      expect(counts[b.weapon]).toBe(Math.min(...Object.values(counts)));
    }
  });
  it("royal skill triggers once per reign, protects and strengthens, and resets on succession", () => {
    const w = createWorld({ ...DEFAULTS, perKingdom: 8 });
    const king = w.balls.find((b) => b.kingdom === 0 && b.king)!;
    const enemy = w.balls.find((b) => b.kingdom === 1)!;
    king.weapon = enemy.weapon = "sword";
    king.skills = enemy.skills = [];
    king.hp = king.maxHp * 0.29;
    const before = damage(w, enemy, king, 0),
      outgoing = damage(w, king, enemy, 0);
    kingWarCry(w, king);
    expect(king.warCryUsed).toBe(true);
    expect(king.warCryUntil).toBe(5);
    expect(damage(w, enemy, king, 0)).toBeLessThan(before);
    expect(damage(w, king, enemy, 0)).toBeGreaterThan(outgoing);
    w.time = 8;
    kingWarCry(w, king);
    expect(king.warCryUntil).toBe(5);
    const heir = w.balls.find((b) => b.kingdom === 0 && !b.king)!;
    heir.level = 10;
    heir.warCryUsed = true;
    king.hp = 0;
    cleanup(w);
    expect(heir.king).toBe(true);
    expect(heir.warCryUsed).toBe(false);
    heir.hp = heir.maxHp * 0.2;
    kingWarCry(w, heir);
    expect(heir.warCryUntil).toBe(13);
  });
  it("area attacks cap four victims and ranged weapons keep distinct cadence and power", () => {
    const w = createWorld({ ...DEFAULTS, perKingdom: 8, events: false });
    w.obstacles = [];
    w.cells.forEach((c) => {
      c.terrain = "grass";
      c.blocked = false;
    });
    const a = w.balls[0],
      targets = w.balls.filter((b) => b.kingdom === 1);
    w.balls = [a, ...targets];
    Object.assign(a, {
      x: 1800,
      y: 1200,
      weapon: "hammer",
      nextAttack: 0,
      attack: 20,
    });
    targets.forEach((b, i) =>
      Object.assign(b, {
        x: 1818 + i * 0.5,
        y: 1200,
        hp: 500,
        maxHp: 500,
        nextAttack: 1e9,
      }),
    );
    weaponCombat(w, STEP, []);
    expect(targets.filter((b) => b.hp < 500)).toHaveLength(4);
    expect(WEAPONS.bow.cooldown).toBeLessThan(WEAPONS.crossbow.cooldown);
    expect(WEAPONS.bow.multiplier).toBeLessThan(WEAPONS.crossbow.multiplier);
  });
});

describe("circular worlds and layouts", () => {
  it("all biomes, shapes and layouts generate connected valid deterministic worlds", () => {
    for (const map of MAP_TYPES)
      for (const shape of ["rectangle", "circle"] as const)
        for (const layout of ["normal", "lake", "arena"] as const) {
          const settings = {
            ...DEFAULTS,
            map,
            shape,
            layout,
            perKingdom: 8,
            seed: `mixed-${map}-${shape}-${layout}`,
          };
          const w = createWorld(settings);
          expect(w).toEqual(createWorld(settings));
          expect(connectedCastles(w)).toBe(true);
          const reachable = reachableCells(w);
          expect(
            w.kingdoms.every((k) => !terrainBlocked(w, k.x, k.y, 90)),
          ).toBe(true);
          expect(
            w.resources.every(
              (r) =>
                insideBoundary(w, r.x, r.y, 3) &&
                reachable.has(cellIndex(r.x, r.y)),
            ),
          ).toBe(true);
          if (layout === "lake")
            expect(w.cells[cellIndex(WIDTH / 2, HEIGHT / 2)].terrain).toBe(
              "water",
            );
          if (layout === "arena")
            expect(w.cells[cellIndex(WIDTH / 2, HEIGHT / 2)].terrain).toBe(
              "grass",
            );
          expect(() => importSave(JSON.stringify(w))).not.toThrow();
        }
  });
  it("circle reflection uses its normal, keeps speed, and does not reflect inward velocity twice", () => {
    const w = createWorld({ ...DEFAULTS, shape: "circle", perKingdom: 8 });
    const b = w.balls[0];
    b.x = WIDTH / 2 + CIRCLE_RADIUS;
    b.y = HEIGHT / 2;
    b.vx = 100;
    b.vy = 40;
    const speed = Math.hypot(b.vx, b.vy);
    constrainBoundary(w, b);
    expect(b.vx).toBe(-100);
    expect(b.vy).toBe(40);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(speed);
    expect(insideBoundary(w, b.x, b.y, b.r)).toBe(true);
    constrainBoundary(w, b);
    expect(b.vx).toBe(-100);
  });
  it("outside tiles never count for conquest or prevent unification", () => {
    const w = createWorld({ ...DEFAULTS, shape: "circle", perKingdom: 8 });
    w.balls = [];
    w.kingdoms.forEach((k) => {
      k.alive = k.id === 0;
      if (!k.alive) k.hp = 0;
    });
    for (let i = 0; i < 15; i++) updateTerritory(w, 1);
    expect(w.winner).toBe(0);
    expect(w.cells[0].blocked).toBe(true);
    expect(w.cells[0].owner).toBe(-1);
  });
  it("2000 moving balls stay inside the circle and save validly through combat", () => {
    const w = createWorld({
      ...DEFAULTS,
      shape: "circle",
      layout: "arena",
      map: "grassland",
      kingdoms: 8,
      perKingdom: 250,
    });
    for (let i = 0; i < 600; i++) step(w);
    expect(w.balls.every((b) => insideBoundary(w, b.x, b.y, b.r - 0.01))).toBe(
      true,
    );
    expect(() => importSave(JSON.stringify(w))).not.toThrow();
  }, 30000);
});

describe("v4 migration and continuation", () => {
  it("v2 immediately redistributes each nation, preserving RNG, attributes, history, arrows and charge", () => {
    const w = createWorld({ ...DEFAULTS, perKingdom: 25, map: "grassland" });
    const old = structuredClone(w) as any;
    old.version = 2;
    old.kingdoms.forEach((k: any) => {
      k.nextRecruit = old.time + 2.5;
      delete k.recruitProgress;
    });
    delete old.settings.shape;
    delete old.settings.layout;
    old.balls.forEach((b: any) => {
      b.weapon = old.kingdoms[b.kingdom].weapon;
      delete b.warCryUsed;
      delete b.warCryUntil;
    });
    const a = old.balls[0],
      enemy = old.balls.find((b: any) => b.kingdom === 1);
    a.weapon = "bow";
    a.nextAttack = 0;
    a.x = 1800;
    a.y = 1200;
    enemy.x = 1950;
    enemy.y = 1200;
    weaponCombat(old, STEP, []);
    const next = importSave(JSON.stringify(old));
    expect(next.version).toBe(7);
    expect(next.rng).toBe(old.rng);
    expect(next.projectiles).toEqual(old.projectiles);
    expect(next.history).toEqual(old.history);
    expect(next.obstacles).toEqual(old.obstacles);
    expect(
      next.balls.map((b) => [b.id, b.x, b.y, b.hp, b.level, b.chargeUntil]),
    ).toEqual(
      old.balls.map((b: any) => [b.id, b.x, b.y, b.hp, b.level, b.chargeUntil]),
    );
    for (const k of next.kingdoms) {
      const counts = Object.values(
        troopCounts(next.balls.filter((b) => b.kingdom === k.id)),
      );
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
    expect(next.settings.shape).toBe("rectangle");
    expect(next).toEqual(importSave(JSON.stringify(old)));
  });
  it("v4 retains existing weapons and royal state and continues deterministically", () => {
    const w = createWorld({
      ...DEFAULTS,
      perKingdom: 8,
      shape: "circle",
      layout: "lake",
    });
    const king = w.balls.find((b) => b.king)!;
    king.hp = king.maxHp * 0.2;
    kingWarCry(w, king);
    const restored = importSave(JSON.stringify(w));
    for (let i = 0; i < 100; i++) {
      step(w);
      step(restored);
    }
    expect(restored).toEqual(w);
    const bad = structuredClone(w);
    bad.settings.shape = "triangle" as any;
    expect(() => importSave(JSON.stringify(bad))).toThrow();
  });
});
