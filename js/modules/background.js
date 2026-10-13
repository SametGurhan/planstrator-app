// ==========================================================
// background.js — Hareketli arka plan sahneleri (Canvas 2D)
//
// Sahneler: "waves" (dalga), "forest" (orman), "river" (nehirli orman), "none" (sade).
// Hepsi aynı fikre dayanır: bir çizginin yüksekliği soldan sağa Math.sin ile değişir.
// Her karede "zaman" biraz ilerler; sinüsün içine zamanı eklediğimiz için şekil hareket eder.
// ==========================================================

import { byId } from "../utils.js";

const STEP = 8;            // eğrileri kaç pikselde bir noktayla çizeceğiz
const FRAME_INTERVAL = 33; // ~30 kare/saniye yeterli; pil ve işlemci dostu

// Dalga sahnesinin ayarları. Değerlerle oynayarak görünümü değiştirebilirsin.
//   level: ekrandaki yükseklik (0 üst, 1 alt)   amplitude: dalga yüksekliği (piksel)
//   length: dalga genişliği                      speed: kayma hızı (eksi = ters yön)
const WAVES = [
  { colorKey: "accent", alpha: 0.15, level: 0.52, amplitude: 46, length: 300, speed: 0.00028 },
  { colorKey: "accent2", alpha: 0.14, level: 0.66, amplitude: 36, length: 220, speed: -0.00036 },
  { colorKey: "accent3", alpha: 0.11, level: 0.80, amplitude: 28, length: 170, speed: 0.00046 },
];

// Orman katmanları: uzaktan yakına. Yakın katman daha koyu ve ağaçları daha büyük.
const FOREST_LAYERS = [
  { colorKey: "far", alpha: 0.38, level: 0.58, amplitude: 26, length: 260, treeCount: 26, treeSize: 46 },
  { colorKey: "mid", alpha: 0.5, level: 0.72, amplitude: 22, length: 200, treeCount: 20, treeSize: 70 },
  { colorKey: "near", alpha: 0.62, level: 0.9, amplitude: 16, length: 150, treeCount: 14, treeSize: 100 },
];

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let canvas = null;
let ctx = null;
let width = 0;
let height = 0;
let scene = "waves";
let colors = {};      // CSS değişkenlerinden okunan renkler
let strength = 1;     // koyu temada sahneyi biraz belirginleştirmek için
let trees = [];       // her orman katmanı için ağaçların yeri ve boyu
let frameId = null;   // çalışan animasyonun kimliği (durdurmak için)
let lastFrameTime = 0;

// ---------------- HAZIRLIK ----------------

// Her açılışta AYNI "rastgele" sayıları üreten küçük üreteç.
// Math.random kullansaydık ağaçlar her yeniden boyutlandırmada yer değiştirirdi.
function createRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280; // 0 ile 1 arası
  };
}

function buildTrees() {
  trees = FOREST_LAYERS.map((layer, layerIndex) => {
    const random = createRandom(layerIndex * 97 + 13);
    const list = [];
    for (let index = 0; index < layer.treeCount; index++) {
      list.push({
        position: (index + random()) / layer.treeCount, // 0-1: ekran genişliğindeki yeri
        scale: 0.6 + random() * 0.7,                    // boy farkı
      });
    }
    return list;
  });
}

// Canvas'ı pencere boyutuna getirir. Yüksek çözünürlüklü ekranlarda
// bulanık görünmemesi için piksel oranıyla çarpıyoruz (en fazla 2).
function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

// ---------------- DALGA SAHNESİ ----------------

function drawWave(wave, time) {
  const baseY = height * wave.level;

  ctx.beginPath();
  ctx.moveTo(0, height); // sol alt köşe
  for (let x = 0; x <= width + STEP; x += STEP) {
    // İki sinüsü topluyoruz: büyük yavaş dalga + küçük hızlı dalga = daha doğal görünüm
    const bigWave = Math.sin(x / wave.length + time * wave.speed) * wave.amplitude;
    const smallWave = Math.sin(x / (wave.length * 0.45) - time * wave.speed * 1.7) * wave.amplitude * 0.3;
    ctx.lineTo(x, baseY + bigWave + smallWave);
  }
  ctx.lineTo(width, height); // sağ alt köşe
  ctx.closePath();
  ctx.globalAlpha = Math.min(1, wave.alpha * strength);
  ctx.fillStyle = colors[wave.colorKey];
  ctx.fill();
}

