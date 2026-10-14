// ==========================================================
// sync.js — Otomatik eşitleme: aynı hesaptaki cihazların verisi kendiliğinden aynı kalır
//
// Fikir: sunucudaki veri bir "sürüm numarası" (updatedAt) taşır. Her cihaz en son hangi
// sürümle eşitlendiğini (syncedAt) ve o zamandan beri kendisinde NELERİN değiştiğini
// (changes, bkz. merge.js) hatırlar. Eşitleme her çalıştığında dört durumdan biri vardır:
//
//   Sunucu değişmedi, burada değişiklik yok  -> hiçbir şey yapma
//   Sunucu değişmedi, burada değişiklik var  -> gönder
//   Sunucu değişti,   burada değişiklik yok  -> sunucudakini al
//   Sunucu değişti,   burada da değişiklik var -> birleştir (merge.js), sonra gönder
//
// Ne zaman çalışır? Bir şey değişince (2 sn bekleyip), uygulamaya geri dönülünce,
// internet gelince ve uygulama açıkken dakikada bir.
// ==========================================================

import { api } from "../api.js";
import { exportAll, onLocalChange, readPreference, savePreference, removePreference, writeSyncedData } from "../storage.js";
import { findChanges, hasChanges, mergeData, takeRemote } from "../merge.js";
import { byId, showToast } from "../utils.js";

const SYNC_KEY = "planstrator.sync";
const PUSH_DELAY = 2000;            // son değişiklikten sonra gönderene kadar bekleme (ms)
const CHECK_INTERVAL = 60 * 1000;   // açıkken sunucuyu yoklama aralığı
const MIN_CHECK_GAP = 10 * 1000;    // pencereye her dönüşte en sık bu aralıkla yokla

let userId = null;      // eşitlenen hesabın kimliği (giriş yoksa null)
let syncedAt = null;    // en son eşitlendiğimiz sunucu sürümü
let changes = {};       // o zamandan beri bu cihazda değişenler (null: bilinmiyor, hepsi)
let previousLocal = null; // değişiklikleri bulmak için bir önceki yerel verinin kopyası
let status = "off";     // "off" | "syncing" | "idle" | "offline" | "error"
let lastSuccessAt = 0;  // son başarılı eşitlemenin saati
let lastCheckAt = 0;
let isRunning = false;
let runAgain = false;   // çalışırken yeni bir istek geldiyse bitince bir tur daha
let pushTimer = null;
let checkTimer = null;
let onRemoteApplied = null;
let getLocalData = null;

// ---------------- DURUMU SAKLAMA ----------------
// syncedAt ve changes sayfa yenilense de kaybolmamalı; yoksa gönderilmemiş değişiklik unutulur.

function saveSyncState() {
  savePreference(SYNC_KEY, JSON.stringify({ userId: userId, syncedAt: syncedAt, changes: changes }));
}

function isDirty() {
  return hasChanges(changes);
}

// Bellekteki verinin bağımsız bir kopyası (sonradan yapılan değişiklikler kopyayı etkilemesin).
function snapshotLocal() {
  previousLocal = JSON.parse(JSON.stringify(getLocalData()));
}

function readSyncState(id) {
  try {
    const saved = JSON.parse(readPreference(SYNC_KEY, "null"));
    if (saved !== null && saved.userId === id) return saved;
  } catch (error) {
    // bozuk kayıt: hiç yokmuş gibi davran
  }
  return null;
}

// ---------------- EKRAN ----------------

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function getStatusText() {
  if (status === "syncing") return "Eşitleniyor…";
  if (status === "offline") return "Çevrimdışı. Değişikliklerin internet gelince gönderilecek.";
  if (status === "error") return "Eşitlenemedi. Tekrar denemek için dokun.";
  if (isDirty()) return "Değişiklikler gönderilecek…";
  if (lastSuccessAt === 0) return "Eşitleme açık.";
  return `Eşitlendi · ${formatTime(lastSuccessAt)}`;
}

function setStatus(next) {
  status = next;
  renderSyncStatus();
}

export function renderSyncStatus() {
  const button = byId("syncBtn");
  const text = getStatusText();
  button.hidden = status === "off";
  // Rengi CSS belirler: "pending" bekleyen değişiklik, diğerleri durumun kendisi.
  button.dataset.state = status === "idle" && isDirty() ? "pending" : status;
  button.setAttribute("aria-label", `Eşitleme: ${text}`);
  button.title = text;
  byId("accountSyncText").textContent = text;
}

// ---------------- EŞİTLEME ----------------

// Kullanıcı bir pencerede bir şey düzenlerken altındaki veri değişmesin.
function isEditing() {
  return document.querySelector("dialog[open]:not(#accountDialog)") !== null;
}

// Gelen (ya da birleştirilmiş) veriyi bu cihaza yazar ve ekranı tazeler.
function applyData(data, whiteboard) {
  if (writeSyncedData(data, whiteboard) && onRemoteApplied) onRemoteApplied();
  snapshotLocal(); // bundan sonraki değişiklikler bu halle karşılaştırılsın
}

async function push(attempt) {
  const local = exportAll();
  if (local.data === null) return;

  // Göndermeden ÖNCE değişiklik listesini boşalt: gönderim sürerken yapılan yeni değişiklikler
  // boş listeye eklenir ve bir sonraki turda gönderilir.
  const sent = changes;
  changes = {};
  saveSyncState();
  try {
    const result = await api.saveBackup({ data: local.data, whiteboard: local.whiteboard, baseUpdatedAt: syncedAt });
    syncedAt = result.updatedAt;
    saveSyncState();
  } catch (error) {
    // Gönderilemedi: gönderdiğimizi sandığımız değişiklikleri geri koy.
    changes = sent === null ? null : mergeChangeLists(sent, changes);
    saveSyncState();
    // 409: o arada başka bir cihaz kaydetmiş. Baştan al: önce onun verisini çek, birleştir, sonra gönder.
    if (error.status === 409 && attempt < 2) return runSync(attempt + 1);
    throw error;
  }
}

