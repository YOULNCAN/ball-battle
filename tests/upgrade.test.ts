import { describe, expect, it } from "vitest";
import {
  createWorld,
  DEFAULTS,
  spawn,
  step,
  STEP,
  collide,
  conquer,
  damage,
  type Ball,
} from "../src/sim";
import {
  MAP_TYPES,
  connectedCastles,
  reachableCells,
  terrainBlocked,
  moveOnTerrain,
  cellIndex,
} from "../src/maps";
import {
  WEAPON_TYPES,
  WEAPONS,
  troopCounts,
  type Weapon,
} from "../src/weapons";
import { weaponCombat } from "../src/combat";
import { importSave } from "../src/storage";
import { MusicDirector } from "../src/music";

function arena() {
  const w = createWorld({
    ...DEFAULTS,
    kingdoms: 2,
    perKingdom: 10,
    cap: 100,
    map: "grassland",
    events: false,
  });
  w.obstacles = [];
  w.resources = [];
  for (const b of w.balls)
    Object.assign(b, {
      chargeUntil: 0,
      nextAttack: 1e6,
      weapon: "sword",
      king: false,
    });
  for (const [i, k] of w.kingdoms.entries()) {
    k.x = i ? 3200 : 400;
    k.y = 200;
    k.recruitProgress = 0;
  }
  const [a, b, c] = w.balls;
  w.balls = [a, b, c];
  for (const [i, ball] of w.balls.entries())
    Object.assign(ball, {
      x: 1000 + i * 30,
      y: 1000,
      kingdom: i === 0 ? 0 : 1,
      hp: 500,
      maxHp: 500,
      r: 10,
      mass: 2,
      vx: 100,
      vy: 0,
      skills: [],
      attack: 20,
      defense: 3,
    });
  a.king = true;
  b.king = true;
  return { w, a, b, c };
}
describe("castle deployment", () => {
  it("uses equal mixed armies and outward radial directions", () => {
    const w = createWorld(DEFAULTS);
    expect(w.balls.length).toBe(1200);
    expect(
      new Set(w.balls.filter((b) => b.kingdom === 0).map((b) => b.weapon)).size,
    ).toBe(8);
    for (const k of w.kingdoms) {
      const troops = w.balls.filter((b) => b.kingdom === k.id);
      expect(troops.length).toBe(200);
      expect(troops.filter((b) => b.king).length).toBe(1);
      for (const b of troops) {
        expect(Math.hypot(b.x - k.x, b.y - k.y)).toBeCloseTo(4);
        expect((b.x - k.x) * b.vx + (b.y - k.y) * b.vy).toBeGreaterThan(0);
        expect(b.chargeUntil).toBe(3);
        expect(WEAPON_TYPES).toContain(b.weapon);
      }
      expect(troops.some((b) => b.vx > 0)).toBe(true);
      expect(troops.some((b) => b.vx < 0)).toBe(true);
      expect(troops.some((b) => b.vy > 0)).toBe(true);
      expect(troops.some((b) => b.vy < 0)).toBe(true);
    }
  });
  it("maximum armies remain finite without initial friendly collision explosions", () => {
    const w = createWorld({
      ...DEFAULTS,
      kingdoms: 2,
      perKingdom: 2000,
      cap: 4000,
      map: "grassland",
    });
    expect(w.balls.length).toBe(4000);
    for (let i = 0; i < 30; i++) step(w);
    expect(
      w.balls.every((b) => Number.isFinite(b.x) && Number.isFinite(b.vx)),
    ).toBe(true);
    expect(() => importSave(JSON.stringify(w))).not.toThrow();
  }, 30000);
  it("charge ignores friendly collision temporarily and recruitment gets a fresh charge", () => {
    const { w, a, b } = arena();
    b.kingdom = 0;
    b.x = a.x + 15;
    a.chargeUntil = 3;
    const x = a.x;
    collide(w, a, b);
    expect(a.x).toBe(x);
    w.time = 4;
    collide(w, a, b);
    expect(a.x).toBeLessThan(x);
    expect(a.hp).toBe(500);
    const recruited = spawn(w, 0, true);
    expect(recruited.chargeUntil).toBe(7);
    expect(WEAPON_TYPES).toContain(recruited.weapon);
  });
  it("charge movement is twice normal speed and expires in simulation time", () => {
    const { w, a } = arena();
    w.balls = [a];
    a.chargeUntil = 3;
    const x = a.x;
    step(w, 0.1);
    expect(a.x - x).toBeCloseTo(20);
    w.time = 4;
    const next = a.x;
    step(w, 0.1);
    expect(a.x - next).toBeCloseTo(10);
  });
});
describe("weapon warfare", () => {
  it("sword and spear hit one target, axe/hammer/halberd affect multiple enemies", () => {
    for (const weapon of [
      "sword",
      "spear",
      "axe",
      "hammer",
      "halberd",
    ] as Weapon[]) {
      const { w, a, b, c } = arena();
      a.weapon = weapon;
      a.nextAttack = 0;
      c.x = 1033;
      c.y = 1005;
      weaponCombat(w, STEP, []);
      expect(b.hp).toBeLessThan(500);
      if (WEAPONS[weapon].arc > 0) expect(c.hp).toBeLessThan(500);
      else expect(c.hp).toBe(500);
      const hp = b.hp;
      weaponCombat(w, STEP, []);
      expect(b.hp).toBe(hp);
    }
  });
  it("friendly balls never take melee or projectile damage", () => {
    const { w, a, b, c } = arena();
    b.kingdom = 0;
    a.weapon = "axe";
    a.nextAttack = 0;
    weaponCombat(w, STEP, []);
    expect(b.hp).toBe(500);
    expect(c.hp).toBeLessThan(500);
  });
  it("shield reduces frontal damage and strengthens collisions", () => {
    const { w, a, b } = arena();
    b.vx = -100;
    const base = damage(w, a, b, 100);
    b.weapon = "shield";
    expect(damage(w, a, b, 100)).toBeLessThan(base);
    b.weapon = "sword";
    a.weapon = "shield";
    expect(damage(w, a, b, 100)).toBeGreaterThan(base);
  });
  it("arrow segments hit the first enemy, ignore allies and stop at trees/rocks", () => {
    for (const weapon of ["bow", "crossbow"] as Weapon[]) {
      const { w, a, b, c } = arena();
      a.weapon = weapon;
      a.nextAttack = 0;
      b.x = 1100;
      c.x = 1200;
      weaponCombat(w, STEP, []);
      expect(w.projectiles.length).toBe(1);
      a.nextAttack = 1e6;
      for (let i = 0; i < 20; i++) weaponCombat(w, STEP, []);
      expect(b.hp).toBeLessThan(500);
      expect(c.hp).toBe(500);
      expect(w.projectiles.length).toBe(0);
    }
    const { w, a, b, c } = arena();
    a.weapon = "bow";
    a.nextAttack = 0;
    b.kingdom = 0;
    b.x = 1050;
    c.x = 1150;
    w.obstacles = [{ x: 1090, y: 1000, r: 12 }];
    weaponCombat(w, STEP, []);
    a.nextAttack = 1e6;
    for (let i = 0; i < 20; i++) weaponCombat(w, STEP, []);
    expect(b.hp).toBe(500);
    expect(c.hp).toBe(500);
    expect(w.projectiles.length).toBe(0);
  });
  it("projectile kill has one reward, including arrows whose source has died", () => {
    const { w, a, b, c } = arena();
    w.balls = [a, b];
    a.weapon = "crossbow";
    a.nextAttack = 0;
    b.x = 1120;
    b.hp = 1;
    weaponCombat(w, STEP, []);
    a.nextAttack = 1e6;
    w.balls = [b];
    for (let i = 0; i < 20; i++) weaponCombat(w, STEP, []);
    expect(b.hp).toBeLessThanOrEqual(0);
    expect(Number.isFinite(b.hp)).toBe(true);
    expect(w.kingdoms[0].kills).toBe(1);
    expect(c.kills).toBe(0);
  });
  it("conquest preserves individual weapons and redirects in-flight allegiance", () => {
    const { w, a, b } = arena();
    b.weapon = "bow";
    b.nextAttack = 0;
    a.x = 980;
    weaponCombat(w, STEP, []);
    expect(w.projectiles.length).toBeGreaterThan(0);
    conquer(w, w.kingdoms[1], a);
    expect(b.kingdom).toBe(0);
    expect(b.weapon).toBe("bow");
    expect(w.projectiles.every((p) => p.kingdom === 0)).toBe(true);
    expect(WEAPON_TYPES).toContain(spawn(w, 0).weapon);
  });
  it("ranged castle conquest credits experience to the live firing ball", () => {
    const { w, a } = arena();
    w.balls = [a];
    a.weapon = "crossbow";
    a.nextAttack = 0;
    const castle = w.kingdoms[1];
    castle.x = 1150;
    castle.y = 1000;
    castle.hp = 1;
    weaponCombat(w, STEP, []);
    a.nextAttack = 1e6;
    for (let i = 0; i < 20; i++) weaponCombat(w, STEP, []);
    expect(castle.alive).toBe(false);
    expect(a.kills).toBe(1);
    expect(a.level).toBe(2);
  });
});
describe("terrain and save upgrades", () => {
  it("running biome worlds remain valid saves", () => {
    for (const map of MAP_TYPES) {
      const w = createWorld({
        ...DEFAULTS,
        map,
        seed: `biome-${map}`,
        kingdoms: 8,
        perKingdom: 250,
        cap: 2000,
      });
      for (let i = 0; i < 1100; i++) {
        step(w);
        if (i % 30 === 0) {
          expect(
            () => importSave(JSON.stringify(w)),
            `${map} at step ${i}`,
          ).not.toThrow();
        }
      }
    }
  }, 180000);
  it("all six maps reproducibly connect castles and place reachable resources", () => {
    for (const map of MAP_TYPES)
      for (let seed = 0; seed < 5; seed++) {
        const settings = {
          ...DEFAULTS,
          map,
          seed: String(seed),
          perKingdom: 10,
        };
        const w = createWorld(settings);
        expect(w).toEqual(createWorld(settings));
        expect(connectedCastles(w)).toBe(true);
        const reachable = reachableCells(w);
        expect(
          w.resources.every((r) => reachable.has(cellIndex(r.x, r.y))),
        ).toBe(true);
        expect(w.resources.every((r) => !terrainBlocked(w, r.x, r.y, 3))).toBe(
          true,
        );
        expect(w.kingdoms.every((k) => !terrainBlocked(w, k.x, k.y, 90))).toBe(
          true,
        );
        if (map === "islands") {
          expect(w.cells.some((c) => c.terrain === "water")).toBe(true);
          expect(w.cells.some((c) => c.terrain === "bridge")).toBe(true);
        }
      }
  });
  it("water reflects, bridges pass, and arrows cross water but not mountain walls", () => {
    const { w, a, b } = arena();
    const i = cellIndex(1100, 1000);
    w.cells[i].terrain = "water";
    w.cells[i].blocked = true;
    a.x = 1070;
    a.vx = 100;
    moveOnTerrain(w, a, 30, 0);
    expect(a.vx).toBeLessThan(0);
    expect(a.x).toBeLessThan(1080);
    w.cells[i].terrain = "bridge";
    w.cells[i].blocked = false;
    a.x = 1070;
    a.vx = 100;
    moveOnTerrain(w, a, 30, 0);
    expect(a.x).toBeCloseTo(1100);
    for (const terrain of ["water", "mountain"] as const) {
      const { w, a, b } = arena();
      a.x = 1020;
      b.x = 1250;
      w.balls = [a, b];
      a.weapon = "crossbow";
      a.nextAttack = 0;
      w.cells[cellIndex(1100, 1000)].terrain = terrain;
      weaponCombat(w, STEP, []);
      a.nextAttack = 1e6;
      for (let i = 0; i < 30; i++) weaponCombat(w, STEP, []);
      expect(b.hp < 500).toBe(terrain === "water");
    }
  });
  it("sand/forest slowing leaves base velocity intact, while ice keeps slow sliding", () => {
    for (const [terrain, expected] of [
      ["grass", 10],
      ["sand", 7],
      ["forest", 6.5],
    ] as const) {
      const { w, a } = arena();
      w.balls = [a];
      w.cells[cellIndex(a.x, a.y)].terrain = terrain;
      const x = a.x;
      step(w, 0.1);
      expect(a.x - x).toBeCloseTo(expected);
      expect(a.vx).toBe(100);
    }
    const { w, a } = arena();
    w.balls = [a];
    w.cells[cellIndex(a.x, a.y)].terrain = "ice";
    a.vx = 35;
    step(w);
    expect(a.vx).toBe(35);
  });
  it("v1 migration preserves core state, does not consume RNG, and adds no deployment", () => {
    const original = createWorld({
      ...DEFAULTS,
      map: "grassland",
      perKingdom: 10,
    });
    const legacy = structuredClone(original) as any;
    legacy.version = 1;
    legacy.kingdoms.forEach((k: any) => {
      k.nextRecruit = legacy.time + 2.5;
      delete k.recruitProgress;
    });
    delete legacy.mapType;
    delete legacy.projectiles;
    delete legacy.combatHits;
    delete legacy.settings.map;
    delete legacy.settings.perKingdom;
    delete legacy.settings.musicVolume;
    for (const k of legacy.kingdoms) delete k.weapon;
    for (const b of legacy.balls)
      for (const key of [
        "weapon",
        "chargeUntil",
        "nextAttack",
        "attackAngle",
        "attackUntil",
      ])
        delete b[key];
    for (const c of legacy.cells) delete c.terrain;
    const text = JSON.stringify(legacy),
      migrated = importSave(text);
    expect(migrated.version).toBe(6);
    expect(migrated.rng).toBe(legacy.rng);
    expect(migrated.time).toBe(legacy.time);
    expect(migrated.balls.map((b) => [b.id, b.x, b.y, b.hp, b.level])).toEqual(
      legacy.balls.map((b: Ball) => [b.id, b.x, b.y, b.hp, b.level]),
    );
    expect(migrated.obstacles).toEqual(legacy.obstacles);
    expect(migrated.history).toEqual(legacy.history);
    expect(
      migrated.balls.every(
        (b) => b.chargeUntil === 0 && WEAPON_TYPES.includes(b.weapon),
      ),
    ).toBe(true);
    expect(migrated).toEqual(importSave(text));
    expect(() => importSave(JSON.stringify(migrated))).not.toThrow();
  });
  it("v4 resumes an active charge and arrow battle deterministically and rejects corrupt new fields", () => {
    const { w, a, b } = arena();
    a.weapon = "bow";
    a.nextAttack = 0;
    b.x = 1200;
    a.chargeUntil = 3;
    weaponCombat(w, STEP, []);
    const restored = importSave(JSON.stringify(w));
    for (let i = 0; i < 200; i++) {
      step(w);
      step(restored);
    }
    expect(restored).toEqual(w);
    for (const modify of [
      (v: typeof w) => {
        v.balls[0].weapon = "unknown" as Weapon;
      },
      (v: typeof w) => {
        v.cells[0].terrain = "lava" as "grass";
      },
      (v: typeof w) => {
        v.kingdoms[1].weapon = "unknown" as Weapon;
      },
    ]) {
      const bad = structuredClone(w);
      modify(bad);
      expect(() => importSave(JSON.stringify(bad))).toThrow();
    }
  });
});
describe("music selection", () => {
  it("uses intensity hysteresis and a minimum 20-second switch interval", () => {
    const director = new MusicDirector();
    for (let i = 0; i < 19; i++) expect(director.update(40, 1)).toBe(false);
    expect(director.update(40, 1)).toBe(true);
    for (let i = 0; i < 19; i++) expect(director.update(0, 1)).toBe(true);
    expect(director.update(0, 1)).toBe(false);
  });
});
