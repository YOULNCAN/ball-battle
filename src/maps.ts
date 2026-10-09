import { wallBlocked } from "./arena";
import { WIDTH, HEIGHT, TILE, COLS, ROWS, type World, type Ball } from "./sim";

export const MAP_TYPES = [
  "grassland",
  "desert",
  "snow",
  "forest",
  "valley",
  "islands",
] as const;
export type MapType = (typeof MAP_TYPES)[number];
export type Terrain =
  | "grass"
  | "sand"
  | "ice"
  | "forest"
  | "mountain"
  | "water"
  | "bridge";
export const CIRCLE_RADIUS = 1140;
export const SHAPE_NAMES = { rectangle: "矩形", circle: "圆形" };
export const LAYOUT_NAMES = {
  normal: "常规",
  lake: "中央湖泊",
  arena: "中央竞技场",
};
export function insideBoundary(w: World, x: number, y: number, r = 0): boolean {
  return (
    w.settings.shape !== "circle" ||
    Math.hypot(x - WIDTH / 2, y - HEIGHT / 2) <= CIRCLE_RADIUS - r
  );
}
export function constrainBoundary(w: World, b: Ball) {
  if (w.settings.shape !== "circle") return;
  const dx = b.x - WIDTH / 2,
    dy = b.y - HEIGHT / 2,
    distance = Math.hypot(dx, dy),
    limit = CIRCLE_RADIUS - b.r;
  if (distance <= limit) return;
  const nx = dx / distance,
    ny = dy / distance;
  b.x = WIDTH / 2 + nx * (limit - 0.01);
  b.y = HEIGHT / 2 + ny * (limit - 0.01);
  const dot = b.vx * nx + b.vy * ny;
  if (dot > 0) {
    b.vx -= 2 * dot * nx;
    b.vy -= 2 * dot * ny;
  }
}
export const MAP_NAMES: Record<MapType, string> = {
  grassland: "草原",
  desert: "沙漠",
  snow: "雪原",
  forest: "森林",
  valley: "山谷",
  islands: "群岛",
};
export const TERRAIN_COLORS: Record<Terrain, string> = {
  grass: "#253d34",
  sand: "#66553c",
  ice: "#3a5664",
  forest: "#1e352b",
  mountain: "#3b4147",
  water: "#173f56",
  bridge: "#776747",
};
export const MAP_HINTS: Record<MapType, string> = {
  grassland: "草地正常通行 · 岩石阻挡",
  desert: "沙地减速至70% · 沙丘阻挡",
  snow: "冰面自由滑行 · 弹性反弹",
  forest: "林地减速至65% · 树木阻挡",
  valley: "山壁阻挡 · 沿谷地通行",
  islands: "水岸反弹 · 桥梁连接岛屿 · 箭矢可越水",
};
export const impassable = (t: Terrain) => t === "water" || t === "mountain";
export function cellIndex(x: number, y: number): number {
  return (
    Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE))) +
    Math.max(0, Math.min(ROWS - 1, Math.floor(y / TILE))) * COLS
  );
}
export function terrainAt(w: World, x: number, y: number): Terrain {
  return w.cells[cellIndex(x, y)].terrain;
}
export function terrainBlocked(
  w: World,
  x: number,
  y: number,
  r: number,
): boolean {
  if (!insideBoundary(w, x, y, r) || wallBlocked(w,x,y,r)) return true;
  for (
    let cy = Math.max(0, Math.floor((y - r) / TILE));
    cy <= Math.min(ROWS - 1, Math.floor((y + r) / TILE));
    cy++
  ) {
    for (
      let cx = Math.max(0, Math.floor((x - r) / TILE));
      cx <= Math.min(COLS - 1, Math.floor((x + r) / TILE));
      cx++
    ) {
      if (!impassable(w.cells[cx + cy * COLS].terrain)) continue;
      const nearestX = Math.max(cx * TILE, Math.min((cx + 1) * TILE, x));
      const nearestY = Math.max(cy * TILE, Math.min((cy + 1) * TILE, y));
      if ((x - nearestX) ** 2 + (y - nearestY) ** 2 < r * r) return true;
    }
  }
  return false;
}
export function moveOnTerrain(w: World, b: Ball, dx: number, dy: number) {
  // Small movement subdivisions prevent charge-speed balls tunnelling through shores.
  const count = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(3, b.r)),
  );
  for (let i = 0; i < count; i++) {
    if (!insideBoundary(w, b.x + dx / count, b.y + dy / count, b.r)) {
      b.x += dx / count;
      b.y += dy / count;
      constrainBoundary(w, b);
      return;
    }
    const x = Math.max(b.r, Math.min(WIDTH - b.r, b.x + dx / count));
    const y = Math.max(b.r, Math.min(HEIGHT - b.r, b.y + dy / count));
    if (!terrainBlocked(w, x, b.y, b.r)) b.x = x;
    else {
      b.vx = -b.vx;
      dx = -dx;
    }
    if (!terrainBlocked(w, b.x, y, b.r)) b.y = y;
    else {
      b.vy = -b.vy;
      dy = -dy;
    }
  }
}
export function relocateIfBlocked(w: World, b: Pick<Ball, "x" | "y" | "r">) {
  if (!terrainBlocked(w, b.x, b.y, b.r)) return;
  const start = cellIndex(b.x, b.y),
    cx = start % COLS,
    cy = Math.floor(start / COLS);
  for (let distance = 1; distance < Math.max(COLS, ROWS); distance++) {
    for (
      let y = Math.max(0, cy - distance);
      y <= Math.min(ROWS - 1, cy + distance);
      y++
    )
      for (
        let x = Math.max(0, cx - distance);
        x <= Math.min(COLS - 1, cx + distance);
        x++
      ) {
        if (Math.abs(x - cx) !== distance && Math.abs(y - cy) !== distance)
          continue;
        if (!terrainBlocked(w, (x + 0.5) * TILE, (y + 0.5) * TILE, b.r)) {
          b.x = (x + 0.5) * TILE;
          b.y = (y + 0.5) * TILE;
          return;
        }
      }
  }
}
export function reachableCells(w: World): Set<number> {
  const start = cellIndex(w.kingdoms[0].x, w.kingdoms[0].y),
    seen = new Set([start]),
    queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head],
      x = i % COLS,
      y = Math.floor(i / COLS);
    for (const j of [
      x > 0 ? i - 1 : -1,
      x < COLS - 1 ? i + 1 : -1,
      y > 0 ? i - COLS : -1,
      y < ROWS - 1 ? i + COLS : -1,
    ]) {
      if (j < 0 || seen.has(j) || w.cells[j].blocked) continue;
      const px = ((j % COLS) + 0.5) * TILE,
        py = (Math.floor(j / COLS) + 0.5) * TILE;
      if (w.obstacles.some((o) => Math.hypot(px - o.x, py - o.y) < o.r + 24))
        continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return seen;
}
export function connectedCastles(w: World): boolean {
  const seen = reachableCells(w);
  return w.kingdoms.every((k) => seen.has(cellIndex(k.x, k.y)));
}
export function generateTerrain(w: World, rng: () => number) {
  const map = w.mapType;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      let terrain: Terrain =
        map === "desert"
          ? "sand"
          : map === "snow"
            ? "ice"
            : map === "forest"
              ? "forest"
              : "grass";
      if (
        map === "valley" &&
        Math.sin(x * 0.48 + Math.sin(y * 0.45) * 1.8) > 0.2 &&
        rng() > 0.12
      )
        terrain = "mountain";
      if (map === "islands") {
        const nearIsland = w.kingdoms.some(
          (k) =>
            Math.hypot(k.x - (x + 0.5) * TILE, k.y - (y + 0.5) * TILE) <
            350 + rng() * 50,
        );
        terrain = nearIsland ? "grass" : "water";
      }
      if (
        (map === "forest" && rng() < 0.2) ||
        (map === "desert" && rng() < 0.12)
      )
        terrain = "grass";
      const outside = !insideBoundary(w, (x + 0.5) * TILE, (y + 0.5) * TILE);
      w.cells.push({
        owner: -1,
        claimant: -1,
        progress: 0,
        blocked: outside || impassable(terrain),
        terrain,
      });
    }
  // Three-cell-wide corridors give even fully grown balls clearance. On islands these are bridges.
  const clear = (cx: number, cy: number, radius: number, bridge: boolean) => {
    for (let y = cy - radius; y <= cy + radius; y++)
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        const c = w.cells[x + y * COLS];
        if (!insideBoundary(w, (x + 0.5) * TILE, (y + 0.5) * TILE)) continue;
        if (impassable(c.terrain))
          c.terrain = bridge && c.terrain === "water" ? "bridge" : "grass";
        c.blocked = false;
      }
  };
  for (let i = 0; i < w.kingdoms.length; i++) {
    const a = w.kingdoms[i],
      b = w.kingdoms[(i + 1) % w.kingdoms.length];
    clear(Math.floor(a.x / TILE), Math.floor(a.y / TILE), 2, false);
    if (map === "islands" || map === "valley") {
      const samples = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (TILE / 3));
      for (let n = 0; n <= samples; n++)
        clear(
          Math.floor((a.x + ((b.x - a.x) * n) / samples) / TILE),
          Math.floor((a.y + ((b.y - a.y) * n) / samples) / TILE),
          1,
          map === "islands",
        );
    }
  }
  if (w.settings.layout !== "normal") {
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const distance = Math.hypot(
          (x + 0.5) * TILE - WIDTH / 2,
          (y + 0.5) * TILE - HEIGHT / 2,
        );
        if (distance < (w.settings.layout === "lake" ? 300 : 380)) {
          const cell = w.cells[x + y * COLS];
          cell.terrain = w.settings.layout === "lake" ? "water" : "grass";
          cell.blocked = cell.terrain === "water";
        }
      }
    if (w.settings.layout === "arena")
      for (const k of w.kingdoms) {
        const n = Math.ceil(Math.hypot(k.x - WIDTH / 2, k.y - HEIGHT / 2) / 40);
        for (let j = 0; j <= n; j++)
          clear(
            Math.floor((k.x + ((WIDTH / 2 - k.x) * j) / n) / TILE),
            Math.floor((k.y + ((HEIGHT / 2 - k.y) * j) / n) / TILE),
            1,
            true,
          );
      }
    w.obstacles = w.obstacles.filter(
      (o) => Math.hypot(o.x - WIDTH / 2, o.y - HEIGHT / 2) > 400 + o.r,
    );
  }
  // Existing random obstacles must not obstruct bridges, corridors or castle exits.
  w.obstacles = w.obstacles.filter(
    (o) =>
      !terrainBlocked(w, o.x, o.y, o.r + 26) &&
      terrainAt(w, o.x, o.y) !== "bridge" &&
      w.kingdoms.every((k) => Math.hypot(k.x - o.x, k.y - o.y) > o.r + 280),
  );
  if (!connectedCastles(w)) {
    // Deterministic safe fallback: carve straight broad corridors and remove obstacles on them.
    for (let i = 1; i < w.kingdoms.length; i++) {
      const a = w.kingdoms[0],
        b = w.kingdoms[i],
        n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 40);
      for (let j = 0; j <= n; j++)
        clear(
          Math.floor((a.x + ((b.x - a.x) * j) / n) / TILE),
          Math.floor((a.y + ((b.y - a.y) * j) / n) / TILE),
          1,
          map === "islands" || w.settings.layout === "lake",
        );
    }
    const a = w.kingdoms[0];
    w.obstacles = w.obstacles.filter((o) =>
      w.kingdoms.slice(1).every((b) => {
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((o.x - a.x) * dx + (o.y - a.y) * dy) / (dx * dx + dy * dy),
          ),
        );
        return (
          Math.hypot(o.x - a.x - t * dx, o.y - a.y - t * dy) > o.r + TILE * 1.5
        );
      }),
    );
  }
  for (let i = 0; i < w.cells.length; i++)
    w.cells[i].blocked =
      impassable(w.cells[i].terrain) ||
      !insideBoundary(
        w,
        ((i % COLS) + 0.5) * TILE,
        (Math.floor(i / COLS) + 0.5) * TILE,
      );
  // Refill sparse obstacle sets after route repair, validating each placement against connectivity.
  for (let attempt = 0; attempt < 80 && w.obstacles.length < 8; attempt++) {
    const o = {
      x: 60 + rng() * (WIDTH - 120),
      y: 60 + rng() * (HEIGHT - 120),
      r: 25 + rng() * 30,
    };
    if (
      terrainBlocked(w, o.x, o.y, o.r + 26) ||
      terrainAt(w, o.x, o.y) === "bridge" ||
      w.kingdoms.some((k) => Math.hypot(k.x - o.x, k.y - o.y) < 180 + o.r) ||
      w.obstacles.some((p) => Math.hypot(p.x - o.x, p.y - o.y) < p.r + o.r + 45)
    )
      continue;
    w.obstacles.push(o);
    if (!connectedCastles(w)) w.obstacles.pop();
  }
}
