import { COLS, ROWS, TILE, WIDTH, HEIGHT, type World } from "./sim";
import { contours } from "./territory";
import { type Terrain, TERRAIN_COLORS } from "./maps";

type Point = [number, number];
interface Edge {
  a: Point;
  b: Point;
  terrain: Terrain;
}
export interface NaturalMap {
  regions: Map<Terrain, Point[][]>;
  buckets: Edge[][];
  source: Terrain[];
}
const types: Terrain[] = [
  "sand",
  "ice",
  "forest",
  "water",
  "mountain",
  "bridge",
];
const cache = new WeakMap<World, NaturalMap>();
const paths = new WeakMap<NaturalMap, Map<Terrain, Path2D>>();
const groundPaths = new WeakMap<NaturalMap, Path2D[]>();
export function invalidateNatural(w: World) {
  cache.delete(w);
}
export function refreshNatural(w: World) {
  const old = cache.get(w);
  if (old && old.source.some((t, i) => t !== w.cells[i].terrain))
    cache.delete(w);
}
function index(x: number, y: number) {
  return (
    Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE))) +
    Math.max(0, Math.min(ROWS - 1, Math.floor(y / TILE))) * COLS
  );
}
export function naturalMap(w: World): NaturalMap {
  const old = cache.get(w);
  if (old) return old;
  const source = w.cells.map((c) => c.terrain);
  const regions = new Map<Terrain, Point[][]>();
  const buckets: Edge[][] = Array.from({ length: COLS * ROWS }, () => []);
  for (const terrain of types) {
    const loops = contours(source.map((t) => t === terrain)).map((loop) => {
      const flat: Point[] = [];
      for (let i = 0; i < loop.length; i++) {
        const prev = loop[(i + loop.length - 1) % loop.length],
          p = loop[i],
          next = loop[(i + 1) % loop.length];
        const a: Point = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2];
        const b: Point = [(next[0] + p[0]) / 2, (next[1] + p[1]) / 2];
        // Identical sampled curves feed Canvas, circle contact and swept ray tests.
        for (let n = 0; n < 8; n++) {
          const t = n / 8,
            u = 1 - t;
          flat.push([
            u * u * a[0] + 2 * u * t * p[0] + t * t * b[0],
            u * u * a[1] + 2 * u * t * p[1] + t * t * b[1],
          ]);
        }
      }
      return flat;
    });
    regions.set(terrain, loops);
    for (const loop of loops)
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i],
          b = loop[(i + 1) % loop.length],
          edge = { a, b, terrain };
        for (
          let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) / TILE));
          y <= Math.min(ROWS - 1, Math.floor(Math.max(a[1], b[1]) / TILE));
          y++
        )
          for (
            let x = Math.max(0, Math.floor(Math.min(a[0], b[0]) / TILE));
            x <= Math.min(COLS - 1, Math.floor(Math.max(a[0], b[0]) / TILE));
            x++
          )
            buckets[x + y * COLS].push(edge);
      }
  }
  const entry = { source, regions, buckets };
  cache.set(w, entry);
  return entry;
}
function intersection(
  x: number,
  y: number,
  nx: number,
  ny: number,
  e: Edge,
): number | null {
  const dx = nx - x,
    dy = ny - y,
    ex = e.b[0] - e.a[0],
    ey = e.b[1] - e.a[1];
  const cross = dx * ey - dy * ex;
  if (Math.abs(cross) < 1e-10) return null;
  const fx = e.a[0] - x,
    fy = e.a[1] - y,
    t = (fx * ey - fy * ex) / cross,
    u = (fx * dy - fy * dx) / cross;
  return t >= 0 && t <= 1 && u >= 0 && u < 1 ? t : null;
}
export function naturalTerrainAt(w: World, x: number, y: number): Terrain {
  const i = index(x, y);
  if (cache.get(w)?.source[i] !== w.cells[i].terrain) refreshNatural(w);
  const map = naturalMap(w),
    edges = map.buckets[i];
  if (!edges.length) return map.source[i];
  const ax = ((i % COLS) + 0.5) * TILE,
    ay = (Math.floor(i / COLS) + 0.5) * TILE;
  if (Math.abs(ax - x) + Math.abs(ay - y) < 1e-8) return map.source[i];
  const inside = new Set<Terrain>([map.source[i]]);
  for (const e of edges)
    if (intersection(ax, ay, x, y, e) !== null) {
      if (inside.has(e.terrain)) inside.delete(e.terrain);
      else inside.add(e.terrain);
    }
  // Grass is the underlay. Bridge wins at shared multi-terrain corners.
  for (let n = types.length - 1; n >= 0; n--)
    if (inside.has(types[n])) return types[n];
  return "grass";
}
function distance2(x: number, y: number, e: Edge) {
  const dx = e.b[0] - e.a[0],
    dy = e.b[1] - e.a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((x - e.a[0]) * dx + (y - e.a[1]) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return (x - e.a[0] - t * dx) ** 2 + (y - e.a[1] - t * dy) ** 2;
}
export function naturalBlocked(
  w: World,
  x: number,
  y: number,
  r: number,
): boolean {
  const t = naturalTerrainAt(w, x, y);
  if (t === "water" || t === "mountain") return true;
  if (r <= 0) return false;
  const map = naturalMap(w);
  for (
    let cy = Math.max(0, Math.floor((y - r) / TILE));
    cy <= Math.min(ROWS - 1, Math.floor((y + r) / TILE));
    cy++
  )
    for (
      let cx = Math.max(0, Math.floor((x - r) / TILE));
      cx <= Math.min(COLS - 1, Math.floor((x + r) / TILE));
      cx++
    )
      for (const e of map.buckets[cx + cy * COLS])
        if (
          (e.terrain === "water" || e.terrain === "mountain") &&
          distance2(x, y, e) < r * r
        )
          return true;
  return false;
}
export function naturalRay(
  w: World,
  x: number,
  y: number,
  nx: number,
  ny: number,
  water = false,
): number {
  const t = naturalTerrainAt(w, x, y);
  if (t === "mountain" || (water && t === "water")) return 0;
  let hit = Infinity;
  const map = naturalMap(w);
  for (
    let cy = Math.max(0, Math.floor(Math.min(y, ny) / TILE));
    cy <= Math.min(ROWS - 1, Math.floor(Math.max(y, ny) / TILE));
    cy++
  )
    for (
      let cx = Math.max(0, Math.floor(Math.min(x, nx) / TILE));
      cx <= Math.min(COLS - 1, Math.floor(Math.max(x, nx) / TILE));
      cx++
    )
      for (const e of map.buckets[cx + cy * COLS])
        if (e.terrain === "mountain" || (water && e.terrain === "water")) {
          const d = intersection(x, y, nx, ny, e);
          if (d !== null) hit = Math.min(hit, d);
        }
  return hit;
}
export function naturalNormal(w: World, x: number, y: number): Point | null {
  const map = naturalMap(w);
  let best = Infinity,
    normal: Point | null = null;
  const i = index(x, y),
    cx = i % COLS,
    cy = Math.floor(i / COLS);
  for (let yy = Math.max(0, cy - 1); yy <= Math.min(ROWS - 1, cy + 1); yy++)
    for (let xx = Math.max(0, cx - 1); xx <= Math.min(COLS - 1, cx + 1); xx++)
      for (const e of map.buckets[xx + yy * COLS])
        if (e.terrain === "mountain" || e.terrain === "water") {
          const d = distance2(x, y, e);
          if (d >= best) continue;
          const dx = e.b[0] - e.a[0],
            dy = e.b[1] - e.a[1],
            l = Math.hypot(dx, dy);
          if (l > 0) {
            best = d;
            normal = [-dy / l, dx / l];
          }
        }
  return normal;
}
export function drawNatural(ctx: CanvasRenderingContext2D, w: World) {
  const map = naturalMap(w);
  let entry = paths.get(map);
  if (!entry) {
    entry = new Map();
    for (const [t, loops] of map.regions) {
      const p = new Path2D();
      for (const loop of loops) {
        p.moveTo(...loop[0]);
        for (const point of loop.slice(1)) p.lineTo(...point);
        p.closePath();
      }
      entry.set(t, p);
    }
    paths.set(map, entry);
  }
  ctx.fillStyle = TERRAIN_COLORS.grass;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const t of types) {
    ctx.fillStyle = TERRAIN_COLORS[t];
    ctx.fill(entry.get(t)!, "evenodd");
  }
}
export function clipNaturalGround(ctx: CanvasRenderingContext2D, w: World) {
  const map = naturalMap(w);
  let clips = groundPaths.get(map);
  if (!clips) {
    clips = ["water", "mountain"].map((t) => {
      const p = new Path2D();
      p.rect(0, 0, WIDTH, HEIGHT);
      for (const loop of map.regions.get(t as Terrain)!) {
        p.moveTo(...loop[0]);
        for (const point of loop.slice(1)) p.lineTo(...point);
        p.closePath();
      }
      return p;
    });
    groundPaths.set(map, clips);
  }
  for (const p of clips) ctx.clip(p, "evenodd");
}
