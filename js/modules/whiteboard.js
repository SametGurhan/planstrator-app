// ==========================================================
// whiteboard.js — Beyaz tahta: serbest çizim, şekiller, geri al, PNG indirme
//
// Çizimi resim (piksel) olarak değil, "çizgi listesi" olarak saklıyoruz:
//   { tool: "pen", color: "#1b1e2b", size: 4, points: [x1, y1, x2, y2, ...] }
// Bu sayede geri alma kolaydır (son çizgiyi listeden çıkar, yeniden çiz),
// tahta her ekran boyutunda aynı görünür ve veri az yer kaplar.
//
// Koordinatlar ekran pikseli değil, sabit bir "tahta ölçüsü"ndedir (1600 x 1000).
// Ekrana çizerken ölçekleriz; böylece telefonda çizilen bilgisayarda da aynı yerde durur.
// ==========================================================

import { loadWhiteboard, saveWhiteboard } from "../storage.js";
import { askConfirm } from "../components.js";
import { el, byId, showToast, todayKey } from "../utils.js";

const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 1000;
const MIN_POINT_DISTANCE = 1.5; // bundan yakın noktaları kaydetme (veri şişmesin)
const ERASER_SCALE = 4;         // silgi, kalemden bu kat kadar kalın
const SAVE_DELAY = 600;         // son çizgiden bu kadar ms sonra kaydet

const TOOLS = ["pen", "eraser", "line", "rect", "ellipse"];
const COLORS = ["#1b1e2b", "#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea"];

let canvas = null;
let ctx = null;
let baseCanvas = null;  // tamamlanmış çizgilerin tutulduğu görünmez tuval
let baseCtx = null;
let scale = 1;          // tahta ölçüsünden tuval pikseline çarpan

let strokes = [];       // tamamlanan çizgiler
let redoStack = [];     // geri alınan çizgiler (ileri al için)
let current = null;     // şu an çizilmekte olan çizgi

let tool = "pen";
let color = COLORS[0];
let size = 4;
let saveTimer = null;

// ---------------- VERİ ----------------

// Kayıttan gelen bir çizginin kullanılabilir olup olmadığını denetler.
function isValidStroke(raw) {
  return raw !== null && typeof raw === "object"
    && TOOLS.includes(raw.tool)
    && typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color)
    && Number(raw.size) > 0
    && Array.isArray(raw.points) && raw.points.length >= 2 && raw.points.length % 2 === 0
    && raw.points.every((value) => Number.isFinite(value));
}

// Çok sık kaydetmemek için: her değişiklikte sayacı sıfırla, kullanıcı durunca kaydet.
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!saveWhiteboard(strokes)) showToast("Çizim kaydedilemedi (depolama alanı dolmuş olabilir).");
  }, SAVE_DELAY);
}

// ---------------- ÇİZİM ----------------

// Tek bir çizgiyi verilen tuvale çizer.
function drawStroke(context, stroke) {
  const points = stroke.points;

  context.save();
  context.setTransform(scale, 0, 0, scale, 0, 0); // tahta ölçüsü -> tuval pikseli
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  // Silgi: çizdiği yerdeki pikselleri saydam yapar.
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";

  context.beginPath();
  if (stroke.tool === "pen" || stroke.tool === "eraser") {
    if (points.length === 2) {
      // Tek tıklama: nokta koy.
      context.arc(points[0], points[1], stroke.size / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      // Noktaları düz çizgiyle değil, ara noktalardan geçen eğrilerle birleştiriyoruz;
      // böylece çizgi köşeli değil yumuşak görünür.
      context.moveTo(points[0], points[1]);
      for (let index = 2; index < points.length - 2; index += 2) {
        const midX = (points[index] + points[index + 2]) / 2;
        const midY = (points[index + 1] + points[index + 3]) / 2;
        context.quadraticCurveTo(points[index], points[index + 1], midX, midY);
      }
      context.lineTo(points[points.length - 2], points[points.length - 1]);
      context.stroke();
    }
  } else if (points.length >= 4) {
    const x1 = points[0];
    const y1 = points[1];
    const x2 = points[2];
    const y2 = points[3];

    if (stroke.tool === "line") {
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
    }
    if (stroke.tool === "rect") {
      context.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    if (stroke.tool === "ellipse") {
      context.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    }
    context.stroke();
  }
  context.restore();
}

// Tamamlanmış tüm çizgileri görünmez tuvale baştan çizer (geri al, temizle, yeniden boyutlandırma).
function redrawBase() {
  baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  for (const stroke of strokes) {
    drawStroke(baseCtx, stroke);
  }
}

// Ekrandaki tuval = hazır görüntü + (varsa) şu an çizilen çizgi.
// Her fare hareketinde yüzlerce çizgiyi yeniden çizmek yerine hazır görüntüyü kopyalıyoruz.
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseCanvas, 0, 0);
  if (current) drawStroke(ctx, current);
}

