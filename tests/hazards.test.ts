import { describe, it, expect } from "vitest";
import {
  createWorld,
  DEFAULTS,
  cleanup,
  conquer,
  step,
  TILE,
  COLS,
} from "../src/sim";
import {
  castleExplosion,
  resolveRoyalDeaths,
  advanceFire,
} from "../src/hazards";
import { importSave } from "../src/storage";
import { contours } from "../src/territory";
import { invalidateNatural } from "../src/natural";

function fixture() {
  const w = createWorld({
    ...DEFAULTS,
    kingdoms: 2,
    perKingdom: 8,
    map: "grassland",
    events: false,
  });
  w.cells.forEach((c) => {
    c.terrain = "grass";
    c.blocked = false;
  });
  w.balls.forEach((b, i) => {
    b.x = 600 + i * 5;
    b.y = 600;
    b.hp = b.maxHp = 500;
    b.defense = 35;
    b.chargeUntil = 0;
  });
  return w;
}
describe("neutral explosions and territory display", () => {
  it("hurts both factions through defense without damaging castles or awarding kills", () => {
    const w = fixture(),
      before = w.kingdoms.map((k) => k.hp);
    castleExplosion(w, 650, 600);
    expect(w.balls.every((b) => b.hp === 420)).toBe(true);
    expect(w.kingdoms.map((k) => k.hp)).toEqual(before);
    expect(w.balls.every((b) => b.kills === 0 && b.xp === 0)).toBe(true);
  });
  it("chains every dead crown once, then inherits and drops resources once", () => {
    const w = fixture(),
      kings = w.balls.filter((b) => b.king);
    kings[0].hp = 0;
    kings[1].hp = 60;
    resolveRoyalDeaths(w);
    resolveRoyalDeaths(w);
    expect(w.blasts.filter((b) => b.source !== null)).toHaveLength(2);
    expect(w.balls.filter((b) => !b.king).every((b) => b.hp === 340)).toBe(
      true,
    );
    const count = w.resources.length;
    cleanup(w);
    expect(w.resources.length).toBe(count + 2);
    expect(w.balls.filter((b) => b.king)).toHaveLength(2);
    cleanup(w);
    expect(w.resources.length).toBe(count + 2);
  });
  it("mountain walls stop blast and fire damage", () => {
    const w = fixture();
    w.balls.forEach((b) => {
      b.x = 690;
      b.y = 650;
    });
    w.cells[Math.floor(640 / TILE) + Math.floor(650 / TILE) * COLS].terrain =
      "mountain";
    invalidateNatural(w);
    castleExplosion(w, 590, 650);
    expect(w.balls[0].hp).toBe(500);
    w.time = 1.3;
    advanceFire(w);
    expect(w.balls[0].hp).toBe(500);
  });
  it("merges the kingdom immediately before leaving its fire", () => {
    const w = fixture(),
      victim = w.kingdoms[1],
      attacker = w.balls.find((b) => b.kingdom === 0)!;
    victim.x = 650;
    victim.y = 600;
    conquer(w, victim, attacker);
    expect(w.balls.every((b) => b.kingdom === 0)).toBe(true);
    expect(victim.alive).toBe(false);
    expect(w.fires).toHaveLength(1);
    expect(
      w.balls.filter((b) => b.id !== attacker.id).every((b) => b.hp === 420),
    ).toBe(true);
  });
  it("waits for the blast, ticks on simulation time and expires", () => {
    const w = fixture();
    castleExplosion(w, 650, 600);
    w.time = 0.8;
    advanceFire(w);
    expect(w.blasts).toHaveLength(0);
    expect(w.balls[0].hp).toBe(420);
    w.time = 1.3;
    advanceFire(w);
    expect(w.balls[0].hp).toBe(414);
    w.time = 1.8;
    advanceFire(w);
    expect(w.balls[0].hp).toBe(408);
    w.time = 15.8;
    advanceFire(w);
    expect(w.fires).toHaveLength(0);
  });
  it("resumes identical hazards and randomness after saving", () => {
    const w = fixture();
    castleExplosion(w, 650, 600);
    step(w);
    const copy = importSave(JSON.stringify(w));
    for (let i = 0; i < 100; i++) {
      step(w);
      step(copy);
    }
    expect(copy).toEqual(w);
  });
  it("upgrades v4 without resetting grown soldiers or creating past hazards", () => {
    const w = fixture(),
      b = w.balls.find((b) => !b.king)!;
    b.level = 3;
    b.attack = 20;
    const raw = JSON.parse(JSON.stringify(w));
    raw.version = 4;
    delete raw.blasts;
    delete raw.fires;
    const migrated = importSave(JSON.stringify(raw));
    expect(migrated.version).toBe(7);
    expect(migrated.balls.find((x) => x.id === b.id)?.level).toBe(3);
    expect(migrated.rng).toBe(w.rng);
    expect(migrated.fires).toEqual([]);
    expect(() =>
      importSave(
        JSON.stringify({
          ...w,
          fires: [{ x: 600, y: 600, born: 0, until: Infinity, nextTick: 1 }],
        }),
      ),
    ).toThrow();
  });
  it("contours merge neighbors, retain holes and separate diagonal cells", () => {
    expect(contours([true, true], 2, 1, 10)).toHaveLength(1);
    expect(contours([true, false, false, true], 2, 2, 10)).toHaveLength(2);
    expect(
      contours(
        [true, true, true, true, false, true, true, true, true],
        3,
        3,
        10,
      ),
    ).toHaveLength(2);
    expect(contours([false], 1, 1, 10)).toEqual([]);
  });
});
