import { WIDTH, HEIGHT, type World } from "./sim";
import { insideBoundary } from "./maps";

export function castlePositions(
  w: World,
  rng: () => number,
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  const valid = (x: number, y: number) =>
    x >= 180 &&
    x <= WIDTH - 180 &&
    y >= 180 &&
    y <= HEIGHT - 180 &&
    insideBoundary(w, x, y, 180) &&
    (w.settings.layout === "normal" ||
      Math.hypot(x - WIDTH / 2, y - HEIGHT / 2) >=
        (w.settings.layout === "lake" ? 480 : 560)) &&
    positions.every((p) => Math.hypot(x - p.x, y - p.y) >= 480);
  for (let i = 0; i < w.settings.kingdoms; i++) {
    let placed = false;
    for (let n = 0; n < 512; n++) {
      const x = 180 + rng() * (WIDTH - 360),
        y = 180 + rng() * (HEIGHT - 360);
      if (valid(x, y)) {
        positions.push({ x, y });
        placed = true;
        break;
      }
    }
    if (!placed) {
      const candidates = [];
      for (let y = 180; y <= HEIGHT - 180; y += 120)
        for (let x = 180; x <= WIDTH - 180; x += 120)
          candidates.push({ x, y, order: rng() });
      candidates.sort((a, b) => a.order - b.order);
      const p = candidates.find((p) => valid(p.x, p.y));
      if (!p) throw new Error("城堡布局生成失败，请更换种子。");
      positions.push({ x: p.x, y: p.y });
    }
  }
  return positions;
}
