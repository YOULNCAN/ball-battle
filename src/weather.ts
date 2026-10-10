import {
  WIDTH,
  HEIGHT,
  COLS,
  TILE,
  type World,
  random,
  seedHash,
  log,
} from "./sim";
import { insideBoundary, terrainBlocked } from "./maps";
import { mountainBlocked, resolveRoyalDeaths } from "./hazards";
export interface WeatherZone {
  x: number;
  y: number;
  radius: number;
  born: number;
  until: number;
}
export interface ThunderZone extends WeatherZone {
  nextWarning: number;
  warnings: number;
}
export interface Strike {
  x: number;
  y: number;
  warned: number;
  at: number;
}
export interface Weather {
  nextRain: number;
  nextStorm: number;
  rain: WeatherZone | null;
  storm: ThunderZone | null;
  strikes: Strike[];
}
export function initialWeather(seed: string, time: number): Weather {
  return {
    nextRain: time + 45 + (seedHash(seed + "-rain") / 0xffffffff) * 30,
    nextStorm: time + 45 + (seedHash(seed + "-thunder") / 0xffffffff) * 30,
    rain: null,
    storm: null,
    strikes: [],
  };
}
export function raining(w: World, x: number, y: number) {
  const r = w.weather.rain;
  return !!r && r.until > w.time && Math.hypot(x - r.x, y - r.y) <= r.radius;
}
export function clearWeather(w: World) {
  w.weather.rain = null;
  w.weather.storm = null;
  w.weather.strikes = [];
}
function ground(w: World, zone?: WeatherZone): { x: number; y: number } | null {
  const safe = (x: number, y: number) =>
    x > 3 &&
    y > 3 &&
    x < WIDTH - 3 &&
    y < HEIGHT - 3 &&
    insideBoundary(w, x, y, 3) &&
    !terrainBlocked(w, x, y, 3) &&
    w.obstacles.every((o) => Math.hypot(x - o.x, y - o.y) > o.r + 3);
  for (let i = 0; i < 80; i++) {
    const a = random(w) * Math.PI * 2,
      d = zone ? Math.sqrt(random(w)) * zone.radius : 0;
    const x = zone ? zone.x + Math.cos(a) * d : 3 + random(w) * (WIDTH - 6),
      y = zone ? zone.y + Math.sin(a) * d : 3 + random(w) * (HEIGHT - 6);
    if (safe(x, y)) return { x, y };
  }
  const candidates = w.cells
    .map((_, i) => ({
      x: ((i % COLS) + 0.5) * TILE,
      y: (Math.floor(i / COLS) + 0.5) * TILE,
    }))
    .filter(
      (p) =>
        (!zone || Math.hypot(p.x - zone.x, p.y - zone.y) <= zone.radius) &&
        safe(p.x, p.y),
    );
  return candidates.length
    ? candidates[Math.floor(random(w) * candidates.length)]
    : null;
}
export function lightning(w: World, x: number, y: number) {
  w.blasts.push({
    x,
    y,
    radius: 150,
    born: w.time,
    source: null,
    lightning: true,
  });
  for (const b of w.balls)
    if (
      b.hp > 0 &&
      Math.hypot(b.x - x, b.y - y) <= 150 + b.r &&
      !mountainBlocked(w, x, y, b.x, b.y)
    ) {
      b.hp = raining(w, b.x, b.y) ? 0 : b.hp - 80;
    }
  resolveRoyalDeaths(w);
}
export function advanceWeather(w: World) {
  const weather = w.weather;
  if (!w.settings.events) {
    clearWeather(w);
    weather.nextRain = Math.max(weather.nextRain, w.time + 45);
    weather.nextStorm = Math.max(weather.nextStorm, w.time + 60);
    return;
  }
  if (weather.rain && weather.rain.until <= w.time) weather.rain = null;
  if (w.time >= weather.nextRain) {
    const p = ground(w);
    if (p)
      weather.rain = { ...p, radius: 450, born: w.time, until: w.time + 15 };
    weather.nextRain = w.time + 45 + random(w) * 30;
    log(w, "局部暴雨：雨区内速度降低至60%，遭雷击的球必死。");
  }
  if (w.time >= weather.nextStorm) {
    const p = ground(w);
    if (p)
      weather.storm = {
        ...p,
        radius: 450,
        born: w.time,
        until: w.time + 12,
        nextWarning: w.time + 1,
        warnings: 0,
      };
    weather.nextStorm = w.time + 45 + random(w) * 30;
    log(w, "局部雷暴：随机地面每2秒落雷，提前1秒预警。");
  }
  const storm = weather.storm;
  if (storm)
    while (storm.warnings < 6 && storm.nextWarning <= w.time + 1e-10) {
      const p = ground(w, storm);
      if (p)
        weather.strikes.push({
          ...p,
          warned: storm.nextWarning,
          at: storm.nextWarning + 1,
        });
      storm.warnings++;
      storm.nextWarning += 2;
    }
  const pending: Strike[] = [];
  for (const strike of weather.strikes)
    if (strike.at <= w.time + 1e-10) lightning(w, strike.x, strike.y);
    else pending.push(strike);
  weather.strikes = pending;
  if (storm && storm.until <= w.time) weather.storm = null;
}
export function drawWeather(
  ctx: CanvasRenderingContext2D,
  w: World,
  zoom: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WIDTH, HEIGHT);
  ctx.clip();
  for (const [zone, color, label] of [
    [w.weather.rain, "#74c5df", "暴雨 · 60%速度"],
    [w.weather.storm, "#c7b2ff", "雷暴 · 注意预警"],
  ] as const) {
    if (!zone) continue;
    const fade = ctx.createRadialGradient(
      zone.x,
      zone.y,
      0,
      zone.x,
      zone.y,
      zone.radius,
    );
    fade.addColorStop(0, color + "25");
    fade.addColorStop(1, color + "00");
    ctx.fillStyle = fade;
    ctx.beginPath();
    ctx.arc(zone.x, zone.y, zone.radius, 0, 7);
    ctx.fill();
    ctx.strokeStyle = color + "65";
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([12 / zoom, 10 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = `${12 / zoom}px sans-serif`;
    ctx.fillText(
      label,
      zone.x - zone.radius * 0.5,
      zone.y - zone.radius * (zone === w.weather.storm ? 0.9 : 0.75),
    );
  }
  const rain = w.weather.rain;
  if (rain) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(rain.x, rain.y, rain.radius, 0, 7);
    ctx.clip();
    ctx.strokeStyle = "#b5def875";
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    const count = w.settings.quality === "low" ? 60 : 180;
    for (let i = 0; i < count; i++) {
      const x = rain.x - 450 + ((i * 173.13 + w.time * 65) % 900),
        y = rain.y - 450 + ((i * 97.73 + w.time * 330) % 900);
      ctx.moveTo(x, y);
      ctx.lineTo(x - 8, y + 22);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (const s of w.weather.strikes) {
    ctx.strokeStyle = "#fff1a7";
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 150, 0, 7);
    ctx.stroke();
    ctx.fillStyle = "#fff1a733";
    ctx.fill();
    ctx.fillStyle = "#fff1a7";
    ctx.font = `${18 / zoom}px sans-serif`;
    ctx.fillText("⚡", s.x - 8 / zoom, s.y);
  }
  for (const b of w.blasts)
    if (b.lightning && w.time - b.born < 0.3) {
      ctx.strokeStyle = "#f0eaff";
      ctx.lineWidth = 4 / zoom;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - 200);
      ctx.lineTo(b.x + 20, b.y - 115);
      ctx.lineTo(b.x - 16, b.y - 70);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  ctx.restore();
}