function drawWaves(time) {
  for (const wave of WAVES) {
    drawWave(wave, time);
  }
}

// ---------------- ORMAN SAHNESİ ----------------

// Bir katmanın tepe çizgisinin x noktasındaki yüksekliği.
function getRidgeY(layer, x) {
  const baseY = height * layer.level;
  return baseY
    + Math.sin(x / layer.length + layer.level * 9) * layer.amplitude
    + Math.sin(x / (layer.length * 0.37) + layer.level * 4) * layer.amplitude * 0.4;
}

// Çam ağacı: üst üste üç üçgen. sway: rüzgarda tepenin sağa sola kayması.
function addTreeToPath(x, groundY, size, sway) {
  const tiers = 3;
  for (let tier = 0; tier < tiers; tier++) {
    const tierBottom = groundY - (size * tier) / (tiers + 0.6) + 6;
    const tierTop = tierBottom - size * 0.52;
    const halfWidth = size * (0.3 - tier * 0.065);
    const lean = sway * (tier + 1) / tiers; // üst katlar daha çok sallanır

    ctx.moveTo(x - halfWidth, tierBottom);
    ctx.lineTo(x + lean, tierTop);
    ctx.lineTo(x + halfWidth, tierBottom);
    ctx.closePath();
  }
}

function drawForestLayer(layerIndex, time) {
  const layer = FOREST_LAYERS[layerIndex];

  // Tepe ve ağaçları TEK bir şekil olarak çiziyoruz; ayrı ayrı boyasaydık
  // yarı saydam renkler üst üste binen yerlerde koyu lekeler oluştururdu.
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width + STEP; x += STEP) {
    ctx.lineTo(x, getRidgeY(layer, x));
  }
  ctx.lineTo(width, height);
  ctx.closePath();

  for (const tree of trees[layerIndex]) {
    const x = tree.position * width;
    const size = layer.treeSize * tree.scale;
    const sway = Math.sin(time * 0.0011 + x * 0.013) * size * 0.035;
    addTreeToPath(x, getRidgeY(layer, x), size, sway);
  }

  ctx.globalAlpha = Math.min(1, layer.alpha * strength);
  ctx.fillStyle = colors[layer.colorKey];
  ctx.fill();
}

function drawForest(time) {
  for (let index = 0; index < FOREST_LAYERS.length; index++) {
    drawForestLayer(index, time);
  }
}

// ---------------- NEHİRLİ ORMAN SAHNESİ ----------------

// Nehrin y yüksekliğindeki orta noktası ve yarı genişliği.
// Aşağı indikçe (bize yaklaştıkça) nehir genişler: perspektif hissi.
function getRiverAt(y, topY) {
  const progress = (y - topY) / (height - topY); // 0 = uzak uç, 1 = ekranın altı
  return {
    centerX: width * (0.5 + 0.13 * Math.sin(progress * 4.2 + 0.6) * (1 - progress * 0.4)),
    halfWidth: 6 + progress * progress * width * 0.2,
    progress: progress,
  };
}

function drawRiver(time) {
  const topY = height * 0.6;

  // Nehrin gövdesi: önce sol kıyı boyunca aşağı, sonra sağ kıyı boyunca yukarı.
  ctx.beginPath();
  for (let y = topY; y <= height; y += STEP) {
    const river = getRiverAt(y, topY);
    ctx.lineTo(river.centerX - river.halfWidth, y);
  }
  for (let y = height; y >= topY; y -= STEP) {
    const river = getRiverAt(y, topY);
    ctx.lineTo(river.centerX + river.halfWidth, y);
  }
  ctx.closePath();
  ctx.globalAlpha = Math.min(1, 0.5 * strength);
  ctx.fillStyle = colors.water;
  ctx.fill();

  // Akıntı: aşağı doğru kayan kısa ışık çizgileri.
  const random = createRandom(7);
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  for (let index = 0; index < 16; index++) {
    const offset = random();           // çizginin nehir içindeki yan konumu
    const start = random();            // döngüdeki başlangıç yeri
    // % 1: 0-1 arasında dönüp duran bir ilerleme değeri verir.
    const progress = (start + time * 0.00007) % 1;
    const y = topY + progress * progress * (height - topY);
    const river = getRiverAt(y, topY);
    const x = river.centerX + (offset - 0.5) * river.halfWidth * 1.5;
    const length = 6 + river.progress * 34;

    ctx.globalAlpha = 0.1 + river.progress * 0.3;
    ctx.lineWidth = 1 + river.progress * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (river.centerX - x) * 0.04, y + length);
    ctx.stroke();
  }
}

