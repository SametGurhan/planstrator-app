// ==========================================================
// pomodoro.js — Pomodoro zamanlayıcısı
//
// EN ÖNEMLİ FİKİR: Kalan süreyi her saniye 1 azaltarak SAYMIYORUZ.
// Başlatınca "oturum şu anda bitecek" bilgisini (endsAt) kaydediyoruz ve
// kalan süreyi her seferinde yeniden hesaplıyoruz:  kalan = endsAt - şimdi
//
// Neden? Tarayıcı arka plandaki sekmelerde zamanlayıcıları yavaşlatır, bilgisayar
// uykuya geçebilir, sayfa yenilenebilir. Sayarak giden bir sayaç bu durumlarda geri kalır;
// saate bakarak hesaplayan sayaç ise her zaman doğruyu gösterir.
// ==========================================================

import { MODE_LABELS, SOUND_LABELS } from "../data.js";
import { playSound, unlockAudio } from "../sound.js";
import {
  getSettings, updateSettings, validateSettingsInput, getModeMinutes, getModeSeconds,
  getSessions, addSession, clearSessions, addSpentMinutes, isWorkSession,
  getTimer, saveTimer, getTasks, getTaskById,
} from "../state.js";
import { createEmptyState, askConfirm } from "../components.js";
import { el, icon, clear, byId, showToast, todayKey, formatMinutes, formatShortDate, fillSelect } from "../utils.js";

const TICK_INTERVAL = 500; // ekranı yarım saniyede bir yenile
const HISTORY_LIMIT = 20;

const MODE_ICONS = { focus: "target", shortBreak: "clock", longBreak: "clock", custom: "timer" };

let tickId = null;               // çalışan setInterval'in kimliği
let pageTitle = document.title;  // sekme başlığının zamanlayıcısız hali
let onSessionComplete = null;    // oturum bitince app.js'e haber vermek için

// ---------------- HESAPLAMA ----------------

function getRemainingMs() {
  const timer = getTimer();
  if (timer.status === "running") {
    return Math.max(0, timer.endsAt - Date.now()); // eksiye düşmesin
  }
  return timer.remainingMs;
}