async function runSync(attempt) {
  const id = userId;
  const remote = await api.loadBackup(syncedAt);
  if (id !== userId) return; // bu arada çıkış yapıldı

  const remoteChanged = remote.unchanged !== true && remote.data !== null;
  if (remoteChanged) {
    const local = exportAll();
    if (!isDirty() || local.data === null) {
      applyData(takeRemote(local.data || {}, remote.data), remote.whiteboard);
      syncedAt = remote.updatedAt;
      saveSyncState();
      return;
    }
    // İki tarafta da değişiklik var: sunucudaki veriye bu cihazdaki değişiklikleri uygula.
    // Çizimde kayıt kayıt birleştirme yok: burada çizildiyse buradaki, yoksa sunucudaki geçerli.
    const drewHere = changes === null || changes.whiteboard === true;
    applyData(mergeData(local.data, remote.data, changes), drewHere ? local.whiteboard : remote.whiteboard);
    syncedAt = remote.updatedAt; // birleşmiş veri artık bu sürümün üzerine kurulu
  }

  // Sunucuda hiç veri yoksa (ilk eşitleme) ya da burada değişiklik varsa gönder.
  if (isDirty() || remote.data === null) await push(attempt);
}

// force: kullanıcı düğmeye bastıysa sıklık sınırına bakma.
export async function syncNow(force) {
  if (userId === null) return;
  if (!force && !isDirty() && Date.now() - lastCheckAt < MIN_CHECK_GAP) return;
  if (isRunning) {
    runAgain = true;
    return;
  }
  if (isEditing()) {
    schedulePush(); // pencere kapanınca tekrar dene
    return;
  }

  isRunning = true;
  clearTimeout(pushTimer);
  lastCheckAt = Date.now();
  setStatus("syncing");
  try {
    await runSync(0);
    lastSuccessAt = Date.now();
    setStatus(userId === null ? "off" : "idle");
  } catch (error) {
    // status 0: sunucuya hiç ulaşılamadı (internet yok)
    setStatus(error.status === 0 ? "offline" : "error");
  }
  isRunning = false;

  if (runAgain) {
    runAgain = false;
    syncNow(true);
  }
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(true), PUSH_DELAY);
}

// İki değişiklik listesini birleştirir (aynı bölümün id'leri tek listede toplanır).
function mergeChangeLists(first, second) {
  if (second === null) return null;
  const result = { ...first };
  for (const key of Object.keys(second)) {
    const a = result[key];
    const b = second[key];
    result[key] = a === true || b === true ? true : [...new Set([...(a || []), ...b])];
  }
  return result;
}

// storage.js bu cihazda bir şey kaydedildiğinde çağırır.
// kind: "data" (data = kaydedilen veri) ya da "whiteboard".
function handleLocalChange(kind, data) {
  if (userId === null) return;
  if (kind === "whiteboard") {
    if (changes !== null) changes = { ...changes, whiteboard: true };
  } else {
    const current = JSON.parse(JSON.stringify(data));
    changes = findChanges(previousLocal, current, changes);
    previousLocal = current;
  }
  saveSyncState();
  renderSyncStatus();
  if (isDirty()) schedulePush();
}

// ---------------- DIŞARIYA AÇIK ----------------

// Giriş yapılınca account.js çağırır.
export function startSync(id) {
  if (userId !== id) {
    userId = id;
    const saved = readSyncState(id);
    syncedAt = saved ? saved.syncedAt : null;
    // Bu cihaz bu hesapla ilk kez eşitleniyorsa neyin değiştiği bilinmiyor (null):
    // elindeki verinin tamamı hesaptakiyle birleştirilir, hiçbir şey kaybolmaz.
    changes = saved && saved.changes !== undefined ? saved.changes : null;
    saveSyncState();
  }
  snapshotLocal();
  clearInterval(checkTimer);
  checkTimer = setInterval(() => {
    if (!document.hidden) syncNow(false);
  }, CHECK_INTERVAL);
  syncNow(true);
}

// Çıkışta bekleyen değişiklik varsa önce gönderir (başarısız olursa da çıkışı engellemez).
export async function flushSync() {
  if (userId !== null && isDirty()) await syncNow(true);
}

// Çıkış yapılınca account.js çağırır. Bu cihazdaki veri silinmez.
export function stopSync() {
  userId = null;
  syncedAt = null;
  changes = {};
  clearInterval(checkTimer);
  clearTimeout(pushTimer);
  removePreference(SYNC_KEY); // tekrar girişte ilk eşitleme gibi birleştirilsin
  setStatus("off");
}

// options.getLocalData: bellekteki verinin tamamını veren fonksiyon (state.js).
// options.onRemoteApplied: başka cihazdan veri gelince ekranı tazelemek için (app.js).
export function initSync(options) {
  getLocalData = options.getLocalData;
  onRemoteApplied = options.onRemoteApplied;
  onLocalChange(handleLocalChange);

  byId("syncBtn").addEventListener("click", async () => {
    await syncNow(true);
    if (status === "idle") showToast("Verilerin eşitlendi.");
  });
  byId("accountSyncBtn").addEventListener("click", () => syncNow(true));

  // Uygulamaya geri dönülünce yokla; uygulamadan çıkılırken bekleyen değişikliği gönder.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden || isDirty()) syncNow(isDirty());
  });
  window.addEventListener("focus", () => syncNow(false));
  window.addEventListener("online", () => syncNow(true));

  renderSyncStatus();
}
