export const WEAPON_TYPES = [
  "sword",
  "spear",
  "axe",
  "shield",
  "bow",
  "crossbow",
  "hammer",
  "halberd",
] as const;
export type Weapon = (typeof WEAPON_TYPES)[number];
export const TROOP_NAMES: Record<Weapon, string> = {
  sword: "剑兵",
  spear: "矛兵",
  axe: "斧兵",
  shield: "盾兵",
  bow: "弓兵",
  crossbow: "弩兵",
  hammer: "锤兵",
  halberd: "戟兵",
};
export function troopCounts(
  balls: { weapon: Weapon }[],
): Record<Weapon, number> {
  const counts = Object.fromEntries(
    WEAPON_TYPES.map((weapon) => [weapon, 0]),
  ) as Record<Weapon, number>;
  for (const b of balls) counts[b.weapon]++;
  return counts;
}
export function balancedArmy(count: number): Weapon[] {
  return Array.from(
    { length: count },
    (_, i) => WEAPON_TYPES[i % WEAPON_TYPES.length],
  );
}
export interface WeaponSpec {
  name: string;
  icon: string;
  range: number;
  cooldown: number;
  multiplier: number;
  arc: number;
  projectile: boolean;
}
export const WEAPONS: Record<Weapon, WeaponSpec> = {
  sword: {
    name: "剑",
    icon: "⚔",
    range: 26,
    cooldown: 0.55,
    multiplier: 1,
    arc: 0,
    projectile: false,
  },
  spear: {
    name: "长矛",
    icon: "➶",
    range: 58,
    cooldown: 0.9,
    multiplier: 1.2,
    arc: 0,
    projectile: false,
  },
  axe: {
    name: "战斧",
    icon: "⚒",
    range: 40,
    cooldown: 1.5,
    multiplier: 1.55,
    arc: Math.PI * 0.6,
    projectile: false,
  },
  shield: {
    name: "盾牌",
    icon: "⛨",
    range: 0,
    cooldown: 1,
    multiplier: 1.35,
    arc: 0,
    projectile: false,
  },
  bow: {
    name: "弓",
    icon: "⌁",
    range: 260,
    cooldown: 1.3,
    multiplier: 0.72,
    arc: 0,
    projectile: true,
  },
  crossbow: {
    name: "弩",
    icon: "✛",
    range: 330,
    cooldown: 2.5,
    multiplier: 1.65,
    arc: 0,
    projectile: true,
  },
  hammer: {
    name: "战锤",
    icon: "◆",
    range: 26,
    cooldown: 1.8,
    multiplier: 1.15,
    arc: Math.PI * 2,
    projectile: false,
  },
  halberd: {
    name: "长戟",
    icon: "†",
    range: 50,
    cooldown: 1.4,
    multiplier: 1.1,
    arc: Math.PI,
    projectile: false,
  },
};
export function assignWeapons(seed: number, count: number): Weapon[] {
  const pool = [...WEAPON_TYPES];
  // Independent generator also used for v1 migration: never consumes the world's RNG state.
  for (let i = pool.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
