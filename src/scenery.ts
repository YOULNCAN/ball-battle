import { WIDTH, HEIGHT, seedHash, type World } from "./sim";
import { terrainAt, insideBoundary, terrainBlocked } from "./maps";
import { naturalMap } from "./natural";
interface Detail {
  x: number;
  y: number;
  size: number;
  kind: number;
  angle: number;
}
const cache = new WeakMap<World, Detail[]>();
const roadCache = new WeakMap<World, number[][]>();
function details(w: World) {
  const old = cache.get(w);
  if (old) return old;
  let state = seedHash(w.settings.seed + "-landscape-v1");
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const items: Detail[] = [];
  for (let i = 0; i < 850; i++) {
    const x = random() * WIDTH,
      y = random() * HEIGHT;
    if (
      !insideBoundary(w, x, y) ||
      w.kingdoms.some((k) => Math.hypot(x - k.x, y - k.y) < 90)
    )
      continue;
    items.push({
      x,
      y,
      size: 4 + random() * 10,
      kind: Math.floor(random() * 9),
      angle: random() * Math.PI * 2,
    });
  }
  for (const loop of naturalMap(w).regions.get("water")!)
    for (let i = 0; i < loop.length; i += 24) {
      const [x, y] = loop[i];
      if (insideBoundary(w, x, y))
        items.push({
          x,
          y,
          size: 3 + random() * 3,
          kind: 9,
          angle: random() * Math.PI * 2,
        });
    }
  cache.set(w, items);
  return items;
}
export function drawScenery(
  ctx: CanvasRenderingContext2D,
  w: World,
  zoom: number,
  visible: (x: number, y: number, r?: number) => boolean,
) {
  ctx.save();
  // Faded roads follow existing traversable ground; they never create crossings over water.
  ctx.strokeStyle = "#d5bd8130";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  let roads = roadCache.get(w);
  if (!roads) {
    roads = [];
    for (let i = 0; i < w.kingdoms.length; i++) {
      const a = w.kingdoms[i],
        b = w.kingdoms[(i + 1) % w.kingdoms.length];
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 45);
      for (let j = 0; j < n; j++) {
        const x = a.x + ((b.x - a.x) * j) / n,
          y = a.y + ((b.y - a.y) * j) / n,
          nx = a.x + ((b.x - a.x) * (j + 1)) / n,
          ny = a.y + ((b.y - a.y) * (j + 1)) / n;
        if (!terrainBlocked(w, (x + nx) / 2, (y + ny) / 2, 12))
          roads.push([x, y, nx, ny]);
      }
    }
    roadCache.set(w, roads);
  }
  for (const [x, y, nx, ny] of roads)
    if (visible(x, y, 50)) {
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
    }
  ctx.stroke();
  let count = 0;
  for (const [i, d] of details(w).entries()) {
    if (
      !visible(d.x, d.y, 30) ||
      (zoom < 0.4 && i % 3) ||
      (w.settings.quality === "low" && i % 2)
    )
      continue;
    if (++count > 400) break;
    const t = terrainAt(w, d.x, d.y),
      s = d.size;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);
    ctx.lineWidth = 1.5;
    if (d.kind === 9) {
      ctx.fillStyle = "#a8b7b06a";
      ctx.beginPath();
      ctx.ellipse(0, 0, s, s * 0.6, 0, 0, 7);
      ctx.fill();
    } else if (t === "water" || t === "ice") {
      ctx.strokeStyle = t === "water" ? "#8ebac12c" : "#d3edec48";
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(0, -s / 2, s, 0);
      ctx.stroke();
      if (t === "ice" && zoom > 0.5) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(s * 0.3, s);
        ctx.stroke();
      }
    } else if (t === "mountain") {
      ctx.strokeStyle = "#a4ad9d55";
      ctx.beginPath();
      ctx.moveTo(-s, s / 2);
      ctx.lineTo(0, -s);
      ctx.lineTo(s, s / 2);
      ctx.stroke();
    } else if (t === "sand") {
      ctx.strokeStyle = "#e6c99240";
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(0, -s, s, 0);
      ctx.moveTo(-s, s / 2);
      ctx.quadraticCurveTo(0, -s / 2, s, s / 2);
      ctx.stroke();
    } else if (t === "forest") {
      ctx.fillStyle = "#52795850";
      ctx.beginPath();
      ctx.ellipse(0, 0, s, s * 0.65, 0, 0, 7);
      ctx.fill();
      if (zoom > 0.55) {
        ctx.strokeStyle = "#66857070";
        ctx.beginPath();
        ctx.moveTo(-s, 0);
        ctx.lineTo(s, 0);
        ctx.stroke();
      }
    } else if (t !== "bridge" && d.kind === 0 && zoom > 0.4) {
      // Low stone foundations are decorative ruins, without an obstacle collision body.
      ctx.strokeStyle = "#b8b5a060";
      ctx.lineWidth = 3;
      ctx.strokeRect(-s, -s, s * 2, s);
      ctx.strokeRect(-s * 0.5, -s * 0.5, s, s);
    } else if (t !== "bridge") {
      ctx.strokeStyle = w.mapType === "snow" ? "#c4dce44a" : "#83a65d50";
      ctx.beginPath();
      ctx.moveTo(-s / 2, 0);
      ctx.lineTo(0, -s);
      ctx.moveTo(0, 0);
      ctx.lineTo(s / 2, -s * 0.7);
      ctx.stroke();
      if (d.kind < 3 && w.mapType === "grassland" && zoom > 0.5) {
        ctx.fillStyle = d.kind ? "#e4c77d80" : "#d9a4bc80";
        ctx.beginPath();
        ctx.arc(0, -s, 2.5, 0, 7);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}
