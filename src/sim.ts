import { installArena, type ArenaWall } from "./arena";
import { initialWeather, advanceWeather, type Weather } from "./weather";
import { royalSkills, ceased, orderMultiplier, guardMultiplier } from "./royal";
import { refreshNatural } from "./natural";
import { motionScale, elasticImpulse, physicsDelta } from "./physics";
import { castlePositions } from "./castles";
import {
  MAP_TYPES,
  generateTerrain,
  reachableCells,
  cellIndex,
  terrainBlocked,
  moveOnTerrain,
  relocateIfBlocked,
  type MapType,
  type Terrain,
  constrainBoundary,
  syncNaturalWorld,
} from "./maps";
import {
  assignWeapons,
  balancedArmy,
  troopCounts,
  WEAPON_TYPES,
  type Weapon,
} from "./weapons";
import { weaponCombat, type Projectile } from "./combat";
import {
  castleExplosion,
  resolveRoyalDeaths,
  advanceFire,
  forgetRemovedKings,
  type Blast,
  type Fire,
} from "./hazards";
export const WIDTH = 3600,
  HEIGHT = 2400,
  TILE = 120,
  COLS = WIDTH / TILE,
  ROWS = HEIGHT / TILE;
export const STEP = 1 / 30;
export const COLORS = [
  "#f4b45f",
  "#75c8ba",
  "#a8a0ed",
  "#f08091",
  "#8db7ef",
  "#c4d57d",
  "#e39fd4",
  "#e8ddbb",
];
export const NAMES = [
  "琥珀王国",
  "薄荷王国",
  "暮紫王国",
  "珊瑚王国",
  "晴空王国",
  "青禾王国",
  "蔷薇王国",
  "月白王国",
];
export const SKILLS = ["护盾", "重击", "吸血", "加速"] as const;
export type Skill = (typeof SKILLS)[number];
export interface Settings {
  seed: string;
  kingdoms: number;
  population: number;
  cap: number;
  events: boolean;
  volume: number;
  quality: "high" | "low";
  perKingdom: number;
  map: MapType | "random";
  musicVolume: number;
  shape: "rectangle" | "circle";
  layout: "normal" | "lake" | "arena";
}
export const DEFAULTS: Settings = {
  seed: "orb-2026",
  kingdoms: 6,
  population: 1200,
  cap: 2000,
  events: true,
  volume: 0.2,
  quality: "high",
  perKingdom: 200,
  map: "random",
  musicVolume: 0.25,
  shape: "rectangle",
  layout: "normal",
};
export interface Ball {
  id: number;
  kingdom: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  level: number;
  xp: number;
  kills: number;
  king: boolean;
  skills: Skill[];
  cooldown: number;
  shieldUntil: number;
  weapon: Weapon;
  chargeUntil: number;
  nextAttack: number;
  attackAngle: number;
  attackUntil: number;
  warCryUsed: boolean;
  warCryUntil: number;
  orderUntil: number;
  nextOrder: number;
  guardUntil: number;
  nextGuard: number;
}
export interface Kingdom {
  id: number;
  name: string;
  color: string;
  alive: boolean;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  resources: number;
  kills: number;
  recruited: number;
  recruitProgress: number;
  ceasefireUntil: number;
  weapon: Weapon;
}
export interface Cell {
  owner: number;
  claimant: number;
  progress: number;
  blocked: boolean;
  terrain: Terrain;
}
export interface Obstacle {
  x: number;
  y: number;
  r: number;
}
export interface Resource {
  id: number;
  x: number;
  y: number;
  value: number;
}
export interface History {
  time: number;
  territory: number[];
}
export interface Log {
  time: number;
  text: string;
}
export interface World {
  version: 7;
  settings: Settings;
  rng: number;
  nextId: number;
  time: number;
  balls: Ball[];
  kingdoms: Kingdom[];
  cells: Cell[];
  obstacles: Obstacle[];
  resources: Resource[];
  nextEvent: number;
  event: { kind: string; until: number };
  nextEconomy: number;
  nextHistory: number;
  history: History[];
  logs: Log[];
  winner: number | null;
  heroes: { id: number; kingdom: number; kills: number; level: number }[];
  mapType: MapType;
  projectiles: Projectile[];
  combatHits: number;
  blasts: Blast[];
  fires: Fire[];
  arenaWall: ArenaWall | null;
  terrainBoundaryVersion: 0 | 1;
  weather: Weather;
}
export interface Effect {
  x: number;
  y: number;
  text: string;
  color: string;
  kind: "hit" | "death" | "castle" | "swing" | "shot";
}
export function seedHash(seed: string): number {
  let n = 2166136261;
  for (const c of seed) {
    n ^= c.charCodeAt(0);
    n = Math.imul(n, 16777619);
  }
  return n >>> 0;
}
export function random(w: World): number {
  w.rng = (w.rng + 0x6d2b79f5) >>> 0;
  let t = w.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function log(w: World, text: string) {
  w.logs.unshift({ time: w.time, text });
  w.logs.length = Math.min(40, w.logs.length);
}
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function normalizeSettings(s: Settings): Settings {
  const cap = Math.round(clamp(Number(s.cap) || 2000, 100, 4000));
  return {
    seed: String(s.seed || "orb-2026").slice(0, 80),
    kingdoms: Math.round(clamp(Number(s.kingdoms) || 6, 2, 8)),
    population: Math.round(clamp(Number(s.population) || 1200, 20, cap)),
    cap,
    events: !!s.events,
    volume: clamp(Number(s.volume) || 0, 0, 1),
    quality: s.quality === "low" ? "low" : "high",
    perKingdom: Math.max(
      8,
      Math.floor(s.perKingdom ?? (s.population || 1200) / (s.kingdoms || 6)),
    ),
    map: s.map === "random" || MAP_TYPES.includes(s.map) ? s.map : "random",
    musicVolume: clamp(s.musicVolume ?? 0.25, 0, 1),
    shape: s.shape === "circle" ? "circle" : "rectangle",
    layout: ["lake", "arena"].includes(s.layout) ? s.layout : "normal",
  };
}
const reachablePointCache = new WeakMap<World, Set<number>>();
function freePoint(
  w: World,
  r: number,
  kingdom?: Kingdom,
): { x: number; y: number } {
  let reachable = reachablePointCache.get(w);
  if (!reachable) {
    reachable = reachableCells(w);
    reachablePointCache.set(w, reachable);
  }
  for (let i = 0; i < 120; i++) {
    const angle = random(w) * Math.PI * 2,
      distance = 65 + random(w) * 260;
    const x = kingdom
      ? clamp(kingdom.x + Math.cos(angle) * distance, r + 4, WIDTH - r - 4)
      : r + random(w) * (WIDTH - 2 * r);
    const y = kingdom
      ? clamp(kingdom.y + Math.sin(angle) * distance, r + 4, HEIGHT - r - 4)
      : r + random(w) * (HEIGHT - 2 * r);
    if (
      reachable.has(cellIndex(x, y)) &&
      !terrainBlocked(w, x, y, r) &&
      w.obstacles.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 3) &&
      w.kingdoms.every((k) => Math.hypot(k.x - x, k.y - y) > 45 + r)
    )
      return { x, y };
  }
  // Sparse obstacles guarantee a free cell; this also handles very crowded birth areas.
  for (let y = 30; y < HEIGHT; y += 60)
    for (let x = 30; x < WIDTH; x += 60) {
      if (
        reachable.has(cellIndex(x, y)) &&
        !terrainBlocked(w, x, y, r) &&
        w.obstacles.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 3) &&
        w.kingdoms.every((k) => Math.hypot(k.x - x, k.y - y) > 45 + r)
      )
        return { x, y };
    }
  return { x: WIDTH / 2, y: HEIGHT / 2 };
}
export function spawn(
  w: World,
  kingdom: number,
  fromCastle = true,
  direction?: number,
  weapon?: Weapon,
): Ball {
  if (!weapon) {
    const counts = troopCounts(
      w.balls.filter((b) => b.kingdom === kingdom && b.hp > 0),
    );
    const minimum = Math.min(...Object.values(counts));
    const choices = WEAPON_TYPES.filter((type) => counts[type] === minimum);
    weapon = choices[Math.floor(random(w) * choices.length)];
  }
  const r = 6,
    speed = 75,
    angle = direction ?? random(w) * Math.PI * 2;
  const hp = 70 + r * 7;
  const ball: Ball = {
    id: w.nextId++,
    kingdom,
    ...(fromCastle
      ? {
          x: w.kingdoms[kingdom].x + Math.cos(angle) * 4,
          y: w.kingdoms[kingdom].y + Math.sin(angle) * 4,
        }
      : freePoint(w, r)),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r,
    mass: (r * r) / 60,
    hp,
    maxHp: hp,
    attack: 8,
    defense: 2,
    level: 1,
    xp: 0,
    kills: 0,
    king: false,
    skills: [],
    cooldown: 0,
    shieldUntil: 0,
    weapon,
    chargeUntil: fromCastle ? w.time + 3 : 0,
    nextAttack: w.time + random(w) * 0.6,
    attackAngle: angle,
    attackUntil: 0,
    warCryUsed: false,
    warCryUntil: 0,
    orderUntil: 0,
    nextOrder: 0,
    guardUntil: 0,
    nextGuard: 0,
  };
  w.balls.push(ball);
  return ball;
}
export function createWorld(settings: Settings = DEFAULTS): World {
  const s = normalizeSettings(settings);
  s.perKingdom = Math.min(
    Math.floor(s.cap / s.kingdoms),
    Math.max(8, Math.ceil(20 / s.kingdoms), s.perKingdom),
  );
  s.population = s.perKingdom * s.kingdoms;
  const w: World = {
    version: 7,
    settings: s,
    rng: seedHash(s.seed),
    nextId: 1,
    time: 0,
    balls: [],
    kingdoms: [],
    cells: [],
    obstacles: [],
    resources: [],
    nextEvent: 35,
    event: { kind: "", until: 0 },
    nextEconomy: 1,
    nextHistory: 0,
    history: [],
    logs: [],
    winner: null,
    heroes: [],
    mapType: "grassland",
    projectiles: [],
    combatHits: 0,
    blasts: [],
    fires: [],
    arenaWall: null,
    terrainBoundaryVersion: 0,
    weather: initialWeather(s.seed, 0),
  };
  w.mapType =
    s.map === "random"
      ? MAP_TYPES[Math.floor(random(w) * MAP_TYPES.length)]
      : s.map;
  const weapons = assignWeapons(seedHash(s.seed + "-weapons"), s.kingdoms);
  const positions = castlePositions(w, () => random(w));
  for (let i = 0; i < s.kingdoms; i++) {
    w.kingdoms.push({
      id: i,
      name: NAMES[i],
      color: COLORS[i],
      alive: true,
      x: positions[i].x,
      y: positions[i].y,
      hp: 4200,
      maxHp: 4200,
      resources: 70 + Math.floor(random(w) * 80),
      kills: 0,
      recruited: 0,
      recruitProgress: 0,
      ceasefireUntil: 0,
      weapon: weapons[i],
    });
  }
  for (let i = 0; i < 20; i++) {
    const o = {
      x: 150 + random(w) * (WIDTH - 300),
      y: 150 + random(w) * (HEIGHT - 300),
      r: 25 + random(w) * 38,
    };
    if (
      w.kingdoms.every((k) => Math.hypot(k.x - o.x, k.y - o.y) > o.r + 130) &&
      w.obstacles.every(
        (p) => Math.hypot(p.x - o.x, p.y - o.y) > p.r + o.r + 45,
      )
    )
      w.obstacles.push(o);
  }
  generateTerrain(w, () => random(w));
  installArena(w);
  w.terrainBoundaryVersion = 1;
  syncNaturalWorld(w);
  for (const k of w.kingdoms) {
    const cx = Math.floor(k.x / TILE),
      cy = Math.floor(k.y / TILE);
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        const cell = w.cells[x + y * COLS];
        if (!cell.blocked)
          Object.assign(cell, { owner: k.id, claimant: k.id, progress: 1 });
      }
  }
  for (const k of w.kingdoms) {
    const phase = random(w) * Math.PI * 2;
    const army = balancedArmy(s.perKingdom);
    const kingIndex = army.indexOf(
      WEAPON_TYPES[Math.floor(random(w) * WEAPON_TYPES.length)],
    );
    [army[0], army[kingIndex]] = [army[kingIndex], army[0]];
    for (let i = 0; i < s.perKingdom; i++)
      spawn(
        w,
        k.id,
        true,
        phase + ((i + random(w) * 0.35) * Math.PI * 2) / s.perKingdom,
        army[i],
      );
  }
  for (const k of w.kingdoms) {
    const b = w.balls.find((b) => b.kingdom === k.id) ?? spawn(w, k.id);
    b.king = true;
    b.maxHp *= 1.8;
    b.hp = b.maxHp;
    b.attack *= 1.2;
  }
  for (let i = 0; i < 100; i++)
    w.resources.push({
      id: w.nextId++,
      ...freePoint(w, 3),
      value: 6 + Math.floor(random(w) * 12),
    });
  log(w, "诸国降临，新的历史从此开始。");
  recordHistory(w);
  return w;
}
export function territories(w: World): number[] {
  const result = w.kingdoms.map(() => 0);
  for (const c of w.cells) if (!c.blocked && c.owner >= 0) result[c.owner]++;
  return result;
}
function recordHistory(w: World) {
  w.history.push({ time: w.time, territory: territories(w) });
  // Downsample older histories so long-running saves remain bounded.
  if (w.history.length > 600)
    w.history = w.history.filter(
      (_, i) => i % 2 === 0 || i === w.history.length - 1,
    );
  w.nextHistory = w.time + 10;
}
export function damage(
  w: World,
  attacker: Ball,
  defender: Ball,
  impact: number,
): number {
  if (ceased(w, attacker.kingdom)) return 0;
  const heavy = attacker.skills.includes("重击")
    ? impact > 0
      ? 1.4
      : 1.25
    : 1;
  const shield =
    defender.skills.includes("护盾") ||
    defender.shieldUntil > w.time ||
    (w.event.kind === "防护" && w.event.until > w.time)
      ? 0.65
      : 1;
  const frontalShield =
    defender.weapon === "shield" &&
    (attacker.x - defender.x) * defender.vx +
      (attacker.y - defender.y) * defender.vy >=
      0
      ? 0.55
      : 1;
  const ram = attacker.weapon === "shield" && impact > 0 ? 1.35 : 1;
  const warAttack = attacker.king && attacker.warCryUntil > w.time ? 1.25 : 1;
  const warShield = defender.king && defender.warCryUntil > w.time ? 0.6 : 1;
  return (
    Math.max(
      2,
      (attacker.attack * orderMultiplier(w, attacker) +
        impact * 0.08 * Math.sqrt(attacker.mass)) *
        heavy *
        shield *
        frontalShield *
        ram *
        warAttack *
        warShield -
        defender.defense,
    ) * guardMultiplier(w, defender)
  );
}
export function kingWarCry(w: World, b: Ball) {
  if (b.king && b.hp > 0 && b.hp <= b.maxHp * 0.3 && !b.warCryUsed) {
    b.warCryUsed = true;
    b.warCryUntil = w.time + 5;
    log(w, `${w.kingdoms[b.kingdom].name}：国王发动王者战意！`);
  }
}
export function reward(w: World, b: Ball) {
  b.kills++;
  b.xp += 35;
  w.kingdoms[b.kingdom].kills++;
  while (b.level < 10 && b.xp >= b.level * 35) {
    b.xp -= b.level * 35;
    b.level++;
    b.r = Math.min(24, b.r + 1.2);
    b.mass = (b.r * b.r) / 60;
    b.maxHp += 20;
    if (b.level < 10) b.hp = Math.min(b.maxHp, b.hp + 40);
    b.attack = Math.min(100, b.attack + 4);
    b.defense = Math.min(35, b.defense + 1.5);
    const choices = SKILLS.filter((s) => !b.skills.includes(s));
    if (choices.length)
      b.skills.push(choices[Math.floor(random(w) * choices.length)]);
  }
}
function reflect(b: Ball, x: number, y: number, radius: number) {
  const dx = b.x - x,
    dy = b.y - y,
    d = Math.hypot(dx, dy),
    min = b.r + radius;
  if (d >= min) return false;
  const nx = d > 0.001 ? dx / d : 1,
    ny = d > 0.001 ? dy / d : 0;
  b.x = x + nx * (min + 0.1);
  b.y = y + ny * (min + 0.1);
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) {
    b.vx -= 2 * dot * nx;
    b.vy -= 2 * dot * ny;
  }
  return true;
}
export function collide(w: World, a: Ball, b: Ball, effects: Effect[] = []) {
  if (a.hp <= 0 || b.hp <= 0) return;
  if (
    a.kingdom === b.kingdom &&
    (a.chargeUntil > w.time || b.chargeUntil > w.time)
  )
    return;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = Math.hypot(dx, dy),
    overlap = a.r + b.r - d;
  if (overlap <= 0) return;
  const nx = d > 0.001 ? dx / d : a.id < b.id ? 1 : -1,
    ny = d > 0.001 ? dy / d : 0;
  const impact = elasticImpulse(w, a, b, nx, ny);
  const total = a.mass + b.mass;
  a.x -= (nx * (overlap + 0.1) * b.mass) / total;
  a.y -= (ny * (overlap + 0.1) * b.mass) / total;
  b.x += (nx * (overlap + 0.1) * a.mass) / total;
  b.y += (ny * (overlap + 0.1) * a.mass) / total;
  if (a.kingdom === b.kingdom || a.cooldown > w.time || b.cooldown > w.time)
    return;
  const da = damage(w, b, a, impact),
    db = damage(w, a, b, impact);
  a.hp -= da;
  b.hp -= db;
  w.combatHits += Number(da > 0) + Number(db > 0);
  a.cooldown = b.cooldown = w.time + 0.3;
  if (a.level < 10 && a.skills.includes("吸血") && a.hp > 0)
    a.hp = Math.min(a.maxHp, a.hp + db * 0.15);
  if (b.level < 10 && b.skills.includes("吸血") && b.hp > 0)
    b.hp = Math.min(b.maxHp, b.hp + da * 0.15);
  if (effects.length < 100) {
    if (da > 0)
      effects.push({
        x: a.x,
        y: a.y,
        text: `−${Math.round(da)}`,
        color: w.kingdoms[b.kingdom].color,
        kind: "hit",
      });
    if (db > 0)
      effects.push({
        x: b.x,
        y: b.y,
        text: `−${Math.round(db)}`,
        color: w.kingdoms[a.kingdom].color,
        kind: "hit",
      });
  }
  if (b.hp <= 0 && a.hp > 0) reward(w, a);
  if (a.hp <= 0 && b.hp > 0) reward(w, b);
  if (a.hp <= 0 || b.hp <= 0) resolveRoyalDeaths(w);
}
export function conquer(w: World, victim: Kingdom, attacker: Ball) {
  if (!victim.alive || victim.id === attacker.kingdom) return;
  resolveRoyalDeaths(w);
  const target = w.kingdoms[attacker.kingdom];
  victim.alive = false;
  victim.hp = 0;
  target.resources += victim.resources;
  victim.resources = 0;
  for (const b of w.balls)
    if (b.kingdom === victim.id) {
      b.kingdom = target.id;
      b.king = false;
    }
  for (const p of w.projectiles)
    if (p.kingdom === victim.id) p.kingdom = target.id;
  for (const c of w.cells) {
    if (c.owner === victim.id) c.owner = target.id;
    if (c.claimant === victim.id) c.claimant = target.id;
  }
  if (attacker.hp > 0) reward(w, attacker);
  log(w, `${victim.name}城堡陷落，归入${target.name}。`);
  castleExplosion(w, victim.x, victim.y);
}
export function cleanup(w: World, effects: Effect[] = []) {
  resolveRoyalDeaths(w);
  const alive: Ball[] = [];
  for (const b of w.balls) {
    if (b.hp > 0) {
      alive.push(b);
      continue;
    }
    w.resources.push({
      id: w.nextId++,
      x: clamp(b.x, 3, WIDTH - 3),
      y: clamp(b.y, 3, HEIGHT - 3),
      value: 12 + b.level * 6,
    });
    if (b.kills)
      w.heroes.push({
        id: b.id,
        kingdom: b.kingdom,
        kills: b.kills,
        level: b.level,
      });
    if (effects.length < 100)
      effects.push({
        x: b.x,
        y: b.y,
        text: "",
        color: w.kingdoms[b.kingdom].color,
        kind: "death",
      });
  }
  w.balls = alive;
  forgetRemovedKings(w);
  w.heroes.sort((a, b) => b.kills - a.kills || a.id - b.id);
  w.heroes.length = Math.min(20, w.heroes.length);
  for (const k of w.kingdoms)
    if (k.alive && !w.balls.some((b) => b.kingdom === k.id && b.king)) {
      const heir = w.balls
        .filter((b) => b.kingdom === k.id)
        .sort(
          (a, b) => b.level - a.level || b.kills - a.kills || a.id - b.id,
        )[0];
      if (heir) {
        heir.king = true;
        heir.warCryUsed = false;
        heir.warCryUntil = 0;
        heir.nextOrder = heir.nextGuard = heir.guardUntil = 0;
        log(w, `${k.name}：球球 #${heir.id} 继承王冠。`);
      }
    }
  // Keep every resource's value while merging piles in the same tile.
  if (w.resources.length > 3000) {
    const piles = new Map<number, Resource>();
    for (const r of w.resources) {
      const key = Math.floor(r.x / TILE) + Math.floor(r.y / TILE) * COLS;
      const existing = piles.get(key);
      if (existing) existing.value += r.value;
      else piles.set(key, { ...r });
    }
    w.resources = [...piles.values()];
  }
}
export function updateTerritory(w: World, dt: number) {
  const presence = new Int16Array(w.cells.length);
  presence.fill(-1);
  const counts = new Uint16Array(w.cells.length);
  for (const b of w.balls) {
    const i =
      Math.floor(clamp(b.x, 0, WIDTH - 0.01) / TILE) +
      Math.floor(clamp(b.y, 0, HEIGHT - 0.01) / TILE) * COLS;
    if (presence[i] === -1) presence[i] = b.kingdom;
    else if (presence[i] !== b.kingdom) presence[i] = -2;
    counts[i]++;
  }
  const remaining = w.kingdoms.filter((k) => k.alive);
  for (let i = 0; i < w.cells.length; i++) {
    const c = w.cells[i];
    if (c.blocked) continue;
    const faction = remaining.length === 1 ? remaining[0].id : presence[i];
    if (faction < 0) continue;
    if (c.owner === faction && c.claimant === faction && c.progress >= 1)
      continue;
    const amount =
      dt * (remaining.length === 1 ? 0.2 : 0.55 * Math.min(4, counts[i]));
    if (c.claimant !== faction && c.progress > 0) {
      c.progress = Math.max(0, c.progress - amount);
      if (c.progress === 0) {
        c.owner = -1;
        c.claimant = faction;
      }
    } else {
      c.claimant = faction;
      c.progress = Math.min(1, c.progress + amount);
      if (c.progress >= 1) c.owner = faction;
    }
  }
  if (
    remaining.length === 1 &&
    w.cells.every((c) => c.blocked || c.owner === remaining[0].id)
  ) {
    w.winner = remaining[0].id;
    log(w, `${remaining[0].name}统一了球球世界！`);
    recordHistory(w);
  }
}
function economy(w: World) {
  for (const k of w.kingdoms) if (k.alive) k.resources += 2;
  w.nextEconomy = w.time + 1;
}
export function production(
  w: World,
): { ratio: number; multiplier: number; interval: number }[] {
  const counts = territories(w),
    total = w.cells.filter((c) => !c.blocked).length;
  return w.kingdoms.map((k) => {
    const ratio = total ? Math.min(1, counts[k.id] / total) : 0;
    return { ratio, multiplier: 1 + ratio, interval: 2.5 / (1 + ratio) };
  });
}
export function recruit(w: World, dt: number) {
  const rates = production(w);
  for (const k of w.kingdoms)
    if (k.alive) {
      const ready = k.recruitProgress >= 1;
      const accumulated = k.recruitProgress + dt / rates[k.id].interval;
      k.recruitProgress = Math.min(1, accumulated);
      if (
        k.recruitProgress >= 1 - 1e-10 &&
        k.resources >= 180 &&
        w.balls.length + 10 <= w.settings.cap
      ) {
        k.resources -= 180;
        const offset = random(w) * Math.PI * 2;
        let hasKing = w.balls.some(
          (other) => other.kingdom === k.id && other.king && other.hp > 0,
        );
        for (let i = 0; i < 10; i++) {
          const direction =
            offset + (i * Math.PI * 2) / 10 + (random(w) - 0.5) * 0.08;
          const b = spawn(w, k.id, true, direction);
          k.recruited++;
          if (!hasKing) {
            b.king = true;
            hasKing = true;
          }
        }
        k.recruitProgress = ready
          ? 0
          : Math.min(1, Math.max(0, accumulated - 1));
      }
    }
}
function randomEvent(w: World) {
  const kind = ["资源雨", "加速", "防护"][Math.floor(random(w) * 3)];
  w.event = { kind, until: w.time + 12 };
  if (kind === "资源雨")
    for (let i = 0; i < 75; i++)
      w.resources.push({ id: w.nextId++, ...freePoint(w, 3), value: 20 });
  log(
    w,
    kind === "资源雨"
      ? "资源雨落下：大地上出现新的补给。"
      : `世界事件：全体球球获得12秒${kind}。`,
  );
  w.nextEvent = w.time + 35 + random(w) * 25;
}
const GRID = 64,
  GRID_COLS = Math.ceil(WIDTH / GRID) + 1;
