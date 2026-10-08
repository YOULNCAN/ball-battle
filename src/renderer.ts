import { drawTerritory } from "./territory";
import {
  WIDTH,
  HEIGHT,
  TILE,
  COLS,
  ROWS,
  type World,
  type Effect,
} from "./sim";
import { TERRAIN_COLORS, CIRCLE_RADIUS } from "./maps";
import { WEAPONS, type Weapon } from "./weapons";
interface Particle extends Effect {
  age: number;
}
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  camera = { x: WIDTH / 2, y: HEIGHT / 2, zoom: 0.3 };
  width = 1;
  height = 1;
  particles: Particle[] = [];
  selected: number | null = null;
  fps = 60;
  private fpsSince = performance.now();
  private frames = 0;
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly minimap: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fit() {
    this.fpsSince = performance.now();
    this.frames = 0;
    this.camera.x = WIDTH / 2;
    this.camera.y = HEIGHT / 2;
    this.camera.zoom = Math.min(
      this.width / (WIDTH + 200),
      this.height / (HEIGHT + 200),
    );
  }
  toWorld(x: number, y: number) {
    return {
      x: (x - this.width / 2) / this.camera.zoom + this.camera.x,
      y: (y - this.height / 2) / this.camera.zoom + this.camera.y,
    };
  }
  zoomAt(factor: number, x = this.width / 2, y = this.height / 2) {
    const before = this.toWorld(x, y);
    this.camera.zoom = Math.max(0.12, Math.min(3, this.camera.zoom * factor));
    const after = this.toWorld(x, y);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.clampCamera();
  }
  clampCamera() {
    this.camera.x = Math.max(0, Math.min(WIDTH, this.camera.x));
    this.camera.y = Math.max(0, Math.min(HEIGHT, this.camera.y));
  }
  add(effects: Effect[]) {
    this.particles.push(...effects.map((e) => ({ ...e, age: 0 })));
    if (this.particles.length > 220)
      this.particles.splice(0, this.particles.length - 220);
  }
  draw(w: World, running: boolean, dt: number) {
    const now = performance.now();
    this.frames++;
    if (now - this.fpsSince >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsSince);
      this.frames = 0;
      this.fpsSince = now;
    }
    const ctx = this.ctx,
      z = this.camera.zoom;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#121d23";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(z, z);
    ctx.translate(-this.camera.x, -this.camera.y);
    const left = this.camera.x - this.width / (2 * z),
      top = this.camera.y - this.height / (2 * z),
      right = left + this.width / z,
      bottom = top + this.height / z;
    const visible = (x: number, y: number, r = 30) =>
      x + r > left && x - r < right && y + r > top && y - r < bottom;
    ctx.fillStyle = "#1d2c32";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    for (
      let y = Math.max(0, Math.floor(top / TILE));
      y < Math.min(ROWS, Math.ceil(bottom / TILE));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(left / TILE));
        x < Math.min(COLS, Math.ceil(right / TILE));
        x++
      ) {
        const c = w.cells[x + y * COLS];
        ctx.globalAlpha = 1;
        ctx.fillStyle = TERRAIN_COLORS[c.terrain];
        // Overlap subpixel edges so zooming cannot reveal a false territory grid.
        ctx.fillRect(x * TILE, y * TILE, TILE + 0.5 / z, TILE + 0.5 / z);
        if (c.terrain === "bridge") {
          ctx.strokeStyle = "#c8ae7260";
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let n = 12; n < TILE; n += 16) {
            ctx.moveTo(x * TILE + n, y * TILE + 8);
            ctx.lineTo(x * TILE + n, (y + 1) * TILE - 8);
          }
          ctx.stroke();
        } else if (c.terrain === "mountain") {
          ctx.fillStyle = "#63707755";
          ctx.beginPath();
          ctx.moveTo(x * TILE + 10, (y + 1) * TILE - 10);
          ctx.lineTo(x * TILE + 60, y * TILE + 16);
          ctx.lineTo((x + 1) * TILE - 12, (y + 1) * TILE - 10);
          ctx.fill();
        } else if (
          c.terrain === "water" ||
          c.terrain === "ice" ||
          c.terrain === "sand"
        ) {
          ctx.strokeStyle = c.terrain === "ice" ? "#c0e8ee25" : "#ebdba619";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x * TILE + 22, y * TILE + 45);
          ctx.quadraticCurveTo(
            x * TILE + 58,
            y * TILE + 30,
            x * TILE + 95,
            y * TILE + 45,
          );
          ctx.stroke();
        }
      }
    ctx.globalAlpha = 1;
    drawTerritory(ctx, w);
    ctx.strokeStyle = "#687f7b";
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(0, 0, WIDTH, HEIGHT);
    for (const o of w.obstacles)
      if (visible(o.x, o.y, o.r)) {
        if (w.mapType === "forest") {
          ctx.fillStyle = "#594a35";
          ctx.fillRect(o.x - 6, o.y, 12, o.r);
          ctx.fillStyle = "#3d684b";
          ctx.strokeStyle = "#6f906b";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(o.x, o.y, o.r, 0, 7);
          ctx.fill();
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = "#33444a";
        ctx.strokeStyle = "#526369";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x + o.r, o.y);
        for (let i = 1; i <= 7; i++) {
          const a = (i * Math.PI * 2) / 7;
          ctx.lineTo(o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r * 0.9);
        }
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#708078";
        ctx.beginPath();
        ctx.arc(o.x - o.r * 0.2, o.y - o.r * 0.2, o.r * 0.23, 0, 7);
        ctx.fill();
      }
    ctx.fillStyle = "#e5cf7a";
    for (const r of w.resources)
      if (visible(r.x, r.y, 8)) {
        const size = Math.min(8, 3 + Math.log2(r.value) * 0.5);
        ctx.beginPath();
        ctx.moveTo(r.x, r.y - size);
        ctx.lineTo(r.x + size, r.y);
        ctx.lineTo(r.x, r.y + size);
        ctx.lineTo(r.x - size, r.y);
        ctx.closePath();
        ctx.fill();
      }
    for (const k of w.kingdoms)
      if (k.alive && visible(k.x, k.y, 120)) {
        ctx.save();
        ctx.translate(k.x, k.y);
        const fine = z > 0.55 && w.settings.quality === "high";
        ctx.fillStyle = "#101a20aa";
        ctx.fillRect(-27, -24, 58, 57);
        ctx.fillStyle = "#717b7e";
        ctx.fillRect(-26, -26, 52, 52);
        ctx.strokeStyle = "#b1bab5";
        ctx.lineWidth = 2;
        ctx.strokeRect(-25, -25, 50, 50);
        ctx.fillStyle = "#353f42";
        ctx.fillRect(-17, -17, 34, 34);
        ctx.fillStyle = "#89938f";
        ctx.fillRect(-10, -12, 20, 22);
        ctx.fillStyle = "#4c5558";
        ctx.fillRect(-5, -7, 10, 12);
        for (const x of [-22, 22])
          for (const y of [-22, 22]) {
            ctx.fillStyle = "#a2aba5";
            ctx.fillRect(x - 6, y - 6, 12, 12);
            ctx.strokeStyle = "#47535a";
            ctx.strokeRect(x - 6, y - 6, 12, 12);
            ctx.fillStyle = "#637075";
            ctx.fillRect(x - 3, y - 3, 6, 6);
          }
        ctx.fillStyle = "#19272c";
        ctx.fillRect(-6, 16, 12, 12);
        ctx.fillStyle = "#89724c";
        ctx.fillRect(-5, 26, 10, 6);
        if (fine) {
          ctx.strokeStyle = "#4b595d";
          ctx.lineWidth = 1;
          for (let x = -14; x <= 14; x += 7) {
            ctx.strokeRect(x, -25, 5, 5);
            ctx.strokeRect(x, 20, 5, 5);
            ctx.strokeRect(-25, x, 5, 5);
            ctx.strokeRect(20, x, 5, 5);
          }
          ctx.strokeStyle = "#b1bab566";
          for (let y = -10; y <= 7; y += 6) {
            ctx.beginPath();
            ctx.moveTo(-9, y);
            ctx.lineTo(9, y);
            ctx.stroke();
          }
          ctx.strokeStyle = "#aa9470";
          for (const x of [-3, 0, 3]) {
            ctx.beginPath();
            ctx.moveTo(x, 18);
            ctx.lineTo(x, 26);
            ctx.stroke();
          }
        }
        ctx.strokeStyle = "#ddcfab";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(7, -10);
        ctx.lineTo(7, -42);
        ctx.stroke();
        ctx.fillStyle = k.color;
        ctx.beginPath();
        ctx.moveTo(8, -42);
        ctx.lineTo(25, -38);
        ctx.lineTo(21, -30);
        ctx.lineTo(8, -33);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#102029";
        ctx.fillRect(-42, 53, 84, 6);
        ctx.fillStyle = k.color;
        ctx.fillRect(-42, 53, (84 * k.hp) / k.maxHp, 6);
        ctx.font = "500 20px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(k.name, 0, -59);
        ctx.restore();
      }
    for (const f of w.fires)
      if (w.time >= f.born + 0.8 && visible(f.x, f.y, 130)) {
        const fade = Math.min(1, (f.until - w.time) / 3);
        ctx.globalAlpha = 0.12 * fade;
        ctx.fillStyle = "#e96422";
        ctx.beginPath();
        ctx.arc(f.x, f.y, 110, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.85 * fade;
        ctx.strokeStyle = "#ff9c37";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 110, 0, Math.PI * 2);
        ctx.stroke();
        const count = w.settings.quality === "high" ? 24 : 12;
        for (let i = 0; i < count; i++) {
          const a = (i * Math.PI * 2) / count,
            pulse = Math.sin(w.time * 9 + i * 2) * 3;
          ctx.fillStyle = i % 2 ? "#ffc76a" : "#f06a25";
          ctx.beginPath();
          ctx.ellipse(
            f.x + Math.cos(a) * 110,
            f.y + Math.sin(a) * 110 - 5 - pulse,
            4,
            9 + pulse,
            a,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    for (const b of w.blasts)
      if (visible(b.x, b.y, b.radius)) {
        const age = Math.min(1, (w.time - b.born) / 0.8);
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = "#ffdf91";
        ctx.beginPath();
        ctx.arc(b.x, b.y, Math.max(2, b.radius * age), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ff8545";
        ctx.lineWidth = 8 * (1 - age) + 1;
        ctx.stroke();
        if (w.settings.quality === "high")
          for (let i = 0; i < 12; i++) {
            const a = (i * Math.PI) / 6;
            ctx.fillStyle = "#dcc5a3";
            ctx.fillRect(
              b.x + Math.cos(a) * b.radius * age - 2,
              b.y + Math.sin(a) * b.radius * age - 2,
              4,
              4,
            );
          }
      }
    ctx.globalAlpha = 1;
    const detail = z > 0.55 && w.settings.quality === "high";
    for (const p of w.projectiles)
      if (visible(p.x, p.y, 15)) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.strokeStyle = w.kingdoms[p.kingdom].color;
        ctx.lineWidth = Math.max(1.5, 0.8 / z);
        ctx.beginPath();
        ctx.moveTo(-13, 0);
        ctx.lineTo(7, 0);
        ctx.lineTo(2, -4);
        ctx.moveTo(7, 0);
        ctx.lineTo(2, 4);
        ctx.stroke();
        ctx.restore();
      }
    for (const b of w.balls)
      if (visible(b.x, b.y, b.r + 20)) {
        const color = w.kingdoms[b.kingdom].color;
        if (b.chargeUntil > w.time) {
          ctx.strokeStyle = color + "90";
          ctx.lineWidth = Math.max(2, b.r * 0.6);
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - b.vx * 0.22, b.y - b.vy * 0.22);
          ctx.stroke();
        }
        if (detail && b.attackUntil > w.time && !WEAPONS[b.weapon].projectile) {
          const spec = WEAPONS[b.weapon];
          ctx.strokeStyle = color + "77";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(
            b.x,
            b.y,
            b.r + spec.range,
            b.attackAngle - (spec.arc || 0.6) / 2,
            b.attackAngle + (spec.arc || 0.6) / 2,
          );
          ctx.stroke();
        }
        if (b.id === this.selected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2 / z;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 6 / z, 0, 7);
          ctx.stroke();
        }
        if (detail && b.skills.includes("护盾")) {
          ctx.strokeStyle = color + "80";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 4, 0, 7);
          ctx.stroke();
        }
        if (b.king && b.warCryUntil > w.time) {
          ctx.strokeStyle = "#ffe09a";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 8 + Math.sin(w.time * 8) * 2, 0, 7);
          ctx.stroke();
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, Math.max(b.r, 1.25 / z), 0, 7);
        ctx.fill();
        if (detail || b.king) {
          ctx.fillStyle = "#243037";
          ctx.beginPath();
          ctx.arc(b.x - b.r * 0.27, b.y - b.r * 0.15, b.r * 0.11, 0, 7);
          ctx.arc(b.x + b.r * 0.27, b.y - b.r * 0.15, b.r * 0.11, 0, 7);
          ctx.fill();
          ctx.strokeStyle = "#243037";
          ctx.lineWidth = Math.max(1, b.r * 0.09);
          ctx.beginPath();
          ctx.arc(b.x, b.y + b.r * 0.05, b.r * 0.32, 0.15, Math.PI - 0.15);
          ctx.stroke();
          if (b.skills.includes("重击")) {
            ctx.fillStyle = "#fff6";
            ctx.fillRect(b.x - 2, b.y - b.r, 4, 3);
          }
          if (b.skills.includes("吸血")) {
            ctx.fillStyle = "#da5970";
            ctx.beginPath();
            ctx.arc(b.x + b.r * 0.5, b.y + b.r * 0.35, 2, 0, 7);
            ctx.fill();
          }
          if (b.skills.includes("加速")) {
            ctx.strokeStyle = color + "88";
            ctx.beginPath();
            ctx.moveTo(b.x - b.vx * 0.07, b.y - b.vy * 0.07);
            ctx.lineTo(b.x - b.vx * 0.13, b.y - b.vy * 0.13);
            ctx.stroke();
          }
        }
        if (b.king) {
          ctx.fillStyle = "#ffe19a";
          const x = b.x,
            y = b.y - b.r - 2,
            size = Math.max(8, 4 / z);
          ctx.beginPath();
          ctx.moveTo(x - size, y);
          ctx.lineTo(x - size, y - size);
          ctx.lineTo(x - size / 2, y - size / 2);
          ctx.lineTo(x, y - size * 1.3);
          ctx.lineTo(x + size / 2, y - size / 2);
          ctx.lineTo(x + size, y - size);
          ctx.lineTo(x + size, y);
          ctx.closePath();
          ctx.fill();
        }
        if ((detail || b.king || b.id === this.selected) && b.hp < b.maxHp) {
          ctx.fillStyle = "#101920";
          ctx.fillRect(b.x - b.r, b.y + b.r + 4, b.r * 2, 3 / z);
          ctx.fillStyle = b.hp / b.maxHp > 0.3 ? "#b4d6aa" : "#ee8490";
          ctx.fillRect(
            b.x - b.r,
            b.y + b.r + 4,
            (b.r * 2 * b.hp) / b.maxHp,
            3 / z,
          );
        }
        if (detail || b.id === this.selected) {
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(
            b.attackUntil > w.time ? b.attackAngle : Math.atan2(b.vy, b.vx),
          );
          this.drawWeapon(b.weapon, b.r);
          ctx.restore();
        }
      }
    for (const p of this.particles) {
      if (running) p.age += dt;
      if (!visible(p.x, p.y)) continue;
      ctx.globalAlpha = Math.max(0, 1 - p.age / 0.65);
      ctx.fillStyle = p.color;
      if (detail) {
        ctx.font = "bold 15px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(p.text, p.x, p.y - p.age * 40 - 12);
      }
      if (w.settings.quality === "high") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5 / z;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.kind === "death" ? 12 : 4) + p.age * 25, 0, 7);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.age < 0.65);
    if (w.settings.layout === "arena") {
      ctx.strokeStyle = "#c7ad7180";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(WIDTH / 2, HEIGHT / 2, 340, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (w.settings.shape === "circle") {
      // A single outer mask avoids applying an antialiased circular clip to every ball and effect.
      ctx.fillStyle = "#1d2c32";
      ctx.beginPath();
      ctx.rect(0, 0, WIDTH, HEIGHT);
      ctx.arc(WIDTH / 2, HEIGHT / 2, CIRCLE_RADIUS, 0, Math.PI * 2);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#e0be7480";
      ctx.lineWidth = 4 / z;
      ctx.beginPath();
      ctx.arc(WIDTH / 2, HEIGHT / 2, CIRCLE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    this.drawMinimap(w);
  }
  drawMinimap(w: World) {
    const ctx = this.minimap.getContext("2d")!,
      width = this.minimap.width,
      height = this.minimap.height;
    const sx = width / WIDTH,
      sy = height / HEIGHT;
    ctx.fillStyle = "#142128";
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    for (let i = 0; i < w.cells.length; i++) {
      const c = w.cells[i];
      ctx.globalAlpha = 1;
      ctx.fillStyle = TERRAIN_COLORS[c.terrain];
      ctx.fillRect(
        (i % COLS) * TILE * sx,
        Math.floor(i / COLS) * TILE * sy,
        TILE * sx + 1,
        TILE * sy + 1,
      );
    }
    ctx.save();
    ctx.scale(sx, sy);
    drawTerritory(ctx, w, 0.55);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.restore();
    if (w.settings.shape === "circle") {
      ctx.fillStyle = "#142128";
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.ellipse(
        (WIDTH / 2) * sx,
        (HEIGHT / 2) * sy,
        CIRCLE_RADIUS * sx,
        CIRCLE_RADIUS * sy,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill("evenodd");
    }
    for (const k of w.kingdoms)
      if (k.alive) {
        ctx.fillStyle = k.color;
        ctx.fillRect(k.x * sx - 3, k.y * sy - 3, 6, 6);
      }
    ctx.strokeStyle = "#eef3ecaa";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      (this.camera.x - this.width / (2 * this.camera.zoom)) * sx,
      (this.camera.y - this.height / (2 * this.camera.zoom)) * sy,
      (this.width / this.camera.zoom) * sx,
      (this.height / this.camera.zoom) * sy,
    );
  }
  private drawWeapon(weapon: Weapon, r: number) {
    const c = this.ctx,
      spec = WEAPONS[weapon];
    c.strokeStyle = "#ede4c5";
    c.fillStyle = "#a6b8be";
    c.lineWidth = 2;
    if (weapon === "shield") {
      c.beginPath();
      c.ellipse(r + 2, 0, 4, r * 0.75, 0, 0, 7);
      c.fill();
      c.stroke();
      return;
    }
    if (weapon === "bow") {
      c.beginPath();
      c.arc(r, 0, 9, -1.1, 1.1);
      c.stroke();
      c.strokeStyle = "#c39b67";
      c.moveTo(r + 4, -8);
      c.lineTo(r + 4, 8);
      c.stroke();
      return;
    }
    const length = weapon === "spear" || weapon === "halberd" ? 24 : 15;
    c.strokeStyle = "#b98f59";
    c.beginPath();
    c.moveTo(r - 2, 4);
    c.lineTo(r + length, 4);
    c.stroke();
    c.strokeStyle = "#e0e2d4";
    if (weapon === "axe" || weapon === "hammer") {
      c.fillRect(r + length - 6, -3, 8, weapon === "axe" ? 12 : 9);
    } else if (weapon === "crossbow") {
      c.beginPath();
      c.moveTo(r + 7, -7);
      c.lineTo(r + 7, 12);
      c.stroke();
    } else {
      c.beginPath();
      c.moveTo(r + length, 4);
      c.lineTo(r + length - 6, 0);
      c.lineTo(r + length - 6, 8);
      c.closePath();
      c.fill();
    }
    if (spec.arc > 0 && weapon === "halberd")
      c.fillRect(r + length - 6, -2, 4, 12);
  }
}
