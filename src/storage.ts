import { ARENA_WALL, installArena, wallBlocked } from "./arena";
import {
  COLS,
  ROWS,
  TILE,
  HEIGHT,
  WIDTH,
  SKILLS,
  type World,
  normalizeSettings,
  seedHash,
} from "./sim";
import { assignWeapons, balancedArmy, WEAPON_TYPES } from "./weapons";
import {
  MAP_TYPES,
  insideBoundary,
  syncNaturalWorld,
  terrainBlocked,
} from "./maps";
import { initialWeather, clearWeather } from "./weather";
export type Slot = "manual" | "auto";
export interface Save {
  slot: Slot;
  savedAt: string;
  world: World;
}
const ERROR = "存档损坏或版本不兼容，当前世界未被替换。";
export function validateWorld(value: unknown): World {
  if (!value || typeof value !== "object") throw new Error(ERROR);
  const w = structuredClone(value) as World;
  const legacy = (w.version as number) === 1;
  const upgrading = (w.version as number) < 3;
  const resetting = (w.version as number) < 4;
  const modern = (w.version as number) === 7;
  if (!modern) w.terrainBoundaryVersion = 0;
  const finite = (n: unknown, lo = 0, hi = 1e12): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
  const integer = (n: unknown, lo = 0, hi = 1e12) =>
    finite(n, lo, hi) && Number.isInteger(n);
  const list = (a: unknown, max: number): a is unknown[] =>
    Array.isArray(a) && a.length <= max;
  try {
    if (
      ![1, 2, 3, 4, 5, 6, 7].includes(w.version as number) ||
      !w.settings ||
      !integer(w.rng, 0, 0xffffffff) ||
      !integer(w.nextId, 1) ||
      !finite(w.time) ||
      !finite(w.nextEvent) ||
      !finite(w.nextEconomy) ||
      !finite(w.nextHistory)
    )
      throw 0;
    const s = w.settings;
    if (
      !upgrading &&
      (!["rectangle", "circle"].includes(s.shape) ||
        !["normal", "lake", "arena"].includes(s.layout))
    )
      throw 0;
    if (
      !legacy &&
      (!integer(s.perKingdom, 1, s.cap) ||
        !finite(s.musicVolume, 0, 1) ||
        !(s.map === "random" || MAP_TYPES.includes(s.map)) ||
        !MAP_TYPES.includes(w.mapType) ||
        !list(w.projectiles, 8000) ||
        !integer(w.combatHits))
    )
      throw 0;
    if (
      typeof s.seed !== "string" ||
      s.seed.length > 80 ||
      !integer(s.kingdoms, 2, 8) ||
      !integer(s.cap, 100, 4000) ||
      !integer(s.population, 20, s.cap) ||
      typeof s.events !== "boolean" ||
      !finite(s.volume, 0, 1) ||
      !["high", "low"].includes(s.quality)
    )
      throw 0;
    if (
      !list(w.kingdoms, 8) ||
      w.kingdoms.length !== s.kingdoms ||
      !list(w.balls, s.cap) ||
      !list(w.resources, 3100) ||
      !list(w.obstacles, 40) ||
      !list(w.cells, COLS * ROWS) ||
      w.cells.length !== COLS * ROWS ||
      !list(w.history, 600) ||
      !list(w.logs, 40) ||
      !list(w.heroes, 20)
    )
      throw 0;
    const faction = (n: unknown, neutral = false) =>
      integer(n, neutral ? -1 : 0, s.kingdoms - 1);
    const ids = new Set<number>();
    const id = (n: number) => {
      if (!integer(n, 1, w.nextId - 1) || ids.has(n)) throw 0;
      ids.add(n);
    };
    for (const [i, k] of w.kingdoms.entries()) {
      if (modern && !finite(k.ceasefireUntil, 0, w.time + 10.001)) throw 0;
      if (!upgrading && !insideBoundary(w, k.x, k.y, 42)) throw 0;
      if (
        !k ||
        k.id !== i ||
        typeof k.name !== "string" ||
        k.name.length > 30 ||
        typeof k.color !== "string" ||
        !/^#[0-9a-f]{6}$/i.test(k.color) ||
        typeof k.alive !== "boolean" ||
        !finite(k.x, 42, WIDTH - 42) ||
        !finite(k.y, 42, HEIGHT - 42) ||
        !finite(k.hp, 0, k.maxHp) ||
        !finite(k.maxHp, 1, 1e6) ||
        !finite(k.resources) ||
        !integer(k.kills) ||
        !integer(k.recruited) ||
        (resetting
          ? !finite((k as unknown as { nextRecruit: number }).nextRecruit)
          : !finite(k.recruitProgress, 0, 1)) ||
        (!k.alive && k.hp !== 0) ||
        (k.alive && k.hp <= 0)
      )
        throw 0;
    }
    if (!w.kingdoms.some((k) => k.alive)) throw 0;
    for (const b of w.balls) {
      if (
        modern &&
        (!finite(b.orderUntil, 0, w.time + 6.001) ||
          !finite(b.nextOrder, 0, w.time + 20.001) ||
          !finite(b.guardUntil, 0, w.time + 4.001) ||
          !finite(b.nextGuard, 0, w.time + 25.001))
      )
        throw 0;
      if (
        !b ||
        !faction(b.kingdom) ||
        !w.kingdoms[b.kingdom].alive ||
        !finite(b.r, 1, 24) ||
        !finite(b.x, b.r, WIDTH - b.r) ||
        !finite(b.y, b.r, HEIGHT - b.r) ||
        !finite(b.vx, -1e6, 1e6) ||
        !finite(b.vy, -1e6, 1e6) ||
        !finite(b.mass, 0.01, 20) ||
        !finite(b.maxHp, 1, 10000) ||
        !finite(b.hp, legacy ? 0.001 : Number.MIN_VALUE, b.maxHp) ||
        !finite(b.attack, 1, 100) ||
        !finite(b.defense, 0, 35) ||
        !integer(b.level, 1, 10) ||
        !finite(b.xp) ||
        !integer(b.kills) ||
        typeof b.king !== "boolean" ||
        !finite(b.cooldown) ||
        !finite(b.shieldUntil) ||
        !list(b.skills, 4) ||
        !b.skills.every((skill) => SKILLS.includes(skill)) ||
        new Set(b.skills).size !== b.skills.length
      )
        throw 0;
      id(b.id);
      if (
        !upgrading &&
        (typeof b.warCryUsed !== "boolean" ||
          !finite(b.warCryUntil) ||
          !insideBoundary(w, b.x, b.y, b.r - 0.01))
      )
        throw 0;
      if (
        !legacy &&
        (!WEAPON_TYPES.includes(b.weapon) ||
          !finite(b.chargeUntil) ||
          !finite(b.nextAttack) ||
          !finite(b.attackAngle, -100, 100) ||
          !finite(b.attackUntil))
      )
        throw 0;
    }
    for (const k of w.kingdoms)
      if (w.balls.filter((b) => b.kingdom === k.id && b.king).length > 1)
        throw 0;
    for (const r of w.resources) {
      if (!upgrading && !insideBoundary(w, r.x, r.y)) throw 0;
      if (
        !r ||
        !finite(r.x, 0, WIDTH) ||
        !finite(r.y, 0, HEIGHT) ||
        !finite(r.value, 0.001)
      )
        throw 0;
      id(r.id);
    }
    for (const o of w.obstacles)
      if (
        !o ||
        !finite(o.x, 0, WIDTH) ||
        !finite(o.y, 0, HEIGHT) ||
        !finite(o.r, 1, 100)
      )
        throw 0;
    for (const c of w.cells) {
      if (
        !legacy &&
        ![
          "grass",
          "sand",
          "ice",
          "forest",
          "mountain",
          "water",
          "bridge",
        ].includes(c.terrain)
      )
        throw 0;
      if (
        !legacy &&
        (c.terrain === "water" || c.terrain === "mountain") &&
        !c.blocked
      )
        throw 0;
      if (
        !c ||
        !faction(c.owner, true) ||
        !faction(c.claimant, true) ||
        !finite(c.progress, 0, 1) ||
        typeof c.blocked !== "boolean" ||
        (c.owner >= 0 && !w.kingdoms[c.owner].alive) ||
        (c.claimant >= 0 && !w.kingdoms[c.claimant].alive)
      )
        throw 0;
    }
    if (
      !upgrading &&
      w.settings.shape === "circle" &&
      w.cells.some(
        (c, i) =>
          !insideBoundary(
            w,
            ((i % COLS) + 0.5) * TILE,
            (Math.floor(i / COLS) + 0.5) * TILE,
          ) && !c.blocked,
      )
    )
      throw 0;
    if (
      !w.event ||
      !["", "资源雨", "加速", "防护"].includes(w.event.kind) ||
      !finite(w.event.until)
    )
      throw 0;
    for (const h of w.history)
      if (
        !h ||
        !finite(h.time, 0, w.time) ||
        !Array.isArray(h.territory) ||
        h.territory.length !== s.kingdoms ||
        !h.territory.every((n) => integer(n, 0, COLS * ROWS))
      )
        throw 0;
    for (const l of w.logs)
      if (
        !l ||
        !finite(l.time, 0, w.time) ||
        typeof l.text !== "string" ||
        l.text.length > 200
      )
        throw 0;
    for (const h of w.heroes)
      if (
        !h ||
        !integer(h.id, 1, w.nextId - 1) ||
        !faction(h.kingdom) ||
        !integer(h.kills) ||
        !integer(h.level, 1, 10)
      )
        throw 0;
    if (
      w.winner !== null &&
      (!faction(w.winner) ||
        w.kingdoms.filter((k) => k.alive).length !== 1 ||
        !w.kingdoms[w.winner].alive ||
        !w.cells.every((c) => c.blocked || c.owner === w.winner))
    )
      throw 0;
    if (!legacy) {
      const kingdomWeapons = w.kingdoms.map((k) => k.weapon);
      if (
        kingdomWeapons.some((weapon) => !WEAPON_TYPES.includes(weapon)) ||
        ((w.version as number) === 2 &&
          new Set(kingdomWeapons).size !== kingdomWeapons.length)
      )
        throw 0;
      for (const p of w.projectiles) {
        if (
          !p ||
          !integer(p.source, 1, w.nextId - 1) ||
          !faction(p.kingdom) ||
          !w.kingdoms[p.kingdom].alive ||
          !finite(p.x, 0, WIDTH) ||
          !finite(p.y, 0, HEIGHT) ||
          !finite(p.vx, -800, 800) ||
          !finite(p.vy, -800, 800) ||
          Math.hypot(p.vx, p.vy) < 1 ||
          !finite(p.remaining, Number.MIN_VALUE, 500) ||
          !finite(p.attack, 1, upgrading ? 100 : modern ? 144 : 125) ||
          typeof p.heavy !== "boolean" ||
          typeof p.vamp !== "boolean" ||
          !["bow", "crossbow"].includes(p.weapon)
        )
          throw 0;
        id(p.id);
      }
    } else {
      const weapons = assignWeapons(seedHash(s.seed + "-weapons"), s.kingdoms);
      w.mapType = "grassland";
      w.projectiles = [];
      w.combatHits = 0;
      for (const k of w.kingdoms) k.weapon = weapons[k.id];
      for (const b of w.balls)
        Object.assign(b, {
          weapon: weapons[b.kingdom],
          chargeUntil: 0,
          nextAttack: w.time + 0.5,
          attackAngle: Math.atan2(b.vy, b.vx),
          attackUntil: 0,
        });
      for (const c of w.cells) c.terrain = "grass";
      Object.assign(s, {
        perKingdom: Math.max(1, Math.floor(s.population / s.kingdoms)),
        musicVolume: 0.25,
        map: "grassland",
      });
    }
    if (upgrading) {
      s.shape = "rectangle";
      s.layout = "normal";
      for (const k of w.kingdoms) {
        const balls = w.balls
          .filter((b) => b.kingdom === k.id)
          .sort((a, b) => Number(b.king) - Number(a.king) || a.id - b.id);
        const army = balancedArmy(balls.length);
        if (army.length) {
          const kingWeapon = assignWeapons(
            seedHash(s.seed + "-mixed-king-" + k.id),
            1,
          )[0];
          const index = Math.max(0, army.indexOf(kingWeapon));
          [army[0], army[index]] = [army[index], army[0]];
        }
        balls.forEach((b, i) =>
          Object.assign(b, {
            weapon: army[i],
            warCryUsed: false,
            warCryUntil: 0,
          }),
        );
      }
    }
    if (resetting) {
      for (const k of w.kingdoms) {
        const old = k as unknown as { nextRecruit?: number };
        k.recruitProgress = Math.max(
          0,
          Math.min(1, 1 - ((old.nextRecruit ?? w.time) - w.time) / 2.5),
        );
        delete old.nextRecruit;
      }
      for (const b of w.balls)
        if (!b.king) {
          const ratio = b.hp / b.maxHp,
            angle = Math.atan2(b.vy, b.vx);
          Object.assign(b, {
            r: 6,
            mass: 0.6,
            maxHp: 112,
            hp: Math.max(Number.MIN_VALUE, 112 * ratio),
            attack: 8,
            defense: 2,
            level: 1,
            xp: 0,
            skills: [],
            vx: Math.cos(angle) * 75,
            vy: Math.sin(angle) * 75,
            shieldUntil: 0,
            warCryUsed: false,
            warCryUntil: 0,
          });
        }
    }
    w.settings = normalizeSettings(w.settings);
    if ((w.version as number) < 5) {
      w.blasts = [];
      w.fires = [];
    }
    if (!list(w.blasts, 8000) || !list(w.fires, 8)) throw 0;
    for (const b of w.blasts)
      if (
        !finite(b.x, 0, WIDTH) ||
        !finite(b.y, 0, HEIGHT) ||
        ![140, 150].includes(b.radius) ||
        !finite(b.born, 0, w.time) ||
        (b.source !== null && !integer(b.source, 1, w.nextId - 1))
      )
        throw 0;
    if (
      modern &&
      w.blasts.some(
        (b) =>
          b.lightning !== undefined &&
          (typeof b.lightning !== "boolean" ||
            (b.lightning && (b.source !== null || b.radius !== 150))),
      )
    )
      throw 0;
    for (const f of w.fires)
      if (
        !finite(f.x, 0, WIDTH) ||
        !finite(f.y, 0, HEIGHT) ||
        !finite(f.born, 0, w.time) ||
        !finite(f.until, f.born + 15.799, f.born + 15.801) ||
        !finite(f.nextTick, f.born, f.until + 0.501)
      )
        throw 0;
    if ((w.version as number) < 6) {
      installArena(w);
    } else if (
      w.settings.layout === "arena"
        ? !w.arenaWall ||
          Object.keys(w.arenaWall).length !== 3 ||
          w.arenaWall.radius !== ARENA_WALL.radius ||
          w.arenaWall.thickness !== ARENA_WALL.thickness ||
          w.arenaWall.gateWidth !== ARENA_WALL.gateWidth
        : w.arenaWall !== null
    )
      throw 0;
    if (
      w.balls.some((b) => wallBlocked(w, b.x, b.y, b.r - 0.01)) ||
      w.resources.some((r) => wallBlocked(w, r.x, r.y, 0))
    )
      throw 0;
    if (!modern) {
      w.terrainBoundaryVersion = 1;
      w.weather = initialWeather(w.settings.seed, w.time);
      for (const k of w.kingdoms) k.ceasefireUntil = 0;
      for (const b of w.balls)
        Object.assign(b, {
          orderUntil: 0,
          nextOrder: 0,
          guardUntil: 0,
          nextGuard: 0,
        });
      syncNaturalWorld(w);
      w.version = 7;
    } else {
      if (
        w.terrainBoundaryVersion !== 1 ||
        !w.weather ||
        !finite(w.weather.nextRain) ||
        !finite(w.weather.nextStorm) ||
        !list(w.weather.strikes, 6)
      )
        throw 0;
      if (
        w.weather.rain === undefined ||
        w.weather.storm === undefined ||
        (w.weather.rain !== null && typeof w.weather.rain !== "object") ||
        (w.weather.storm !== null && typeof w.weather.storm !== "object")
      )
        throw 0;
      const ground = (p: { x: number; y: number }) =>
        !terrainBlocked(w, p.x, p.y, 3) &&
        w.obstacles.every((o) => Math.hypot(p.x - o.x, p.y - o.y) > o.r + 3);
      for (const [zone, duration] of [
        [w.weather.rain, 15],
        [w.weather.storm, 12],
      ] as const)
        if (zone) {
          if (
            !finite(zone.x, 3, WIDTH - 3) ||
            !finite(zone.y, 3, HEIGHT - 3) ||
            zone.radius !== 450 ||
            !finite(zone.born, 0, w.time) ||
            !finite(
              zone.until,
              zone.born + duration - 0.001,
              zone.born + duration + 0.001,
            ) ||
            !ground(zone)
          )
            throw 0;
        }
      const storm = w.weather.storm;
      if (
        storm &&
        (!integer(storm.warnings, 0, 6) ||
          !finite(storm.nextWarning) ||
          Math.abs(storm.nextWarning - storm.born - 1 - storm.warnings * 2) >
            0.001)
      )
        throw 0;
      for (const strike of w.weather.strikes)
        if (
          !finite(strike.x, 3, WIDTH - 3) ||
          !finite(strike.y, 3, HEIGHT - 3) ||
          !finite(strike.warned, 0, w.time + 1e-9) ||
          !finite(
            strike.at,
            Math.max(w.time, strike.warned + 0.999),
            strike.warned + 1.001,
          ) ||
          !ground(strike)
        )
          throw 0;
      if (w.balls.some((b) => terrainBlocked(w, b.x, b.y, b.r - 0.01))) throw 0;
    }
    if (!w.settings.events) clearWeather(w);
    return w;
  } catch {
    throw new Error(ERROR);
  }
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ball-kingdom", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("saves", { keyPath: "slot" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("无法打开本地存档，请检查浏览器存储权限。"));
  });
}
export async function saveWorld(world: World, slot: Slot): Promise<void> {
  const snapshot = structuredClone(world);
  validateWorld(snapshot);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put({
        slot,
        savedAt: new Date().toISOString(),
        world: snapshot,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(new Error("保存失败，浏览器存储空间可能不足。"));
    });
  } finally {
    db.close();
  }
}
export async function loadSaves(): Promise<Save[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction("saves").objectStore("saves").getAll();
      req.onsuccess = () => resolve(req.result as Save[]);
      req.onerror = () => reject(new Error("读取存档失败。"));
    });
  } finally {
    db.close();
  }
}
export function importSave(text: string): World {
  if (text.length > 12_000_000) throw new Error("存档文件超过12MB限制。");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(ERROR);
  }
  return validateWorld(data);
}
