import { COLS, ROWS, TILE, type World } from "./sim";
import { clipNaturalGround } from "./natural";
type Point = [number, number];
const cases: Record<number, number[][]> = {
  1: [[3, 0]],
  2: [[0, 1]],
  3: [[3, 1]],
  4: [[1, 2]],
  5: [
    [3, 0],
    [1, 2],
  ],
  6: [[0, 2]],
  7: [[3, 2]],
  8: [[2, 3]],
  9: [[0, 2]],
  10: [
    [0, 1],
    [2, 3],
  ],
  11: [[1, 2]],
  12: [[1, 3]],
  13: [[0, 1]],
  14: [[3, 0]],
};
export function contours(
  mask: boolean[],
  columns = COLS,
  rows = ROWS,
  tile = TILE,
): Point[][] {
  const graph = new Map<string, string[]>(),
    points = new Map<string, Point>();
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < columns && y < rows && mask[x + y * columns];
  for (let y = -1; y < rows; y++)
    for (let x = -1; x < columns; x++) {
      const code =
        Number(!!at(x, y)) +
        2 * Number(!!at(x + 1, y)) +
        4 * Number(!!at(x + 1, y + 1)) +
        8 * Number(!!at(x, y + 1));
      const edges: Point[] = [
        [(x + 1) * tile, (y + 0.5) * tile],
        [(x + 1.5) * tile, (y + 1) * tile],
        [(x + 1) * tile, (y + 1.5) * tile],
        [(x + 0.5) * tile, (y + 1) * tile],
      ];
      for (const [a, b] of cases[code] || []) {
        const ka = edges[a].join(","),
          kb = edges[b].join(",");
        points.set(ka, edges[a]);
        points.set(kb, edges[b]);
        graph.set(ka, [...(graph.get(ka) || []), kb]);
        graph.set(kb, [...(graph.get(kb) || []), ka]);
      }
    }
  const visited = new Set<string>(),
    loops: Point[][] = [];
  for (const start of graph.keys()) {
    if (visited.has(start)) continue;
    const loop: Point[] = [];
    let current = start,
      previous = "";
    while (!visited.has(current)) {
      visited.add(current);
      loop.push(points.get(current)!);
      const next = graph.get(current)!.find((key) => key !== previous)!;
      previous = current;
      current = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
function path(loops: Point[][]): Path2D {
  const p = new Path2D();
  for (const loop of loops) {
    const last = loop[loop.length - 1],
      first = loop[0];
    p.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
    loop.forEach((point, i) => {
      const next = loop[(i + 1) % loop.length];
      p.quadraticCurveTo(
        point[0],
        point[1],
        (point[0] + next[0]) / 2,
        (point[1] + next[1]) / 2,
      );
    });
    p.closePath();
  }
  return p;
}
const cache = new WeakMap<
  World,
  { key: string; owned: Path2D[]; pending: Path2D[]; allowed: Path2D }
>();
export function drawTerritory(
  ctx: CanvasRenderingContext2D,
  w: World,
  opacity = 0.18,
) {
  const key = w.cells
    .map((c) =>
      c.blocked
        ? "x"
        : `${c.owner}:${c.owner < 0 && c.progress > 0 ? c.claimant : -1}`,
    )
    .join("|");
  let entry = cache.get(w);
  if (!entry || entry.key !== key) {
    const allowed = new Path2D();
    w.cells.forEach((c, i) => {
      if (!c.blocked)
        allowed.rect(
          (i % COLS) * TILE,
          Math.floor(i / COLS) * TILE,
          TILE,
          TILE,
        );
    });
    entry = {
      key,
      allowed,
      owned: w.kingdoms.map((k) =>
        path(contours(w.cells.map((c) => !c.blocked && c.owner === k.id))),
      ),
      pending: w.kingdoms.map((k) =>
        path(
          contours(
            w.cells.map(
              (c) =>
                !c.blocked &&
                c.owner < 0 &&
                c.claimant === k.id &&
                c.progress > 0,
            ),
          ),
        ),
      ),
    };
    cache.set(w, entry);
  }
  ctx.save();
  if (w.terrainBoundaryVersion === 1) clipNaturalGround(ctx, w);
  else ctx.clip(entry.allowed);
  for (const k of w.kingdoms) {
    ctx.fillStyle = k.color;
    ctx.globalAlpha = opacity;
    ctx.fill(entry.owned[k.id], "evenodd");
    const claimed = w.cells.filter(
      (c) => !c.blocked && c.owner < 0 && c.claimant === k.id && c.progress > 0,
    );
    ctx.globalAlpha = claimed.length
      ? (opacity * 0.5 * claimed.reduce((sum, c) => sum + c.progress, 0)) /
        claimed.length
      : 0;
    ctx.fill(entry.pending[k.id], "evenodd");
  }
  ctx.restore();
}