function drawRiverForest(time) {
  drawForestLayer(0, time); // uzak orman
  drawForestLayer(1, time); // orta orman
  drawRiver(time);          // nehir ormanın önünden akar
  drawForestLayer(2, time); // en öndeki ağaçlar kıyıyı oluşturur
}

// ---------------- ANİMASYON ----------------

// Hangi sahne hangi fonksiyonla çizilir? ("none" için çizim yok.)
const SCENE_DRAWERS = {
  waves: drawWaves,
  forest: drawForest,
  river: drawRiverForest,
};

function drawFrame(time) {
  ctx.clearRect(0, 0, width, height);
  const draw = SCENE_DRAWERS[scene];
  if (draw) draw(time);
  ctx.globalAlpha = 1;
}

// requestAnimationFrame: tarayıcı ekranı her yenilediğinde fonksiyonumuzu çağırır.
// setInterval'den iyidir; sekme arka plandayken kendiliğinden yavaşlar.
function loop(time) {
  frameId = requestAnimationFrame(loop);
  if (time - lastFrameTime < FRAME_INTERVAL) return; // henüz erken, bu kareyi atla
  lastFrameTime = time;
  drawFrame(time);
}

function startAnimation() {
  if (frameId !== null) return; // zaten çalışıyor, ikinci bir döngü başlatma
  if (reduceMotion.matches || scene === "none") {
    drawFrame(0); // hareket istenmiyorsa tek, sabit bir kare
    return;
  }
  frameId = requestAnimationFrame(loop);
}

function stopAnimation() {
  if (frameId === null) return;
  cancelAnimationFrame(frameId);
  frameId = null;
}

// ---------------- DIŞARIYA AÇIK ----------------

// Renkleri CSS değişkenlerinden okur. Tema ya da renk değişince theme.js bunu çağırır.
export function updateBackgroundColors() {
  if (!ctx) return;
  const styles = getComputedStyle(document.documentElement);
  const read = (name) => styles.getPropertyValue(name).trim();

  colors = {
    accent: read("--accent"),
    accent2: read("--accent-2"),
    accent3: read("--accent-3"),
    far: read("--scene-far"),
    mid: read("--scene-mid"),
    near: read("--scene-near"),
    water: read("--scene-water"),
  };
  strength = Number(read("--scene-strength")) || 1;
  if (frameId === null) drawFrame(0); // animasyon kapalıysa yeni renkle bir kez çiz
}

// Sahneyi değiştirir: "waves" | "forest" | "river" | "none"
export function setBackgroundScene(name) {
  scene = name;
  if (!ctx) return;
  stopAnimation();
  if (!document.hidden) startAnimation();
  if (frameId === null) drawFrame(0);
}

export function initBackground() {
  canvas = byId("bgCanvas");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  if (!ctx) return; // çok eski tarayıcı: arka plan düz kalır, uygulama çalışmaya devam eder

  buildTrees();
  resizeCanvas();
  updateBackgroundColors();
  startAnimation();

  window.addEventListener("resize", () => {
    resizeCanvas();
    if (frameId === null) drawFrame(0);
  });

  // Sekme görünmüyorken boşuna çizme.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAnimation();
    } else {
      startAnimation();
    }
  });

  // Kullanıcı sistem ayarından "hareketi azalt"ı açıp kapatırsa hemen uy.
  reduceMotion.addEventListener("change", () => {
    stopAnimation();
    startAnimation();
  });
}
