// ==========================================================
// settings.js — Ayarlar sayfası: görünüm seçenekleri
// (Pomodoro süreleri ve ses ayarları Pomodoro sayfasında.)
// ==========================================================

import { ACCENT_LABELS, BACKGROUND_LABELS } from "../data.js";
import { getSettings } from "../state.js";
import { getThemeMode, setThemeMode, setAccent, setBackground } from "../theme.js";
import { exportAll, importAll, isValidBackup } from "../storage.js";
import { askConfirm } from "../components.js";
import { el, byId, showToast, todayKey } from "../utils.js";

// Bir seçenek grubunun düğmelerini bir kez oluşturur.
// labels: { anahtar: "Görünen ad" }   dataName: düğmeye yazılacak data-* adı
function buildOptions(containerId, labels, dataName, className) {
  const container = byId(containerId);
  for (const key in labels) {
    const button = el("button", className);
    button.type = "button";
    button.dataset[dataName] = key;
    // Renk düğmelerine data-accent de veriyoruz: themes.css o temanın renklerini
    // düğmenin kendisine uygular, böylece her düğme kendi rengini gösterir.
    if (dataName === "accentOption") button.dataset.accent = key;
    button.append(el("span", "option__swatch"), el("span", "option__label", labels[key]));
    container.append(button);
  }
}

// Seçili olan düğmeyi işaretler.
function markActive(containerId, dataName, activeValue) {
  const buttons = byId(containerId).querySelectorAll("button");
  for (const button of buttons) {
    const isActive = button.dataset[dataName] === activeValue;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

export function renderSettings() {
  const settings = getSettings();
  markActive("modeOptions", "modeOption", getThemeMode());
  markActive("accentOptions", "accentOption", settings.accentTheme);
  markActive("backgroundOptions", "backgroundOption", settings.background);
}

// Ortak tıklama kalıbı: tıklanan düğmeden değeri al, ilgili fonksiyona ver, ekranı tazele.
function listenOptions(containerId, dataName, applyValue) {
  byId(containerId).addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    applyValue(button.dataset[dataName]);
    renderSettings();
  });
}

// ---------------- VERİ: YEDEKLE / GERİ YÜKLE ----------------

// Tüm veriyi bir JSON dosyası olarak indirir.
function downloadBackup() {
  const text = JSON.stringify(exportAll(), null, 2); // null, 2 -> okunaklı, girintili JSON
  // Blob: bellekteki veriyi "dosya gibi" paketler; geçici bir adres üretip indiriyoruz.
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `planstrator-yedek-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(url); // geçici adresi serbest bırak
  showToast("Yedek indirildi.");
}

// Seçilen dosyayı okur, denetler ve kullanıcı onaylarsa yükler.
function handleBackupFile(event) {
  const file = event.target.files[0];
  event.target.value = ""; // aynı dosya yeniden seçilebilsin
  if (!file) return;

  // file.text() bir Promise döndürür: dosya okunduğunda .then içindeki kod çalışır.
  file.text().then((text) => {
    let backup = null;
    try {
      backup = JSON.parse(text);
    } catch (error) {
      backup = null; // geçerli JSON değil
    }
    if (!isValidBackup(backup)) {
      showToast("Bu dosya geçerli bir Planstrator yedeği değil.");
      return;
    }

    askConfirm({
      title: "Yedek geri yüklensin mi?",
      text: `Şu anki tüm verilerin yerine yedekteki ${backup.data.tasks.length} görev ve diğer kayıtlar gelecek.`,
      confirmLabel: "Geri yükle",
      onConfirm: () => {
        if (importAll(backup)) {
          window.location.reload(); // uygulama yeni veriyle baştan açılsın
        } else {
          showToast("Yedek yüklenemedi.");
        }
      },
    });
  });
}

export function initSettings() {
  byId("exportBtn").addEventListener("click", downloadBackup);
  byId("importBtn").addEventListener("click", () => byId("importFile").click());
  byId("importFile").addEventListener("change", handleBackupFile);

  buildOptions("accentOptions", ACCENT_LABELS, "accentOption", "option option--color");
  buildOptions("backgroundOptions", BACKGROUND_LABELS, "backgroundOption", "option option--scene");

  listenOptions("modeOptions", "modeOption", setThemeMode);
  listenOptions("accentOptions", "accentOption", setAccent);
  listenOptions("backgroundOptions", "backgroundOption", setBackground);
}