function gridKey(x: number, y: number) {
  return Math.floor(x / GRID) + Math.floor(y / GRID) * GRID_COLS;
}
export function step(w: World, dt = STEP): Effect[] {
  if (w.winner !== null) return [];
  refreshNatural(w);
  w.time += dt;
  advanceWeather(w);
  advanceFire(w);
  royalSkills(w);
  const effects: Effect[] = [];
  const resourceGrid = new Map<number, Resource[]>();
  for (const r of w.resources) {
    const key = gridKey(r.x, r.y);
    const list = resourceGrid.get(key);
    if (list) list.push(r);
    else resourceGrid.set(key, [r]);
  }
  const taken = new Set<number>();
  let remaining = dt;
  while (remaining > 1e-12) {
    const movementDt = physicsDelta(w, remaining);
    remaining -= movementDt;
    const grid = new Map<number, Ball[]>();
    for (const b of w.balls) {
      if (b.hp <= 0) continue;
      kingWarCry(w, b);
      const boost = motionScale(w, b);
      if (
        b.x + b.vx * movementDt * boost < b.r ||
        b.x + b.vx * movementDt * boost > WIDTH - b.r
      )
        b.vx = -b.vx;
      if (
        b.y + b.vy * movementDt * boost < b.r ||
        b.y + b.vy * movementDt * boost > HEIGHT - b.r
      )
        b.vy = -b.vy;
      moveOnTerrain(w, b, b.vx * movementDt * boost, b.vy * movementDt * boost);
      if (b.x < b.r) {
        b.x = b.r;
        b.vx = Math.abs(b.vx);
      }
      if (b.x > WIDTH - b.r) {
        b.x = WIDTH - b.r;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y < b.r) {
        b.y = b.r;
        b.vy = Math.abs(b.vy);
      }
      if (b.y > HEIGHT - b.r) {
        b.y = HEIGHT - b.r;
        b.vy = -Math.abs(b.vy);
      }
      for (const o of w.obstacles) reflect(b, o.x, o.y, o.r);
      for (const k of w.kingdoms)
        if (k.alive) {
          if (
            k.id === b.kingdom &&
            b.hp > 0 &&
            Math.hypot(b.x - k.x, b.y - k.y) <= 42 + b.r
          ) {
            const healed = Math.min(b.maxHp - b.hp, k.resources * 10);
            b.hp += healed;
            k.resources = Math.max(0, k.resources - healed / 10);
          }
          if (k.id === b.kingdom && b.chargeUntil > w.time) continue;
          const speed = Math.hypot(b.vx, b.vy);
          if (
            reflect(b, k.x, k.y, 42) &&
            b.kingdom !== k.id &&
            b.cooldown <= w.time
          ) {
            const hit =
              Math.max(4, b.attack + speed * Math.sqrt(b.mass) * 0.06) *
              (b.king && b.warCryUntil > w.time ? 1.25 : 1) *
              orderMultiplier(w, b);
            k.hp -= hit;
            w.combatHits++;
            b.hp -= 5 * guardMultiplier(w, b);
            b.cooldown = w.time + 0.3;
            if (effects.length < 100)
              effects.push({
                x: k.x,
                y: k.y,
                text: `−${Math.round(hit)}`,
                color: k.color,
                kind: "castle",
              });
            if (k.hp <= 0) conquer(w, k, b);
            else if (b.hp <= 0) resolveRoyalDeaths(w);
          }
        }
      const gx = Math.floor(b.x / GRID),
        gy = Math.floor(b.y / GRID);
      for (let y = gy - 1; y <= gy + 1; y++)
        for (let x = gx - 1; x <= gx + 1; x++) {
          for (const r of resourceGrid.get(x + y * GRID_COLS) ?? [])
            if (
              !taken.has(r.id) &&
              Math.hypot(r.x - b.x, r.y - b.y) < b.r + 9
            ) {
              w.kingdoms[b.kingdom].resources += r.value;
              taken.add(r.id);
            }
        }
      const key = gridKey(b.x, b.y);
      const bucket = grid.get(key);
      if (bucket) bucket.push(b);
      else grid.set(key, [b]);
    }
    // Snapshot broad phase: each unordered pair is processed exactly once.
    for (const [key, bucket] of grid) {
      for (let i = 0; i < bucket.length; i++)
        for (let j = i + 1; j < bucket.length; j++)
          collide(w, bucket[i], bucket[j], effects);
      const gx = key % GRID_COLS;
      for (const offset of [1, GRID_COLS - 1, GRID_COLS, GRID_COLS + 1]) {
        if (
          (offset === 1 && gx === GRID_COLS - 1) ||
          (offset === GRID_COLS - 1 && gx === 0) ||
          (offset === GRID_COLS + 1 && gx === GRID_COLS - 1)
        )
          continue;
        const other = grid.get(key + offset);
        if (other)
          for (const a of bucket)
            for (const b of other) collide(w, a, b, effects);
      }
    }
  }
  weaponCombat(w, dt, effects);
  for (const b of w.balls) {
    b.x = clamp(b.x, b.r, WIDTH - b.r);
    b.y = clamp(b.y, b.r, HEIGHT - b.r);
    constrainBoundary(w, b);
    relocateIfBlocked(w, b);
    constrainBoundary(w, b);
    kingWarCry(w, b);
  }
  w.resources = w.resources.filter((r) => !taken.has(r.id));
  cleanup(w, effects);
  if (w.time >= w.nextEconomy) economy(w);
  if (w.settings.events && w.time >= w.nextEvent) randomEvent(w);
  updateTerritory(w, dt);
  if (w.winner === null) recruit(w, dt);
  if (w.time >= w.nextHistory) recordHistory(w);
  return effects;
}
