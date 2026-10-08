import { type World, type Ball } from "./sim";
import { terrainAt } from "./maps";

// External movement effects are kept separate from the stored free velocity.
export function motionScale(w: World, b: Ball): number {
  const terrain = terrainAt(w, b.x, b.y);
  return (
    (terrain === "sand" ? 0.7 : terrain === "forest" ? 0.65 : 1) *
    (w.event.kind === "加速" && w.event.until > w.time ? 1.4 : 1) *
    (b.chargeUntil > w.time ? 2 : 1) *
    (b.skills.includes("加速") ? 5 / 3 : 1)
  );
}

export function elasticImpulse(
  w: World,
  a: Ball,
  b: Ball,
  nx: number,
  ny: number,
): number {
  const sa = motionScale(w, a),
    sb = motionScale(w, b);
  const approach = (a.vx * sa - b.vx * sb) * nx + (a.vy * sa - b.vy * sb) * ny;
  if (approach > 0) {
    const impulse = (2 * approach) / (a.mass + b.mass);
    a.vx -= (impulse * b.mass * nx) / sa;
    a.vy -= (impulse * b.mass * ny) / sa;
    b.vx += (impulse * a.mass * nx) / sb;
    b.vy += (impulse * a.mass * ny) / sb;
  }
  return Math.abs(approach);
}

export function physicsDelta(w: World, remaining: number): number {
  let dt = remaining;
  for (const b of w.balls) {
    if (b.hp <= 0) continue;
    const speed = Math.hypot(b.vx, b.vy) * motionScale(w, b);
    if (speed > 0) dt = Math.min(dt, b.r / speed);
  }
  return dt;
}