// 1 500 000 ms -> "25:00"     5 400 000 ms -> "1:30:00"
function formatClock(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60); // saatlerden artan dakikalar
  const seconds = totalSeconds % 60;

  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${minuteText}:${secondText}`;
  return `${minuteText}:${secondText}`;
}

// 45 -> "45 sn"     5400 -> "1 sa 30 dk"
function formatDuration(totalSeconds) {
  if (totalSeconds < 60) return `${totalSeconds} sn`;
  return formatMinutes(Math.round(totalSeconds / 60));
}

// Dashboard'daki küçük kart da aynı yazıyı kullanır.
export function getTimerText() {
  return formatClock(getRemainingMs());
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

// ---------------- ZAMANLAYICI KONTROLÜ ----------------

function startTicking() {
  if (tickId !== null) return; // zaten çalışıyor; ikinci bir interval açma
  tickId = setInterval(tick, TICK_INTERVAL);
}

function stopTicking() {
  if (tickId === null) return;
  clearInterval(tickId);
  tickId = null;
}

// Başlat ve Devam et aynı işi yapar: bitiş anı = şimdi + kalan süre
function startTimer() {
  const timer = getTimer();
  const now = Date.now();
  saveTimer({
    status: "running",
    endsAt: now + timer.remainingMs,
    startedAt: timer.startedAt === null ? now : timer.startedAt,
  });
  startTicking();
  renderTimerCard();
}

// Duraklat: o anki kalan süreyi sakla, bitiş anını sil.
function pauseTimer() {
  saveTimer({ status: "paused", remainingMs: getRemainingMs(), endsAt: null });
  stopTicking();
  renderTimerCard();
}

// Verilen modu baştan, bekler durumda hazırlar (sıfırlama da bunu kullanır).
function switchMode(mode, focusCount) {
  stopTicking();
  saveTimer({ mode: mode, status: "idle", endsAt: null, startedAt: null, focusCount: focusCount });
  renderTimerCard();
}

// Süre dolduğunda: oturumu kaydet, sıradaki moda geç, kullanıcıya haber ver.
function completeSession() {
  const timer = getTimer();
  const settings = getSettings();
  const minutes = getModeMinutes(timer.mode);
  const wasFocus = timer.mode === "focus";
  const wasCustom = timer.mode === "custom";
  const wasWork = wasFocus || wasCustom; // mola değil, çalışma oturumu

  addSession({
    type: timer.mode,
    taskId: wasWork ? timer.taskId : null,
    startedAt: timer.startedAt,
    endedAt: timer.endsAt, // gerçek bitiş anı (sayfa kapalıyken bittiyse bile doğru)
    minutes: minutes,
  });

  let focusCount = timer.focusCount;
  let nextMode = "focus";

  if (wasWork && timer.taskId) addSpentMinutes(timer.taskId, minutes);

  if (wasCustom) {
    // Serbest çalışma Pomodoro döngüsünü etkilemez; aynı modda yeniden hazır bekler.
    nextMode = "custom";
  }
  if (wasFocus) {
    focusCount += 1;
    // Her N. odaktan sonra uzun mola. % (mod) kalanı verir: 4 % 4 = 0, 5 % 4 = 1
    const isLongBreakTime = focusCount % settings.sessionsBeforeLongBreak === 0;
    nextMode = isLongBreakTime ? "longBreak" : "shortBreak";
  }

  switchMode(nextMode, focusCount);
  renderHistory();
  renderSummary();

  let message = "Yeni bir odak seansına hazır mısın?";
  if (wasFocus) message = `Sırada: ${MODE_LABELS[nextMode]}. Mola zamanı!`;
  if (wasCustom) message = `${formatDuration(getModeSeconds("custom"))} çalıştın. Eline sağlık!`;
  notify(`${MODE_LABELS[timer.mode]} tamamlandı`, message);
  if (onSessionComplete) onSessionComplete();
}

// Yarım saniyede bir çalışır.
function tick() {
  const timer = getTimer();
  if (timer.status === "running" && getRemainingMs() <= 0) {
    completeSession();
    return;
  }
  renderClock();
}

// ---------------- BİLDİRİM ----------------

// Her zaman uygulama içi bildirim; izin varsa ek olarak tarayıcı bildirimi.
function notify(title, body) {
  showToast(`${title}. ${body}`);
  const settings = getSettings();
  if (settings.soundEnabled) playSound(settings.soundType, settings.soundVolume);

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body: body, icon: "assets/icon-192.png" });
    } catch (error) {
      console.warn("Tarayıcı bildirimi gösterilemedi:", error);
    }
  }
}

function renderNotificationButton() {
  const button = byId("notifyBtn");
  const hint = byId("notifyHint");

  if (!("Notification" in window)) {
    button.hidden = true;
    hint.textContent = "Bu tarayıcı sistem bildirimlerini desteklemiyor; uygulama içi bildirim kullanılacak.";
    return;
  }
  if (Notification.permission === "granted") {
    button.hidden = true;
    hint.textContent = "Tarayıcı bildirimleri açık. Sekme arka plandayken de haber alırsın.";
  } else if (Notification.permission === "denied") {
    button.hidden = true;
    hint.textContent = "Bildirim izni tarayıcıda reddedilmiş. Adres çubuğundaki kilit simgesinden açabilirsin; o zamana kadar uygulama içi bildirim kullanılacak.";
  } else {
    button.hidden = false;
    hint.textContent = "İzin verirsen oturum bittiğinde sekme arka planda olsa bile bildirim alırsın.";
  }
}

// ---------------- ÇİZİM ----------------

// Sık çalışan, hafif kısım: saat, halka ve sekme başlığı.
function renderClock() {
  const timer = getTimer();
  const remainingMs = getRemainingMs();
  const fullMs = getModeSeconds(timer.mode) * 1000;
  const text = formatClock(remainingMs);

  byId("timerDisplay").textContent = text;
  // "1:30:00" gibi uzun yazılar halkaya sığsın diye yazıyı küçült.
  byId("timerRing").classList.toggle("is-long", text.length > 5);
  byId("timerRing").style.setProperty("--p", ((fullMs - remainingMs) / fullMs) * 100);

  // Dashboard'daki küçük kart
  byId("timerPreview").textContent = text;
  byId("timerPreviewMode").textContent = MODE_LABELS[timer.mode];

  document.title = timer.status === "running" ? `${text} · ${MODE_LABELS[timer.mode]}` : pageTitle;
}

// Zamanlayıcı kartının geri kalanı: mod düğmeleri, ana düğme, döngü noktaları, görev seçimi.
function renderTimerCard() {
  const timer = getTimer();
  const settings = getSettings();

  const modeButtons = byId("timerModes").querySelectorAll("[data-mode]");
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === timer.mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  const mainLabels = { idle: "Başlat", running: "Duraklat", paused: "Devam et" };
  const statusLabels = { idle: "Hazır", running: "Çalışıyor", paused: "Duraklatıldı" };
  byId("timerMainBtn").textContent = mainLabels[timer.status];
  byId("timerStatus").textContent = `${MODE_LABELS[timer.mode]} · ${statusLabels[timer.status]}`;

  // Serbest mod: süre kutusu görünür; yalnızca beklerken değiştirilebilir.
  const isCustom = timer.mode === "custom";
  const canEdit = timer.status === "idle";
  byId("customField").hidden = !isCustom;
  // Toplam saniyeyi saat / dakika / saniye kutularına böl.
  const customSeconds = settings.customSeconds;
  byId("customHours").value = Math.floor(customSeconds / 3600);
  byId("customMins").value = Math.floor((customSeconds % 3600) / 60);
  byId("customSecs").value = customSeconds % 60;
  for (const inputId of ["customHours", "customMins", "customSecs"]) {
    byId(inputId).disabled = !canEdit;
  }
  byId("customError").hidden = true;
  const presets = byId("customPresets").querySelectorAll("[data-minutes]");
  for (const preset of presets) {
    preset.disabled = !canEdit;
    preset.classList.toggle("is-active", Number(preset.dataset.minutes) * 60 === customSeconds);
  }
  byId("timerCycle").hidden = isCustom; // döngü noktaları yalnızca Pomodoro modlarında anlamlı

  // Döngü noktaları: uzun molaya kaç odak kaldı?
  const total = settings.sessionsBeforeLongBreak;
  let filled = timer.focusCount % total;
  if (timer.mode === "longBreak") filled = total; // döngü tamamlandı
  const cycle = byId("timerCycle");
  clear(cycle);
  for (let index = 0; index < total; index++) {
    const dot = el("span", "cycle__dot");
    if (index < filled) dot.classList.add("is-filled");
    cycle.append(dot);
  }
  cycle.setAttribute("aria-label", `Bu döngüde ${filled} / ${total} odak seansı tamamlandı`);

  // Görev seçimi: yalnızca açık görevler
  const select = byId("timerTask");
  const options = getTasks()
    .filter((task) => !task.completed)
    .map((task) => ({ value: task.id, label: task.title }));
  fillSelect(select, options, "Görev seçilmedi");
  select.value = timer.taskId || "";
  // Seçili görev silinmiş ya da tamamlanmışsa ilişkiyi kaldır.
  if (select.value !== (timer.taskId || "")) saveTimer({ taskId: null });

  renderClock();
}

function renderSummary() {
  const today = todayKey();
  const settings = getSettings();
  const workToday = getSessions().filter((session) => isWorkSession(session) && session.date === today);
  const focusToday = workToday.filter((session) => session.type === "focus");
  let minutes = 0; // odak + serbest çalışma
  for (const session of workToday) {
    minutes += session.minutes;
  }
  byId("pomodoroSummary").textContent =
    `Bugün ${focusToday.length} / ${settings.dailyPomodoroGoal} seans · ${formatMinutes(minutes)} odak`;
}

function createSessionRow(session, today) {
  const row = el("li", "row");

  const iconBox = el("span", isWorkSession(session) ? "stat__icon stat__icon--sm" : "stat__icon stat__icon--sm stat__icon--muted");
  iconBox.append(icon(MODE_ICONS[session.type]));

  const task = session.taskId ? getTaskById(session.taskId) : null;
  const dayText = session.date === today ? "Bugün" : formatShortDate(session.date);

  const body = el("div", "row__body");
  body.append(
    el("p", "row__title", task ? `${MODE_LABELS[session.type]} · ${task.title}` : MODE_LABELS[session.type]),
    el("p", "row__hint", `${dayText}, ${formatTime(session.startedAt)} – ${formatTime(session.endedAt)}`),
  );

  row.append(iconBox, body, el("span", "badge", formatMinutes(session.minutes)));
  return row;
}

function renderHistory() {
  const list = byId("sessionList");
  clear(list);

  // En yeni üstte; yalnızca son 20 kayıt.
  const sessions = [...getSessions()].sort((a, b) => b.endedAt - a.endedAt).slice(0, HISTORY_LIMIT);
  byId("clearSessionsBtn").hidden = sessions.length === 0;

  if (sessions.length === 0) {
    list.append(createEmptyState("Henüz tamamlanan oturum yok. İlk seansını başlat!"));
    return;
  }
  const today = todayKey();
  for (const session of sessions) {
    list.append(createSessionRow(session, today));
  }
}

function fillSettingsForm() {
  const settings = getSettings();
  byId("setFocus").value = settings.focusMinutes;
  byId("setShort").value = settings.shortBreakMinutes;
  byId("setLong").value = settings.longBreakMinutes;
  byId("setCycle").value = settings.sessionsBeforeLongBreak;
  byId("setGoal").value = settings.dailyPomodoroGoal;
  byId("setSound").checked = settings.soundEnabled;
  byId("setSoundType").value = settings.soundType;
  byId("setVolume").value = settings.soundVolume;
  renderSoundControls();
  byId("settingsError").hidden = true;
}

// Ses kapalıyken tür ve seviye seçimi anlamsız; kontrolleri soluklaştır.
function renderSoundControls() {
  const enabled = byId("setSound").checked;
  byId("setSoundType").disabled = !enabled;
  byId("setVolume").disabled = !enabled;
  byId("soundTestBtn").disabled = !enabled;
  byId("volumeValue").textContent = `%${byId("setVolume").value}`;
}

// Ses ayarları "Ayarları kaydet"e basmayı beklemeden, değiştiği anda kaydedilir.
function saveSoundSettings() {
  updateSettings({
    soundEnabled: byId("setSound").checked,
    soundType: byId("setSoundType").value,
    soundVolume: byId("setVolume").value,
  });
  renderSoundControls();
}

// Sayfa her açıldığında app.js çağırır.
export function renderPomodoro() {
  renderTimerCard();
  renderSummary();
  renderHistory();
  fillSettingsForm();
  renderNotificationButton();
}

// app.js sayfa değiştirdiğinde sekme başlığını buradan ayarlar;
// zamanlayıcı çalışıyorsa başlıkta kalan süre gösterilmeye devam eder.
export function setPageTitle(title) {
  pageTitle = title;
  renderClock();
}

// ---------------- OLAYLAR ----------------

function handleMainButton() {
  unlockAudio(); // tıklama anında ses sistemini hazırla; oturum bitince ses çalabilsin
  if (getTimer().status === "running") {
    pauseTimer();
  } else {
    startTimer();
  }
}

function handleModeClick(event) {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  const timer = getTimer();
  const mode = button.dataset.mode;
  if (mode === timer.mode && timer.status === "idle") return;

  if (timer.status === "idle") {
    switchMode(mode, timer.focusCount);
    return;
  }
  // Çalışan ya da duraklatılmış oturum varsa yanlışlıkla kaybolmasın.
  askConfirm({
    title: "Oturum iptal edilsin mi?",
    text: "Devam eden oturum kaydedilmeden sonlanacak.",
    confirmLabel: "Evet, değiştir",
    onConfirm: () => switchMode(mode, timer.focusCount),
  });
}

// Serbest modun süresini (toplam saniye olarak) ayarlar.
function setCustomSeconds(totalSeconds) {
  const isValid = validateSettingsInput({ customSeconds: totalSeconds }).length === 0;
  const errorElement = byId("customError");
  errorElement.textContent = isValid ? "" : "Süre en az 1 saniye, en fazla 12 saat olmalı; kutulara tam sayı yaz.";
  errorElement.hidden = isValid;
  if (!isValid) return;

  updateSettings({ customSeconds: totalSeconds });
  switchMode("custom", getTimer().focusCount); // sayaç yeni süreyi göstersin
}

// Üç kutudaki değerleri tek bir sayıya çevirir: saat * 3600 + dakika * 60 + saniye
function readCustomInputs() {
  const hours = Number(byId("customHours").value);
  const minutes = Number(byId("customMins").value);
  const seconds = Number(byId("customSecs").value);

  // Boş kutu Number("") = 0 olur. Eksi ya da kesirli değer geçersizdir.
  const parts = [hours, minutes, seconds];
  const allValid = parts.every((part) => Number.isInteger(part) && part >= 0);
  if (!allValid) return -1; // setCustomSeconds bunu geçersiz sayıp uyarı gösterir

  return hours * 3600 + minutes * 60 + seconds;
}

function handleSettingsSubmit(event) {
  event.preventDefault();
  const input = {
    focusMinutes: byId("setFocus").value,
    shortBreakMinutes: byId("setShort").value,
    longBreakMinutes: byId("setLong").value,
    sessionsBeforeLongBreak: byId("setCycle").value,
    dailyPomodoroGoal: byId("setGoal").value,
  };

  const messages = validateSettingsInput(input);
  const errorElement = byId("settingsError");
  errorElement.textContent = messages.join(" ");
  errorElement.hidden = messages.length === 0;
  if (messages.length > 0) return;

  // Formdaki değerler metindir ("25"); state.js bunları sayıya çevirir.
  updateSettings(input);

  // Bekleyen zamanlayıcı yeni süreyi hemen göstersin. Çalışan oturuma dokunmuyoruz.
  const timer = getTimer();
  if (timer.status === "idle") switchMode(timer.mode, timer.focusCount);

  renderTimerCard();
  renderSummary();
  showToast("Ayarlar kaydedildi.");
}

function handleNotifyClick() {
  // requestPermission bir "Promise" döndürür: kullanıcı cevap verince .then içindeki kod çalışır.
  Notification.requestPermission().then((permission) => {
    renderNotificationButton();
    if (permission === "granted") showToast("Tarayıcı bildirimleri açıldı.");
  });
}

function handleClearSessions() {
  askConfirm({
    title: "Oturum geçmişi silinsin mi?",
    text: "Tüm Pomodoro kayıtların silinecek. Görevlerdeki harcanan süreler değişmez.",
    confirmLabel: "Geçmişi sil",
    onConfirm: () => {
      clearSessions();
      renderHistory();
      renderSummary();
      if (onSessionComplete) onSessionComplete();
      showToast("Oturum geçmişi silindi.");
    },
  });
}

// options.onSessionComplete: oturum bitince çağrılacak fonksiyon (app.js ekranı tazeler).
export function initPomodoro(options) {
  onSessionComplete = options.onSessionComplete;

  byId("timerMainBtn").addEventListener("click", handleMainButton);
  byId("timerResetBtn").addEventListener("click", () => {
    const timer = getTimer();
    switchMode(timer.mode, timer.focusCount);
  });
  byId("timerModes").addEventListener("click", handleModeClick);
  byId("timerTask").addEventListener("change", (event) => {
    saveTimer({ taskId: event.target.value });
  });
  // Üç kutudan herhangi biri değişince toplam süreyi yeniden hesapla.
  // (change olayı kutulardan kapsayıcıya doğru yayılır; tek dinleyici yeter.)
  byId("customInputs").addEventListener("change", () => setCustomSeconds(readCustomInputs()));
  byId("customPresets").addEventListener("click", (event) => {
    const button = event.target.closest("[data-minutes]");
    if (button) setCustomSeconds(Number(button.dataset.minutes) * 60);
  });
  byId("settingsForm").addEventListener("submit", handleSettingsSubmit);

  // Ses seçenekleri
  fillSelect(
    byId("setSoundType"),
    Object.keys(SOUND_LABELS).map((key) => ({ value: key, label: SOUND_LABELS[key] })),
    "Ses seç",
  );
  byId("setSoundType").options[0].remove(); // boş seçeneğe gerek yok
  byId("setSound").addEventListener("change", saveSoundSettings);
  byId("setSoundType").addEventListener("change", () => {
    saveSoundSettings();
    playSound(byId("setSoundType").value, Number(byId("setVolume").value)); // seçince dinlet
  });
  byId("setVolume").addEventListener("input", renderSoundControls); // kaydırırken yüzdeyi göster
  byId("setVolume").addEventListener("change", saveSoundSettings);   // bırakınca kaydet
  byId("soundTestBtn").addEventListener("click", () => {
    playSound(byId("setSoundType").value, Number(byId("setVolume").value));
  });

  // Sayfa yenilendikten sonra zamanlayıcı kendiliğinden sürer; kullanıcı sayfada
  // herhangi bir yere ilk tıkladığında ses sistemini açıyoruz. { once: true } -> bir kez çalışır.
  document.addEventListener("pointerdown", unlockAudio, { once: true });
  byId("notifyBtn").addEventListener("click", handleNotifyClick);
  byId("clearSessionsBtn").addEventListener("click", handleClearSessions);

  // Sekmeye geri dönünce beklemeden hemen güncelle (arka planda interval yavaşlar).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });

  // Sayfa yenilendiyse kaldığı yerden devam et.
  const timer = getTimer();
  if (timer.status === "running") {
    if (timer.endsAt <= Date.now()) {
      completeSession(); // sayfa kapalıyken süre dolmuş
    } else {
      startTicking();
    }
  }
  renderClock();
}
