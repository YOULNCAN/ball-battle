import { chromium,expect } from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5173/');
 const fixture=await page.evaluate(async()=>{
  const sim=await import('/src/sim.ts');
  const w=sim.createWorld({...sim.DEFAULTS,seed:'max-level-chain-2000',kingdoms:2,perKingdom:1000,map:'grassland',events:false,volume:0,musicVolume:0});
  w.obstacles=[];w.resources=[];w.kingdoms.forEach(k=>{k.resources=0;k.recruitProgress=0;});
  w.balls.forEach((b,i)=>Object.assign(b,{king:false,level:i?10:1,skills:[],hp:i?40:112,maxHp:112,vx:0,vy:0,chargeUntil:0,nextAttack:100,kingdom:i?1:0,x:i?700+((i-1)%50)*14:500,y:i?500+Math.floor((i-1)/50)*14:500}));
  w.projectiles=[{id:w.nextId++,source:w.balls[0].id,kingdom:0,x:685,y:500,vx:550,vy:0,remaining:250,attack:100,heavy:false,vamp:false,weapon:'bow'}];
  return w;
 });
 await page.locator('#file').setInputFiles({name:'chain-2000.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 await expect(page.locator('#game')).toBeVisible();
 const result=await page.evaluate(()=>{const start=performance.now();document.querySelector('#single').click();return {singleStepMS:performance.now()-start};});
 const diagnostics=await page.evaluate(()=>window.__orbDiagnostics);
 expect(diagnostics.population).toBe(1);expect(diagnostics.blasts).toBe(1999);
 await page.locator('#zoom-in').click();await page.locator('#zoom-out').click();await page.locator('#save').click();await expect(page.locator('#toast')).toContainText('手动存档已保存');
 await page.screenshot({path:'test-results/max-level-chain-2000.png',fullPage:true});
 expect(errors).toEqual([]);
 const report={...result,population:diagnostics.population,blasts:diagnostics.blasts,errors,passed:true};
 await fs.writeFile('test-results/max-level-chain-2000.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