// Tuvalin piksel boyutunu ekrandaki boyutuna uydurur.
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return; // sayfa gizliyken ölçü alınamaz

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(rect.width * ratio);
  if (pixelWidth === canvas.width) return; // değişmemiş

  canvas.width = pixelWidth;
  canvas.height = Math.round(pixelWidth * (BOARD_HEIGHT / BOARD_WIDTH));
  baseCanvas.width = canvas.width;
  baseCanvas.height = canvas.height;
  scale = canvas.width / BOARD_WIDTH;

  redrawBase();
  render();
}

// ---------------- İŞARETÇİ (fare, parmak, kalem) ----------------

// Tıklanan yerin tahta ölçüsündeki koordinatı.
function getBoardPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * BOARD_WIDTH;
  const y = ((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT;
  // Bir ondalık basamak yeterli; kayıt boyutunu küçültür.
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function handlePointerDown(event) {
  if (event.button !== 0) return; // yalnızca sol tuş / tek parmak
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId); // imleç tuvalin dışına çıksa da olayları almaya devam et

  const point = getBoardPoint(event);
  current = {
    tool: tool,
    color: color,
    size: tool === "eraser" ? size * ERASER_SCALE : size,
    points: [point.x, point.y],
  };
  render();
}

function handlePointerMove(event) {
  if (!current) return;
  const point = getBoardPoint(event);
  const points = current.points;

  if (current.tool === "pen" || current.tool === "eraser") {
    // Son noktaya çok yakınsa ekleme.
    const lastX = points[points.length - 2];
    const lastY = points[points.length - 1];
    if (Math.hypot(point.x - lastX, point.y - lastY) < MIN_POINT_DISTANCE) return;
    points.push(point.x, point.y);
  } else {
    // Şekillerde yalnızca iki nokta var: başlangıç ve o anki uç.
    points[2] = point.x;
    points[3] = point.y;
  }
  render();
}

function handlePointerUp() {
  if (!current) return;
  const isShape = current.tool !== "pen" && current.tool !== "eraser";
  const isEmptyShape = isShape && current.points.length < 4;

  if (!isEmptyShape) {
    strokes.push(current);
    redoStack = []; // yeni çizimden sonra "ileri al" geçmişi geçersiz
    drawStroke(baseCtx, current);
    scheduleSave();
  }
  current = null;
  render();
  renderToolbar();
}

// ---------------- ARAÇ ÇUBUĞU ----------------

function renderToolbar() {
  const toolButtons = byId("boardTools").querySelectorAll("[data-tool]");
  for (const button of toolButtons) {
    const isActive = button.dataset.tool === tool;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  const colorButtons = byId("boardColors").querySelectorAll("[data-color]");
  for (const button of colorButtons) {
    const isActive = button.dataset.color === color;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  byId("boardSizeValue").textContent = String(size);
  byId("boardUndo").disabled = strokes.length === 0;
  byId("boardRedo").disabled = redoStack.length === 0;
  byId("boardClear").disabled = strokes.length === 0;
  canvas.classList.toggle("is-eraser", tool === "eraser");
}

function buildColorButtons() {
  const container = byId("boardColors");
  const customInput = byId("boardColorCustom");
  for (const value of COLORS) {
    const button = el("button", "color-dot");
    button.type = "button";
    button.dataset.color = value;
    button.style.setProperty("--dot", value);
    button.setAttribute("aria-label", `Renk ${value}`);
    container.insertBefore(button, customInput); // özel renk kutusu sonda kalsın
  }
}

function undo() {
  if (strokes.length === 0) return;
  redoStack.push(strokes.pop()); // son çizgiyi çıkar, ileri al yığınına koy
  redrawBase();
  render();
  renderToolbar();
  scheduleSave();
}

function redo() {
  if (redoStack.length === 0) return;
  const stroke = redoStack.pop();
  strokes.push(stroke);
  drawStroke(baseCtx, stroke);
  render();
  renderToolbar();
  scheduleSave();
}

function clearBoard() {
  askConfirm({
    title: "Tahta temizlensin mi?",
    text: "Tüm çizimler silinecek. Bu işlem geri alınamaz.",
    confirmLabel: "Temizle",
    onConfirm: () => {
      strokes = [];
      redoStack = [];
      redrawBase();
      render();
      renderToolbar();
      scheduleSave();
    },
  });
}

// Çizimi beyaz zeminli bir PNG dosyası olarak indirir.
function downloadImage() {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = BOARD_WIDTH;
  exportCanvas.height = BOARD_HEIGHT;
  const exportCtx = exportCanvas.getContext("2d");

  // Önce beyaz zemin, üstüne çizimin kopyası. (Silgi çizimi saydam yaptığı için zemin ayrı boyanır.)
  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  exportCtx.drawImage(baseCanvas, 0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  // Geçici bir bağlantı oluşturup "tıklayarak" tarayıcıya dosyayı indirtiyoruz.
  const link = document.createElement("a");
  link.download = `planstrator-tahta-${todayKey()}.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
}

// ---------------- DIŞARIYA AÇIK ----------------

// Başka bir cihazdan yeni çizim gelince sync.js çağırır: kayıtlı çizimi yeniden okur ve çizer.
export function reloadWhiteboard() {
  strokes = loadWhiteboard().filter(isValidStroke);
  redoStack = [];
  if (baseCanvas.width > 0) {
    redrawBase();
    render();
  }
}

// Sayfa her açıldığında app.js çağırır (tuval ancak görünürken ölçülebilir).
export function renderWhiteboard() {
  resizeCanvas();
  renderToolbar();
}

export function initWhiteboard() {
  canvas = byId("boardCanvas");
  ctx = canvas.getContext("2d");
  baseCanvas = document.createElement("canvas");
  baseCtx = baseCanvas.getContext("2d");

  strokes = loadWhiteboard().filter(isValidStroke);
  buildColorButtons();

  // İşaretçi olayları fare, parmak ve kalemi tek kodla karşılar.
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);

  byId("boardTools").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tool]");
    if (!button) return;
    tool = button.dataset.tool;
    renderToolbar();
  });

  byId("boardColors").addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    color = button.dataset.color;
    if (tool === "eraser") tool = "pen"; // renk seçen çizmek istiyordur
    renderToolbar();
  });

  byId("boardColorCustom").addEventListener("input", (event) => {
    color = event.target.value;
    if (tool === "eraser") tool = "pen";
    renderToolbar();
  });

  byId("boardSize").addEventListener("input", (event) => {
    size = Number(event.target.value);
    renderToolbar();
  });

  byId("boardUndo").addEventListener("click", undo);
  byId("boardRedo").addEventListener("click", redo);
  byId("boardClear").addEventListener("click", clearBoard);
  byId("boardDownload").addEventListener("click", downloadImage);

  // Ctrl+Z geri al, Ctrl+Y (ya da Ctrl+Shift+Z) ileri al; yalnızca tahta sayfası açıkken.
  document.addEventListener("keydown", (event) => {
    if (byId("view-whiteboard").hidden || !event.ctrlKey) return;
    if (event.target.matches("input, textarea, select")) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      redo();
    }
  });

  window.addEventListener("resize", resizeCanvas);
}
