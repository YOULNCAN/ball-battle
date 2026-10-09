import { describe,it,expect } from 'vitest';
import { createWorld,DEFAULTS,step,reward,collide,WIDTH,HEIGHT,conquer } from '../src/sim';
import { resolveRoyalDeaths,castleExplosion } from '../src/hazards';
import { wallBlocked,wallHit } from '../src/arena';
import { terrainBlocked,moveOnTerrain,connectedCastles,MAP_TYPES } from '../src/maps';
import { weaponCombat } from '../src/combat';
import { importSave } from '../src/storage';
function world(arena=false) {
 const w=createWorld({...DEFAULTS,kingdoms:2,perKingdom:10,map:'grassland',events:false,layout:arena?'arena':'normal'});
 w.obstacles=[];w.resources=[];
 for(const k of w.kingdoms) {k.resources=0;k.recruitProgress=0;}
 for(const b of w.balls) {b.hp=b.maxHp=112;b.king=false;b.nextAttack=1000;b.chargeUntil=0;b.vx=b.vy=0;b.x=400+b.id*30;b.y=400;}
 return w;
}
describe('level 10, paid healing and four arena entrances',()=>{
 it('chains max-level soldiers once, including a max-level king, with no castle damage or rewards',()=>{
  const w=world();const [a,b,c]=w.balls;
  Object.assign(a,{x:600,y:600,level:10,hp:0,king:true});
  Object.assign(b,{x:650,y:600,level:10,hp:40});
  Object.assign(c,{x:700,y:600,hp:200,maxHp:200});
  const castles=w.kingdoms.map(k=>k.hp);
  resolveRoyalDeaths(w);resolveRoyalDeaths(w);
  expect(w.blasts.map(x=>x.source)).toEqual([a.id,b.id]);expect(c.hp).toBe(40);
  expect(w.kingdoms.map(k=>k.hp)).toEqual(castles);expect(c.kills).toBe(0);
 });
 it('does not heal on the final upgrade or a max-level collision',()=>{
  const w=world();const [a,b]=w.balls;
  Object.assign(a,{level:9,xp:9*35-35,hp:40,skills:['吸血']});reward(w,a);
  expect(a.level).toBe(10);expect(a.hp).toBe(40);expect(a.maxHp).toBe(132);
  Object.assign(a,{x:800,y:800,chargeUntil:0,cooldown:0});Object.assign(b,{x:809,y:800,kingdom:1,cooldown:0});
  const noVamp=structuredClone(w);noVamp.balls[0].skills=noVamp.balls[0].skills.filter(s=>s!=="吸血");
  collide(w,a,b);collide(noVamp,noVamp.balls[0],noVamp.balls[1]);
  expect(a.hp).toBe(noVamp.balls[0].hp);
 });
 it('disables vampirism on an arrow fired before its source reached level 10',()=>{
  const w=world();const [a,b]=w.balls;
  Object.assign(a,{level:10,hp:50,x:800,y:800,skills:['吸血']});
  Object.assign(b,{kingdom:1,x:830,y:800});
  w.projectiles=[{id:w.nextId++,source:a.id,kingdom:a.kingdom,x:810,y:800,vx:550,vy:0,remaining:200,attack:8,heavy:false,vamp:true,weapon:'bow'}];
  weaponCombat(w,.1,[]);expect(a.hp).toBe(50);expect(b.hp).toBeLessThan(b.maxHp);
 });
 it.each([false,true])('heals a max-level king at own castle, including charge=%s',charge=>{
  const w=world(),b=w.balls[0],k=w.kingdoms[b.kingdom];
  Object.assign(b,{x:k.x+44,y:k.y,hp:100,level:10,king:true,chargeUntil:charge?3:0});k.resources=1.2;
  step(w);expect(b.hp).toBe(112);expect(k.resources).toBeCloseTo(0);
 });
 it('spends available fractional resources only and does not heal at an enemy castle',()=>{
  const w=world(),b=w.balls[0],k=w.kingdoms[b.kingdom];
  Object.assign(b,{x:k.x+44,y:k.y,hp:50});k.resources=.25;
  step(w);expect(b.hp).toBe(52.5);expect(k.resources).toBe(0);
  const enemy=w.kingdoms[1];Object.assign(b,{x:enemy.x+44,y:enemy.y,cooldown:100,hp:50});enemy.resources=100;
  step(w);expect(b.hp).toBe(50);expect(enemy.resources).toBe(100);
 });
 it('has four 160-wide gates; walls reflect balls and stop rays while gates pass them',()=>{
  const w=world(true),x=WIDTH/2,y=HEIGHT/2;
  for(let i=0;i<4;i++) {const t=i*Math.PI/2;expect(wallHit(w,x+Math.cos(t)*300,y+Math.sin(t)*300,x+Math.cos(t)*450,y+Math.sin(t)*450)).toBe(Infinity);}
  expect(wallBlocked(w,x+380,y+79,0)).toBe(false);
  expect(wallBlocked(w,x+Math.sqrt(380**2-92**2),y+81,0)).toBe(true);
  const t=Math.PI/4;expect(wallHit(w,x+Math.cos(t)*300,y+Math.sin(t)*300,x+Math.cos(t)*450,y+Math.sin(t)*450)).toBeLessThan(1);
  const b=w.balls[0];Object.assign(b,{x:x+Math.cos(t)*360,y:y+Math.sin(t)*360,vx:75,vy:75});
  moveOnTerrain(w,b,35,35);expect(b.vx<0 || b.vy<0).toBe(true);expect(terrainBlocked(w,b.x,b.y,b.r)).toBe(false);
 });
 it('blocks castle and ball explosions across the wall but not through a gate',()=>{
  const w=world(true),x=WIDTH/2,y=HEIGHT/2,t=Math.PI/4;
  const b=w.balls[0];Object.assign(b,{x:x+Math.cos(t)*420,y:y+Math.sin(t)*420});
  castleExplosion(w,x+Math.cos(t)*330,y+Math.sin(t)*330);expect(b.hp).toBe(112);
  Object.assign(b,{x:x+420,y});castleExplosion(w,x+330,y);expect(b.hp).toBe(32);
 });
 it('removes arrows at the wall before they hit a ball behind it',()=>{
  const w=world(true),x=WIDTH/2,y=HEIGHT/2,t=Math.PI/4;
  const [a,b]=w.balls;Object.assign(a,{x:x+Math.cos(t)*320,y:y+Math.sin(t)*320});
  Object.assign(b,{kingdom:1,x:x+Math.cos(t)*430,y:y+Math.sin(t)*430});
  w.projectiles=[{id:w.nextId++,source:a.id,kingdom:a.kingdom,x:a.x,y:a.y,vx:550*Math.cos(t),vy:550*Math.sin(t),remaining:250,attack:100,heavy:false,vamp:false,weapon:'bow'}];
  weaponCombat(w,.3,[]);expect(w.projectiles).toEqual([]);expect(b.hp).toBe(112);
 });
 it('keeps completed old arenas completed when newly accessible ground is repaired',()=>{
  const w=world(true);conquer(w,w.kingdoms[1],w.balls[0]);
  w.balls=w.balls.filter(b=>b.hp>0);
  for(const c of w.cells)if(!c.blocked)Object.assign(c,{owner:0,claimant:0,progress:1});
  w.winner=0;
  const raw=JSON.parse(JSON.stringify(w));raw.version=5;delete raw.arenaWall;
  const restored=importSave(JSON.stringify(raw));
  expect(restored.winner).toBe(0);expect(importSave(JSON.stringify(restored))).toEqual(restored);
 });
 it('migrates v5 arena deterministically without consuming RNG or resetting growth',()=>{
  const w=world(true),b=w.balls[0];Object.assign(b,{x:WIDTH/2+380/Math.sqrt(2),y:HEIGHT/2+380/Math.sqrt(2),level:10,hp:50,vx:12,vy:-32});
  const raw=JSON.parse(JSON.stringify(w));raw.version=5;delete raw.arenaWall;
  raw.resources.push({id:raw.nextId++,x:b.x,y:b.y,value:18});
  const a=importSave(JSON.stringify(raw)),copy=importSave(JSON.stringify(raw));
  expect(a).toEqual(copy);expect(a.rng).toBe(w.rng);expect(a.version).toBe(6);
  expect(a.balls[0]).toMatchObject({level:10,hp:50,vx:12,vy:-32});expect(terrainBlocked(a,a.balls[0].x,a.balls[0].y,a.balls[0].r)).toBe(false);
  expect(importSave(JSON.stringify(a))).toEqual(a);expect(a.blasts).toEqual([]);
  expect(a.resources[0].value).toBe(18);expect(terrainBlocked(a,a.resources[0].x,a.resources[0].y,9)).toBe(false);
  expect(()=>importSave(JSON.stringify({...a,arenaWall:{...a.arenaWall,gateWidth:500}}))).toThrow();
 });
 it('keeps all six biomes connected with both boundaries and seeded generation',()=>{
  for(const map of MAP_TYPES)for(const shape of ['rectangle','circle'] as const){
   const s={...DEFAULTS,kingdoms:8,perKingdom:8,map,shape,layout:'arena' as const};
   const w=createWorld(s);expect(connectedCastles(w),map+shape).toBe(true);expect(createWorld(s)).toEqual(w);
   expect(importSave(JSON.stringify(w))).toEqual(w);
  }
 });
});
