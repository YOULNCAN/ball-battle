import { WIDTH, HEIGHT, TILE, COLS, type World } from './sim';
import { terrainBlocked } from './maps';
export interface ArenaWall { radius: number; thickness: number; gateWidth: number }
export const ARENA_WALL: ArenaWall = { radius: 380, thickness: 24, gateWidth: 160 };
function arcs(w: World) {
  const wall = w.arenaWall;
  if (!wall) return [];
  const gap = Math.asin((wall.gateWidth / 2 + wall.thickness / 2) / wall.radius);
  return Array.from({length: 4}, (_, i) => [i * Math.PI / 2 + gap, (i + 1) * Math.PI / 2 - gap]);
}
export function wallDistance(w: World, x: number, y: number) {
  if (!w.arenaWall) return Infinity;
  const dx = Math.abs(x-WIDTH/2), dy = Math.abs(y-HEIGHT/2);
  const major=Math.max(dx,dy), minor=Math.min(dx,dy), r=w.arenaWall.radius;
  const tip=w.arenaWall.gateWidth/2+w.arenaWall.thickness/2;
  const along=Math.sqrt(r*r-tip*tip);
  return minor*along < major*tip
    ? Math.hypot(major-along,minor-tip)
    : Math.abs(Math.hypot(dx,dy)-r);
}
export function wallBlocked(w: World, x: number, y: number, r: number) {
  return !!w.arenaWall && wallDistance(w,x,y) < w.arenaWall.thickness / 2 + r;
}
export function wallHit(w: World, x: number, y: number, nx: number, ny: number): number {
  if (!w.arenaWall) return Infinity;
  if (wallBlocked(w,x,y,0)) return 0;
  const dx=nx-x, dy=ny-y, length=Math.hypot(dx,dy);
  // Signed distance is 1-Lipschitz: safe sphere tracing cannot skip thin walls or gate posts.
  let t=0;
  for (let i=0; i<128 && t<=1; i++) {
    const clearance=wallDistance(w,x+dx*t,y+dy*t)-w.arenaWall.thickness/2;
    if (clearance<0.00001) return t;
    if (!length || clearance > length*(1-t)) return Infinity;
    t += Math.max(0.000001, clearance/length);
  }
  return Infinity;
}
export function installArena(w: World) {
  w.arenaWall = w.settings.layout === 'arena' ? {...ARENA_WALL} : null;
  if (!w.arenaWall) return;
  // Clear a broad outer circulation route and four approaches, without opening the wall.
  for (let i=0;i<w.cells.length;i++) {
    const x=((i%COLS)+.5)*TILE, y=(Math.floor(i/COLS)+.5)*TILE;
    const dx=x-WIDTH/2, dy=y-HEIGHT/2, d=Math.hypot(dx,dy);
    const c=w.cells[i];
    if ((d>410 && d<650) || (d<650 && Math.min(Math.abs(dx),Math.abs(dy))<100)) {
      c.terrain='grass'; c.blocked=false;
    }
    if (Math.min(Math.abs(dx),Math.abs(dy)) > w.arenaWall.gateWidth/2 && Math.abs(d-w.arenaWall.radius) < w.arenaWall.thickness/2+TILE/2) {
      c.blocked=true; c.owner=-1; c.claimant=-1; c.progress=0;
    }
  }
  if (w.winner !== null) for (const c of w.cells) if (!c.blocked) {
    c.owner=w.winner; c.claimant=w.winner; c.progress=1;
  }
  w.obstacles=w.obstacles.filter(o => !wallBlocked(w,o.x,o.y,o.r+26) && !(Math.hypot(o.x-WIDTH/2,o.y-HEIGHT/2)>410 && Math.hypot(o.x-WIDTH/2,o.y-HEIGHT/2)<650));
  for (const b of w.balls) relocateArenaObject(w,b,b.r);
  for (const r of w.resources) {
    if (!terrainBlocked(w,r.x,r.y,9)) continue;
    relocateArenaObject(w,r,9);
  }
}
function relocateArenaObject(w: World, point: {x:number;y:number}, radius:number) {
  if (!terrainBlocked(w,point.x,point.y,radius)) return;
  let nearest=Infinity, position: {x:number;y:number} | undefined;
  // Choose the closest safe cell center, with row order breaking equal-distance ties.
  for (let i=0;i<w.cells.length;i++) {
    const x=((i%COLS)+.5)*TILE, y=(Math.floor(i/COLS)+.5)*TILE;
    const distance=(x-point.x)**2+(y-point.y)**2;
    if (distance>=nearest || terrainBlocked(w,x,y,radius) ||
        w.obstacles.some(o=>Math.hypot(x-o.x,y-o.y)<radius+o.r)) continue;
    nearest=distance; position={x,y};
  }
  if (!position) throw new Error('竞技场没有可用的安全位置，当前世界未被替换。');
  Object.assign(point,position);
}
export function drawArena(ctx: CanvasRenderingContext2D,w: World) {
  if (!w.arenaWall) return;
  ctx.strokeStyle='#7c8588'; ctx.lineWidth=w.arenaWall.thickness;
  ctx.lineCap='round';
  for (const [a,b] of arcs(w)) {
    ctx.beginPath(); ctx.arc(WIDTH/2,HEIGHT/2,w.arenaWall.radius,a,b); ctx.stroke();
  }
  ctx.strokeStyle='#bcc2be'; ctx.lineWidth=2;
  for (const [a,b] of arcs(w)) {
    ctx.beginPath(); ctx.arc(WIDTH/2,HEIGHT/2,w.arenaWall.radius-8,a,b); ctx.stroke();
    for(let t=a;t<b;t+=.065) {
      ctx.beginPath();ctx.moveTo(WIDTH/2+Math.cos(t)*368,HEIGHT/2+Math.sin(t)*368);
      ctx.lineTo(WIDTH/2+Math.cos(t)*392,HEIGHT/2+Math.sin(t)*392);ctx.stroke();
    }
  }
  ctx.lineCap='butt';
}
