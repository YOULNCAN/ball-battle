import { chromium,expect } from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const url=process.env.ORB_URL||'http://127.0.0.1:5173/';
async function saved(){return page.evaluate(()=>new Promise((resolve,reject)=>{const q=indexedDB.open('ball-kingdom',1);q.onsuccess=()=>{const db=q.result,r=db.transaction('saves').objectStore('saves').get('manual');r.onsuccess=()=>{resolve(r.result.world);db.close();};r.onerror=reject;};}));}
try {
 await page.goto('http://127.0.0.1:5173/');
 const fixture=await page.evaluate(async()=>{
  const {createWorld,DEFAULTS,WIDTH,HEIGHT}=await import('/src/sim.ts');
  const w=createWorld({...DEFAULTS,seed:'arena-browser-v6',map:'grassland',layout:'arena',events:false,kingdoms:2,perKingdom:16});
  w.kingdoms.forEach(k=>{k.resources=0;k.recruitProgress=0;});
  const b=w.balls.find(b=>!b.king&&b.kingdom===0),k=w.kingdoms[0];
  Object.assign(b,{level:10,hp:50,vx:0,vy:0,x:k.x+44,y:k.y,chargeUntil:100,nextAttack:100});k.resources=.25;
  w.resources=[];w.version=5;delete w.arenaWall;
  return {w,id:b.id};
 });
 if(url!=='http://127.0.0.1:5173/')await page.goto(url);
 await page.locator('#file').setInputFiles({name:'arena-v5.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.w))});
 await expect(page.locator('#game')).toBeVisible();
 await expect(page.locator('#toast')).toContainText('升级');
 await page.locator('#single').click();await page.locator('#save').click();
 await expect(page.locator('#toast')).toContainText('手动存档已保存');
 const next=await saved();expect(next.version).toBe(7);expect(next.arenaWall).toEqual({radius:380,thickness:24,gateWidth:160});
 expect(next.balls.find(b=>b.id===fixture.id).hp).toBe(52.5);expect(next.kingdoms[0].resources).toBe(0);
 const text=JSON.stringify(next);await page.locator('#file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...next,arenaWall:{...next.arenaWall,gateWidth:500}}))});
 await expect(page.locator('#toast')).toContainText('损坏');
 await page.locator('#save').click();await expect(page.locator('#toast')).toContainText('手动存档已保存');expect(JSON.stringify(await saved())).toBe(text);
 await page.locator('#zoom-in').click();await page.locator('#zoom-out').click();
 await page.screenshot({path:'test-results/arena-v6-gameplay.png',fullPage:true});
 await page.reload();await page.locator('#continue').click();await page.getByRole('button',{name:/^手动存档/}).click();await expect(page.locator('#game')).toBeVisible();
 expect(errors).toEqual([]);console.log('Arena browser passed: v5 migration, paid level-10 healing, invalid import isolation, zoom and refresh/continue.');
 await fs.writeFile('test-results/arena-browser.json',JSON.stringify({url,passed:true,errors},null,2));
}finally{await browser.close();}
