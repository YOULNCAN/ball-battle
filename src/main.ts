import "./style.css";
import {
  createWorld,
  DEFAULTS,
  HEIGHT,
  WIDTH,
  STEP,
  step,
  territories,
  production,
  type Settings,
  type World,
} from "./sim";
import {
  importSave,
  loadSaves,
  saveWorld,
  validateWorld,
  type Slot,
  type Save,
} from "./storage";
import { Renderer } from "./renderer";
import {
  MAP_TYPES,
  MAP_NAMES,
  MAP_HINTS,
  type MapType,
  SHAPE_NAMES,
  LAYOUT_NAMES,
} from "./maps";
import {
  WEAPONS,
  WEAPON_TYPES,
  TROOP_NAMES,
  troopCounts,
  balancedArmy,
} from "./weapons";
import { MusicEngine, TRACK_NAMES } from "./music";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
function troopSummary(w: World, kingdom: number) {
  const counts = troopCounts(w.balls.filter((b) => b.kingdom === kingdom));
  return WEAPON_TYPES.map(
    (weapon) =>
      `<span title="${TROOP_NAMES[weapon]}">${WEAPONS[weapon].icon} ${TROOP_NAMES[weapon]} ${counts[weapon]}</span>`,
  ).join("");
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function clock(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
let world: World | null = null,
  paused = false,
  speed = 1,
  screen: "menu" | "game" = "menu";
let accumulator = 0,
  last = performance.now(),
  lastUI = 0,
  lastAuto = performance.now(),
  saving = false,
  resultShown = false;
let perfStart = performance.now(),
  simStart = 0,
  actualSpeed = 0;
let audio: AudioContext | null = null,
  lastSound = 0;
let selectedKingdom: number | null = null,
  slots: Save[] = [];
const app = $("#app");
app.innerHTML = `
  <header class="topbar"><a class="brand" href="#" aria-label="返回主菜单"><span class="brand-orb">♛</span><span>Ball Battle<small>球球王国 · YOULNCAN</small></span></a><span class="edition">自动战争模拟 <span>／</span> VOL. 01</span><button id="help" class="quiet">玩法指南 ↗</button></header>
  <main id="menu" class="menu">
    <div class="menu-copy"><div class="eyebrow"><i></i> 每一次碰撞，都在改写历史</div><h1>小小球球，<br>大大的<span>王国。</span></h1><p>没有剧本的世界，没有预设的赢家。<br>看诸国碰撞、成长、争夺，直到一顶王冠统治大地。</p><div class="menu-buttons"><button id="new" class="primary">开启一个新世界 <span>↗</span></button><button id="continue" class="secondary" disabled>继续上次的历史</button></div><button id="menu-import" class="quiet">从文件恢复世界 ↓</button><div class="menu-facts"><span><strong>2,000</strong>球球同场</span><span><strong>种子</strong>复现每段历史</span><span><strong>全自动</strong>你只需观看</span></div></div>
    <div class="menu-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-grid"></div><div class="art-orb amber king"><div class="crown">♛</div><span>• •</span><b>◡</b></div><div class="art-orb mint"><span>• •</span><b>◡</b></div><div class="art-orb purple"><span>• •</span><b>◡</b></div><div class="art-orb pink"><span>• •</span><b>◡</b></div><div class="art-orb blue"><span>• •</span><b>◡</b></div><div class="art-orb little"><span>• •</span><b>◡</b></div><div class="art-tag tag-one"><i class="dot amber-bg"></i>琥珀王国 <small>LV. 06</small></div><div class="art-tag tag-two">✦ 一个世界，无限种可能</div><span class="art-spark spark-one">✧</span><span class="art-spark spark-two">✦</span></div>
    <footer class="menu-footer"><span>随机诞生 · 碰撞成长 · 诸国归一</span><span>本地运行 / 存档只保存在你的浏览器</span></footer>
  </main>
  <main id="game" class="game hidden">
    <section class="arena"><div class="arena-top"><div><span class="live-dot"></span><strong id="world-title">世界观察站</strong><span id="seed-label" class="seed-label"></span></div><div class="arena-stats"><span>时间 <b id="time">00:00</b></span><span>球球 <b id="population">0</b></span><span>王国 <b id="alive">0</b></span></div></div>
      <div class="canvas-wrap"><canvas id="world" aria-label="球球王国模拟地图"></canvas><div id="event-banner" class="event-banner hidden"></div><div class="map-caption"><span>WORLD / 3600 × 2400</span><small>拖动探索 · 滚轮缩放 · 点击查看球球</small></div><div class="zoom-controls"><button id="zoom-in" title="放大" aria-label="放大">+</button><button id="zoom-out" title="缩小" aria-label="缩小">−</button><button id="fit" title="显示完整地图">⊡</button></div><div class="minimap"><canvas id="minimap" width="216" height="144" aria-label="可点击的世界小地图"></canvas><span>世界全览</span></div></div>
      <div class="toolbar"><div class="playback"><button id="pause" class="primary compact">Ⅱ 暂停</button><button id="single" class="secondary compact" title="暂停并推进一帧">单步 ▷</button><div class="speed"><button data-speed="1" class="active">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button></div></div><div class="tools"><button id="save" class="quiet">保存</button><button id="load" class="quiet">读档</button><button id="export" class="quiet">导出</button><button id="import" class="quiet">导入</button><button id="settings" class="quiet">设置</button><button id="back" class="quiet">菜单</button></div></div><div class="performance"><span id="performance">正在观察世界…</span><span id="save-status">自动存档每30秒 · 空格暂停</span></div>
    </section>
    <aside class="sidebar"><div class="side-heading"><span class="eyebrow">THE KINGDOMS</span><h2>诸国的兴衰 <small id="kingdom-count"></small></h2></div><div id="kingdom-list"></div><section id="inspector" class="inspector"><span class="eyebrow">观察对象</span><p>点击地图中的球球或城堡，<br>查看它的故事。</p></section><section class="chronicle"><div class="section-title"><h3>世界纪事</h3><span>实时记录</span></div><div id="logs"></div></section></aside>
  </main>
  <dialog id="dialog"><button id="close-dialog" class="dialog-close" aria-label="关闭">×</button><div id="dialog-body"></div></dialog><div id="toast" role="status" class="toast hidden"></div><input type="file" id="file" accept="application/json,.json" hidden>
`;
const renderer = new Renderer($("#world"), $("#minimap"));
const music = new MusicEngine((message) => toast(message));
$(".map-caption").insertAdjacentHTML(
  "beforeend",
  '<small id="map-legend"></small>',
);
$("#save-status").insertAdjacentHTML(
  "beforebegin",
  '<span id="music-status"></span>',
);
const dialog = $<HTMLDialogElement>("#dialog");
let toastTimer = 0;
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => $("#toast").classList.add("hidden"),
    4500,
  );
}
function showDialog(html: string) {
  $("#dialog-body").innerHTML = html;
  dialog.showModal();
}
function closeDialog() {
  dialog.close();
}
$("#close-dialog").onclick = closeDialog;
$("#dialog").addEventListener("click", (e) => {
  if (e.target === $("#dialog")) {
    const r = $("#dialog").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeDialog();
  }
});
async function refreshSaves() {
  try {
    slots = await loadSaves();
    $("#continue").toggleAttribute("disabled", slots.length === 0);
  } catch (e) {
    toast((e as Error).message);
  }
}
void refreshSaves();
function unlockSound() {
  try {
    audio ??= new AudioContext();
    music.attach(audio);
    if (audio.state === "suspended") void audio.resume();
  } catch {
    /* Audio unavailable: keep simulation playable. */
  }
}
function sound(death: boolean, explosion = false) {
  if (
    !audio ||
    !world ||
    world.settings.volume === 0 ||
    performance.now() - lastSound < 90
  )
    return;
  lastSound = performance.now();
  const oscillator = audio.createOscillator(),
    gain = audio.createGain();
  oscillator.type = explosion ? "triangle" : "sine";
  oscillator.frequency.setValueAtTime(
    explosion ? 95 : death ? 170 : 410,
    audio.currentTime,
  );
  oscillator.frequency.exponentialRampToValueAtTime(
    explosion ? 28 : death ? 65 : 230,
    audio.currentTime + (explosion ? 0.3 : 0.07),
  );
  gain.gain.setValueAtTime(world.settings.volume * 0.07, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    audio.currentTime + (explosion ? 0.35 : 0.1),
  );
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + (explosion ? 0.37 : 0.12));
}
function start(w: World) {
  music.reset();
  world = w;
  screen = "game";
  paused = w.winner !== null;
  speed = 1;
  accumulator = 0;
  resultShown = false;
  renderer.selected = null;
  renderer.particles = [];
  selectedKingdom = null;
  $("#menu").classList.add("hidden");
  $("#game").classList.remove("hidden");
  renderer.resize();
  renderer.fit();
  lastAuto = performance.now();
  perfStart = performance.now();
  simStart = w.time;
  document
    .querySelectorAll("[data-speed]")
    .forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-speed") === "1"),
    );
  $("#seed-label").textContent = `SEED / ${w.settings.seed}`;
  unlockSound();
  updateUI();
}
function settingsDialog(newWorld: boolean) {
  const s = newWorld ? (world?.settings ?? DEFAULTS) : world!.settings;
  if (!newWorld) setPaused(true);
  showDialog(`<div class="eyebrow">${newWorld ? "A NEW BEGINNING" : "PREFERENCES"}</div><h2>${newWorld ? "让一个世界诞生" : "观察设置"}</h2><p class="dialog-intro">${newWorld ? "给随机一点边界，剩下的交给球球。" : "调整画面、声音与世界事件。地图和人口在新局中设置。"}</p><form id="settings-form">
    ${
      newWorld
        ? `<label>世界种子<div class="seed-input"><input name="seed" value="${escape(s.seed)}" maxlength="80" required><button type="button" id="random-seed" class="secondary">随机 ↻</button></div><small>同一种子与相同设置，生成相同的世界。</small></label><label>地图类型<select name="map"><option value="random">随机世界</option>${MAP_TYPES.map((type) => `<option value="${type}" ${s.map === type ? "selected" : ""}>${MAP_NAMES[type]}</option>`).join("")}</select></label><div class="form-row"><label>地图形状<select name="shape">${Object.entries(
            SHAPE_NAMES,
          )
            .map(
              ([key, name]) =>
                `<option value="${key}" ${s.shape === key ? "selected" : ""}>${name}</option>`,
            )
            .join(
              "",
            )}</select></label><label>特殊布局<select name="layout">${Object.entries(
            LAYOUT_NAMES,
          )
            .map(
              ([key, name]) =>
                `<option value="${key}" ${s.layout === key ? "selected" : ""}>${name}</option>`,
            )
            .join(
              "",
            )}</select></label></div><div class="form-row"><label>王国数量<input name="kingdoms" type="number" min="2" max="8" step="1" value="${s.kingdoms}" required></label><label>每国初始兵力<input name="perKingdom" type="number" min="8" max="2000" step="1" value="${s.perKingdom}" required></label></div><p class="population-total">初始总兵力：<strong id="initial-total"></strong> 球 · 各国同时从城堡出兵</p><p id="initial-troops" class="population-total"></p><label>全图人口上限<input name="cap" type="number" min="100" max="4000" step="1" value="${s.cap}" required><small>默认2000；较高上限需要更好的设备性能。</small></label>`
        : ""
    }
    <label>画面细节<select name="quality"><option value="high" ${s.quality === "high" ? "selected" : ""}>精致 · 表情与粒子</option><option value="low" ${s.quality === "low" ? "selected" : ""}>简洁 · 优先性能</option></select></label><div class="form-row"><label>音效音量 <span id="volume-value">${Math.round(s.volume * 100)}%</span><input name="volume" type="range" min="0" max="100" value="${s.volume * 100}"></label><label>音乐音量 <span id="music-volume-value">${Math.round(s.musicVolume * 100)}%</span><input name="musicVolume" type="range" min="0" max="100" value="${s.musicVolume * 100}"></label></div><label class="checkbox"><input name="events" type="checkbox" ${s.events ? "checked" : ""}><span>启用随机世界事件<small>资源雨、临时加速与防护</small></span></label><p id="form-error" role="alert" class="error"></p><button class="primary full" type="submit">${newWorld ? "诞生，开始观察 ↗" : "保存设置"}</button></form>`);
  if (newWorld) {
    const total = () => {
      $("#initial-total").textContent = String(
        Number($<HTMLInputElement>('[name="kingdoms"]').value) *
          Number($<HTMLInputElement>('[name="perKingdom"]').value),
      );
      const counts = troopCounts(
        balancedArmy(
          Math.max(
            0,
            Math.min(
              4000,
              Number($<HTMLInputElement>('[name="perKingdom"]').value) || 0,
            ),
          ),
        ).map((weapon) => ({ weapon })),
      );
      $("#initial-troops").textContent =
        "每国组成（含国王）：" +
        WEAPON_TYPES.map(
          (weapon) => `${TROOP_NAMES[weapon]} ${counts[weapon]}`,
        ).join(" · ");
    };
    $('[name="kingdoms"]').addEventListener("input", total);
    $('[name="perKingdom"]').addEventListener("input", total);
    total();
  }
  $('[name="musicVolume"]').addEventListener("input", (e) => {
    $("#music-volume-value").textContent =
      `${(e.target as HTMLInputElement).value}%`;
  });
  $("#random-seed")?.addEventListener("click", () => {
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    ($('[name="seed"]') as HTMLInputElement).value =
      `orb-${seed[0].toString(36)}`;
  });
  $('[name="volume"]').addEventListener("input", (e) => {
    $("#volume-value").textContent = `${(e.target as HTMLInputElement).value}%`;
  });
  $("#settings-form").onsubmit = (e) => {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const next: Settings = {
      ...s,
      quality: form.get("quality") as Settings["quality"],
      volume: Number(form.get("volume")) / 100,
      musicVolume: Number(form.get("musicVolume")) / 100,
      events: form.has("events"),
    };
    if (newWorld) {
      next.seed = String(form.get("seed"));
      next.kingdoms = Number(form.get("kingdoms"));
      next.perKingdom = Number(form.get("perKingdom"));
      next.population = next.perKingdom * next.kingdoms;
      next.map = form.get("map") as MapType | "random";
      next.shape = form.get("shape") as Settings["shape"];
      next.layout = form.get("layout") as Settings["layout"];
      next.cap = Number(form.get("cap"));
      if (next.population > next.cap || next.population < 20) {
        $("#form-error").textContent =
          "初始总兵力至少20球，且不能超过人口上限。";
        return;
      }
      start(createWorld(next));
      toast("新世界已诞生。拖动地图，开始探索。");
    } else {
      world!.settings = next;
      toast("设置已保存，点击继续恢复模拟。");
    }
    closeDialog();
  };
}
$("#new").onclick = () => settingsDialog(true);
$("#settings").onclick = () => settingsDialog(false);
function setPaused(value: boolean) {
  paused = value;
  if (value && world) music.update(world, false, 0);
  accumulator = 0;
  $("#pause").textContent = paused ? "▷ 继续" : "Ⅱ 暂停";
}
$("#pause").onclick = () => {
  if (world?.winner !== null && world?.winner !== undefined)
    return toast("世界已统一，可以查看结算或开启新局。");
  unlockSound();
  setPaused(!paused);
};
function advance() {
  const w = world;
  if (!w) return;
  const effects = step(w);
  renderer.add(effects);
  const exploded = w.blasts.some((b) => b.born === w.time);
  if (effects.length || exploded)
    sound(exploded || effects.some((e) => e.kind === "death"), exploded);
}
$("#single").onclick = () => {
  setPaused(true);
  advance();
  updateUI();
};
document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(
  (button) =>
    (button.onclick = () => {
      speed = Number(button.dataset.speed);
      accumulator = 0;
      document
        .querySelectorAll("[data-speed]")
        .forEach((b) => b.classList.toggle("active", b === button));
    }),
);
async function persist(slot: Slot, message?: string) {
  if (!world || saving) return;
  saving = true;
  try {
    await saveWorld(world, slot);
    $("#save-status").textContent =
      `${slot === "auto" ? "自动" : "手动"}存档 · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
    if (slot === "manual") toast(message ?? "手动存档已保存；自动存档保存在独立槽位。");
    await refreshSaves();
  } catch (e) {
    toast((e as Error).message);
  } finally {
    saving = false;
  }
}
$("#save").onclick = () => void persist("manual");
async function savesDialog() {
  if (screen === "game") setPaused(true);
  await refreshSaves();
  showDialog(
    `<div class="eyebrow">YOUR WORLDS</div><h2>继续一段历史</h2><p class="dialog-intro">手动存档与自动存档各自保留最新一次记录。</p><div class="save-list">${
      slots.length
        ? slots
            .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
            .map(
              (s) =>
                `<button class="save-card" data-slot="${s.slot}"><span>${s.slot === "manual" ? "手动存档" : "自动存档"}<small>${escape(s.world.settings?.seed ?? "未知种子")}</small></span><span>${clock(s.world.time)}<small>${new Date(s.savedAt).toLocaleString("zh-CN")}</small></span><b>↗</b></button>`,
            )
            .join("")
        : "<p>还没有存档。开始新世界后可以保存。</p>"
    }</div>`,
  );
  document.querySelectorAll<HTMLButtonElement>("[data-slot]").forEach(
    (b) =>
      (b.onclick = () => {
        try {
          const save = slots.find((s) => s.slot === b.dataset.slot)!;
          const w = validateWorld(structuredClone(save.world));
          closeDialog();
          start(w);
          if ((save.world.version as number) < 6) {
            toast("旧存档已升级：已支持满级爆炸、城堡治疗与四入口竞技场。");
            void persist(save.slot);
          } else toast("世界已恢复。");
        } catch (e) {
          toast((e as Error).message);
        }
      }),
  );
}
$("#continue").onclick = $("#load").onclick = () => void savesDialog();
$("#export").onclick = () => {
  if (!world) return;
  const blob = new Blob([JSON.stringify(world)], { type: "application/json" });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `球球王国-${world.settings.seed.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}-${Math.floor(world.time)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("世界存档已导出。");
};
function chooseImport() {
  if (screen === "game") setPaused(true);
  $("#file").click();
}
$("#import").onclick = $("#menu-import").onclick = chooseImport;
$("#file").onchange = async (e) => {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 12_000_000) throw new Error("存档文件超过12MB限制。");
    const contents = await file.text();
    const w = importSave(contents);
    const legacy = JSON.parse(contents).version < 6;
    closeDialog();
    start(w);
    setPaused(true);
    if (legacy) {
      toast("旧存档已升级，世界已暂停。");
      void persist("manual", "旧存档已升级并保存，世界已暂停。");
    } else toast("导入成功，世界已暂停。点击继续开始观察。");
  } catch (error) {
    toast((error as Error).message);
  } finally {
    input.value = "";
  }
};
async function menu() {
  if (world) {
    setPaused(true);
    await persist("auto");
  }
  screen = "menu";
  $("#game").classList.add("hidden");
  $("#menu").classList.remove("hidden");
}
$("#back").onclick = () => void menu();
$(".brand").onclick = (e) => {
  e.preventDefault();
  if (screen === "game") void menu();
};
$("#help").onclick = () => {
  if (screen === "game") setPaused(true);
  showDialog(
    `<div class="eyebrow">FIELD GUIDE</div><h2>做一位世界观察者</h2><div class="guide"><p><b>01 / 看碰撞</b>球球自动运动并反弹，球间碰撞守恒动量和动能；冲锋、地形、加速和击退作为外力。普通战斗友军无伤，敌军互伤；速度、质量与属性决定伤害。金色王冠标记国王。</p><p><b>02 / 看成长</b>击败敌人获得经验，升级变大并解锁护盾、重击、吸血或加速。死亡留下金色资源，由触碰它的球收集。</p><p><b>03 / 看兴衰</b>城堡每批消耗180资源招募10名士兵，每秒产出2资源。领地越多招募越快，间隔2.5秒至1.25秒；资源不足180或人口名额不足10时等待，最多保留一次待招募进度。普通球初始为1级、无技能和统一基础属性，之后通过战斗成长。国王死亡会有继任者；城堡被摧毁则全国归入进攻者。</p><p><b>04 / 看统一</b>球在地块内停留占领，多国共处暂停争夺。只剩一个王国时自动收拢剩余领地，随后结算。</p><p><b>爆炸与火圈</b>国王（含继任者）死亡引发半径150、80固定伤害爆炸，可立即连锁。城堡陷落立即归并，原位置先产生半径140、80伤害爆炸，再留下半径110的火圈，持续15秒，每0.5秒灼烧6生命，最后3秒逐渐熄灭。它们伤及敌我球球，不损伤城堡，不授予经验或击杀；山壁阻隔伤害，火圈不阻挡移动。领地以平滑连接区域显示，占领与生产计算不变。</p><p><b>操作</b>拖动地图、滚轮缩放，点击球或城堡查看详情。空格暂停，方向键移动镜头，+ / − 缩放，F 显示全图。手动和自动存档互不覆盖。</p><p>存档保存在当前浏览器与当前网站地址下；请导出JSON备份。高倍速在设备繁忙时可能达不到标称速度，实际速度显示在地图下方。</p></div>`,
  );
  $(".guide").insertAdjacentHTML(
    "afterbegin",
    "<p><b>满级与城堡治疗</b>10级球死亡发生半径150、80伤害的敌我范围爆炸，国王任意等级死亡都会爆炸，每球只触发一次。满级禁止升级回血和吸血，但接触本国存活城堡仍可治疗，每恢复10生命消耗1资源，资源不足则部分恢复；不自动返城。</p><p><b>城堡出兵与冷兵器</b>新局城堡随机分散，各国等量初始兵力同时向四周射出，每次后续招募射出10球，初始与招募球有3秒双倍速冲锋，期间穿过友军和本城堡。每国拥有八种兵种，均分初始兵力；招募优先补充少数兵种。国王低于30%生命时，每次任职可触发一次5秒王者战意，减伤40%、攻击提高25%。范围攻击最多命中四个目标，并分摊伤害。近战自动挥砍，弓弩射箭；征服后球球保留原武器。</p><p><b>地形与配乐</b>沙地、林地减速，冰面滑行，山壁与水域阻挡；群岛通过桥梁交战，箭矢可越过水域。可选择矩形或圆形边界，圆周碰撞反弹，圆外不参与占领；中央湖泊阻挡球，中央竞技场由石墙围合，仅东南西北四个入口可通行，墙体阻挡球球、箭矢和爆炸。六首地图音乐随战况切换激战曲，暂停时音乐续播位置保留。</p>",
  );
};
const canvas = $("#world");
let drag: {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
} | null = null;
canvas.addEventListener("pointerdown", (e) => {
  drag = {
    x: e.clientX,
    y: e.clientY,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add("dragging");
  unlockSound();
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4)
    drag.moved = true;
  renderer.camera.x -= (e.clientX - drag.x) / renderer.camera.zoom;
  renderer.camera.y -= (e.clientY - drag.y) / renderer.camera.zoom;
  renderer.clampCamera();
  drag.x = e.clientX;
  drag.y = e.clientY;
});
canvas.addEventListener("pointerup", (e) => {
  if (drag && !drag.moved && world) {
    const rect = canvas.getBoundingClientRect(),
      p = renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const ball = [...world.balls]
      .sort(
        (a, b) =>
          Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
      )
      .find(
        (b) =>
          Math.hypot(b.x - p.x, b.y - p.y) < b.r + 7 / renderer.camera.zoom,
      );
    renderer.selected = ball?.id ?? null;
    selectedKingdom = ball
      ? null
      : (world.kingdoms.find(
          (k) => k.alive && Math.hypot(k.x - p.x, k.y - p.y) < 55,
        )?.id ?? null);
    updateUI();
  }
  drag = null;
  canvas.classList.remove("dragging");
});
canvas.addEventListener("pointercancel", () => {
  drag = null;
  canvas.classList.remove("dragging");
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    renderer.zoomAt(
      Math.exp(-e.deltaY * 0.0015),
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  },
  { passive: false },
);
$("#zoom-in").onclick = () => renderer.zoomAt(1.3);
$("#zoom-out").onclick = () => renderer.zoomAt(1 / 1.3);
$("#fit").onclick = () => renderer.fit();
$("#minimap").onclick = (e) => {
  const r = $("#minimap").getBoundingClientRect();
  renderer.camera.x = ((e.clientX - r.left) / r.width) * WIDTH;
  renderer.camera.y = ((e.clientY - r.top) / r.height) * HEIGHT;
};
document.addEventListener("keydown", (e) => {
  if (
    screen !== "game" ||
    dialog.open ||
    /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName)
  )
    return;
  if (e.code === "Space") {
    e.preventDefault();
    $("#pause").click();
  }
  if (e.key === "+" || e.key === "=") renderer.zoomAt(1.2);
  if (e.key === "-") renderer.zoomAt(1 / 1.2);
  if (e.key.toLowerCase() === "f") renderer.fit();
  const distance = 100 / renderer.camera.zoom;
  if (e.key.startsWith("Arrow")) {
    e.preventDefault();
    if (e.key === "ArrowLeft") renderer.camera.x -= distance;
    if (e.key === "ArrowRight") renderer.camera.x += distance;
    if (e.key === "ArrowUp") renderer.camera.y -= distance;
    if (e.key === "ArrowDown") renderer.camera.y += distance;
    renderer.clampCamera();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && screen === "game") {
    setPaused(true);
    void persist("auto");
  }
});
function updateUI() {
  if (!world) return;
  const w = world,
    territory = territories(w),
    total = w.cells.filter((c) => !c.blocked).length;
  $("#world-title").textContent =
    `${MAP_NAMES[w.mapType]} · ${SHAPE_NAMES[w.settings.shape]} · ${LAYOUT_NAMES[w.settings.layout]}`;
  $("#map-legend").textContent =
    MAP_HINTS[w.mapType] +
    (w.settings.shape === "circle" ? " · 圆周反弹，圆外不可占领" : "") +
    " · " +
    LAYOUT_NAMES[w.settings.layout];
  $("#music-status").textContent = music.current
    ? `♫ ${TRACK_NAMES[music.current.track]}`
    : "♫ 等待音乐";
  $("#time").textContent = clock(w.time);
  $("#population").textContent = w.balls.length.toLocaleString();
  $("#alive").textContent =
    `${w.kingdoms.filter((k) => k.alive).length} / ${w.kingdoms.length}`;
  $("#kingdom-count").textContent =
    `${w.kingdoms.filter((k) => k.alive).length} 国存续`;
  $("#pause").textContent = paused ? "▷ 继续" : "Ⅱ 暂停";
  const rates = production(w);
  const count = w.kingdoms.map(
    (k) => w.balls.filter((b) => b.kingdom === k.id).length,
  );
  $("#kingdom-list").innerHTML = w.kingdoms
    .map(
      (k) =>
        `<button class="kingdom-card ${k.alive ? "" : "fallen"}" data-kingdom="${k.id}" style="--kingdom:${k.color}"><div class="kingdom-title"><span><i class="dot" style="background:${k.color}"></i>${escape(k.name)}</span><small>${k.alive ? `${((territory[k.id] / total) * 100).toFixed(1)}% 领地` : "已归入他国"}</small></div><div class="territory-track"><span style="width:${(territory[k.id] / total) * 100}%"></span></div><div class="kingdom-metrics"><span>八兵种混编</span><span>◉ ${count[k.id]}</span><span>◇ ${Math.floor(k.resources)}</span><span>⚔ ${k.kills}</span></div><div class="production-info">生产 ${rates[k.id].multiplier.toFixed(2)}× · ${rates[k.id].interval.toFixed(2)}秒 / 批（10球） · ${Math.floor(k.recruitProgress * 100)}%</div><div class="production-track"><span style="width:${k.recruitProgress * 100}%"></span></div><div class="troop-counts">${troopSummary(w, k.id)}</div></button>`,
    )
    .join("");
  document.querySelectorAll<HTMLButtonElement>("[data-kingdom]").forEach(
    (button) =>
      (button.onclick = () => {
        selectedKingdom = Number(button.dataset.kingdom);
        renderer.selected = null;
        const k = world!.kingdoms[selectedKingdom];
        renderer.camera.x = k.x;
        renderer.camera.y = k.y;
        renderer.camera.zoom = 0.8;
        updateUI();
      }),
  );
  const b = w.balls.find((b) => b.id === renderer.selected);
  if (b) {
    const k = w.kingdoms[b.kingdom];
    $("#inspector").innerHTML =
      `<span class="eyebrow">${b.king ? "♛ 王冠的持有者" : "一个球球的故事"}</span><h3 style="color:${k.color}">球球 #${b.id}<small>LV. ${b.level}</small></h3><p>${escape(k.name)} · ${b.kills} 次击杀 · ${WEAPONS[b.weapon].icon} ${TROOP_NAMES[b.weapon]}${b.chargeUntil > w.time ? " · 冲锋中" : ""}</p><div class="health-track"><span style="width:${(b.hp / b.maxHp) * 100}%;background:${k.color}"></span></div><div class="detail-grid"><span>生命<b>${Math.ceil(b.hp)} / ${Math.ceil(b.maxHp)}</b></span><span>速度<b>${Math.round(Math.hypot(b.vx, b.vy))}</b></span><span>攻击 / 防御<b>${b.attack.toFixed(1)} / ${b.defense.toFixed(1)}</b></span><span>武器倍率 / 间隔<b>${WEAPONS[b.weapon].multiplier}× / ${WEAPONS[b.weapon].cooldown}s</b></span><span>经验<b>${Math.floor(b.xp)}${b.level < 10 ? ` / ${b.level * 35}` : " · 满级"}</b></span><span>射程 / 质量<b>${WEAPONS[b.weapon].range} / ${b.mass.toFixed(1)}</b></span></div><div class="skills">${b.king ? `<span>王者战意：${b.warCryUntil > w.time ? "发动中" : b.warCryUsed ? "本次任职已使用" : "低于30%生命触发"}</span>` : ""}${b.skills.map((s) => `<span>${s}</span>`).join("") || "<span>尚未觉醒技能</span>"}</div>`;
  } else if (selectedKingdom !== null) {
    const k = w.kingdoms[selectedKingdom];
    $("#inspector").innerHTML =
      `<span class="eyebrow">王国档案</span><h3 style="color:${k.color}">${escape(k.name)}</h3><p>${k.alive ? "城堡仍然屹立" : "城堡已经陷落"} · 八兵种混编</p><div class="health-track"><span style="width:${(k.hp / k.maxHp) * 100}%;background:${k.color}"></span></div><div class="detail-grid"><span>城堡生命<b>${Math.ceil(k.hp)} / ${k.maxHp}</b></span><span>领地<b>${territory[k.id]} 地块</b></span><span>累计招募<b>${k.recruited}</b></span><span>资源库存<b>${Math.floor(k.resources)}</b></span><span>生产倍率 / 间隔<b>${rates[k.id].multiplier.toFixed(2)}× / ${rates[k.id].interval.toFixed(2)}秒</b></span><span>招募进度<b>${Math.floor(k.recruitProgress * 100)}%</b></span></div><div class="troop-counts">${troopSummary(w, k.id)}</div>`;
  } else
    $("#inspector").innerHTML =
      `<span class="eyebrow">观察对象</span><p>${renderer.selected !== null ? "这个球球已离开世界，<br>它的资源将延续新的故事。" : "点击地图中的球球或城堡，<br>查看它的故事。"}</p>`;
  $("#logs").innerHTML = w.logs
    .slice(0, 8)
    .map(
      (l) =>
        `<div class="log"><time>${clock(l.time)}</time><span>${escape(l.text)}</span></div>`,
    )
    .join("");
  const active = w.event.until > w.time;
  $("#event-banner").classList.toggle("hidden", !active);
  if (active)
    $("#event-banner").textContent =
      `✦ ${w.event.kind} · ${Math.ceil(w.event.until - w.time)}秒`;
  $("#performance").textContent =
    `${Math.round(renderer.fps)} FPS · 实际 ${paused ? "0.0" : actualSpeed.toFixed(1)}× · 缩放 ${Math.round(renderer.camera.zoom * 100)}%${!paused && actualSpeed < speed * 0.7 ? " · 设备繁忙，模拟自动降速" : ""}`;
  if (w.winner !== null && !resultShown) {
    resultShown = true;
    setPaused(true);
    void persist("auto");
    showResult();
  }
}
function showResult() {
  const w = world!,
    winner = w.kingdoms[w.winner!];
  const ranking = [
    ...w.heroes,
    ...w.balls.map((b) => ({
      id: b.id,
      kingdom: b.kingdom,
      kills: b.kills,
      level: b.level,
    })),
  ]
    .sort((a, b) => b.kills - a.kills || a.id - b.id)
    .slice(0, 5);
  showDialog(
    `<div class="eyebrow">ONE CROWN, ONE WORLD</div><div class="result-crown" style="color:${winner.color}">♛</div><h2>${escape(winner.name)}统一世界</h2><p class="dialog-intro">经历 ${clock(w.time)} 的碰撞与更迭，一顶王冠统治了大地。</p><canvas id="history-chart" width="480" height="160" aria-label="各王国领地随时间的变化"></canvas><div class="chart-legend">${w.kingdoms.map((k) => `<span><i class="dot" style="background:${k.color}"></i>${escape(k.name)}</span>`).join("")}</div><h3>球球击杀榜</h3><div class="ranking">${ranking.map((b, i) => `<p><span>${i + 1}. 球球 #${b.id} <small>LV.${b.level}</small></span><b>${b.kills} 击杀</b></p>`).join("")}</div><button id="result-new" class="primary full">开启下一段历史 ↗</button><button id="result-map" class="quiet full">回到地图，查看统一后的世界</button>`,
  );
  const c = $("#history-chart") as HTMLCanvasElement,
    ctx = c.getContext("2d")!;
  ctx.fillStyle = "#18252b";
  ctx.fillRect(0, 0, c.width, c.height);
  const total = w.cells.filter((c) => !c.blocked).length;
  for (const k of w.kingdoms) {
    ctx.strokeStyle = k.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    w.history.forEach((h, i) => {
      const x = 12 + (h.time / Math.max(1, w.time)) * (c.width - 24),
        y = c.height - 22 - (h.territory[k.id] / total) * (c.height - 34);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.fillStyle = "#9aaba6";
  ctx.font = "10px system-ui";
  ctx.fillText("00:00", 12, c.height - 5);
  ctx.textAlign = "right";
  ctx.fillText(clock(w.time), c.width - 12, c.height - 5);
  $("#result-new").onclick = () => settingsDialog(true);
  $("#result-map").onclick = closeDialog;
}
function frame(now: number) {
  const elapsed = Math.min((now - last) / 1000, 0.15);
  last = now;
  if (world && screen === "game") {
    if (!paused && !dialog.open && !document.hidden) {
      accumulator = Math.min(accumulator + elapsed * speed, STEP * 10);
      const deadline = performance.now() + 9;
      let steps = 0;
      while (accumulator >= STEP && steps < 10) {
        advance();
        accumulator -= STEP;
        steps++;
        if (world.winner !== null || performance.now() >= deadline) break;
      }
    }
    renderer.draw(world, !paused && !dialog.open, elapsed);
    if (now - perfStart >= 1000) {
      actualSpeed = (world.time - simStart) / ((now - perfStart) / 1000);
      simStart = world.time;
      perfStart = now;
    }
    if (now - lastUI > 300) {
      updateUI();
      lastUI = now;
    }
    if (now - lastAuto > 30000) {
      lastAuto = now;
      void persist("auto");
    }
  }
  if (world)
    music.update(
      world,
      screen === "game" &&
        !document.hidden &&
        ((!paused && !dialog.open) ||
          (world.winner !== null && (!dialog.open || !!$("#history-chart")))),
      elapsed,
    );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// A read-only diagnostic snapshot, also useful when reporting device performance.
Object.defineProperty(window, "__orbDiagnostics", {
  get: () => ({
    population: world?.balls.length ?? 0,
    simulationTime: world?.time ?? 0,
    fps: renderer.fps,
    actualSpeed,
    paused,
    particles: renderer.particles.length,
    projectiles: world?.projectiles.length ?? 0,
    map: world?.mapType,
    fires: world?.fires.length,
    blasts: world?.blasts.length,
    shape: world?.settings.shape,
    layout: world?.settings.layout,
    music: music.diagnostics,
  }),
});
