// ==========================================================
// theme.js — Görünüm: açık/koyu mod, renk teması ve arka plan sahnesi
//
// Üç ayar da <html> elemanına yazılır; gerisini CSS halleder:
//   data-theme="light|dark"   -> styles.css
//   data-accent="blue|..."    -> themes.css
// Arka plan sahnesini ise background.js çizer.
// ==========================================================

import { readPreference, savePreference } from "./storage.js";
import { getSettings, updateSettings } from "./state.js";
import { setBackgroundScene, updateBackgroundColors } from "./modules/background.js";
import { byId } from "./utils.js";

const THEME_KEY = "planstrator.theme";

let onChange = null; // görünüm değişince app.js'e haber vermek için

export function getThemeMode() {
  return document.documentElement.dataset.theme;
}

// Modu ekrana uygular (kaydetmez).  mode: "light" | "dark"
function applyThemeMode(mode) {
  document.documentElement.dataset.theme = mode;
  const isDark = mode === "dark";
  byId("themeIcon").setAttribute("href", isDark ? "#i-sun" : "#i-moon");
  byId("themeBtn").setAttribute("aria-label", isDark ? "Açık temaya geç" : "Koyu temaya geç");
  updateBackgroundColors(); // arka plan yeni modun renklerini alsın
}

// Kullanıcı modu kendisi seçtiğinde: uygula ve tercihi kaydet.
export function setThemeMode(mode) {
  applyThemeMode(mode);
  savePreference(THEME_KEY, mode);
  if (onChange) onChange();
}

// Kayıtlı renk temasını ve arka planı ekrana uygular.
export function applyAppearance() {
  const settings = getSettings();
  document.documentElement.dataset.accent = settings.accentTheme;
  setBackgroundScene(settings.background);
  updateBackgroundColors();
}

export function setAccent(name) {
  updateSettings({ accentTheme: name });
  applyAppearance();
}

export function setBackground(name) {
  updateSettings({ background: name });
  applyAppearance();
}

export function initTheme(options) {
  // Kayıtlı tercih yoksa cihazın temasını kullan (kaydetmeden; kullanıcı seçene kadar cihazı izle).
  const systemMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyThemeMode(readPreference(THEME_KEY, systemMode));
  applyAppearance();

  byId("themeBtn").addEventListener("click", () => {
    setThemeMode(getThemeMode() === "dark" ? "light" : "dark");
  });

  // En son atıyoruz ki açılıştaki ilk ayarlamalar gereksiz yere haber göndermesin.
  onChange = options.onChange;
}
