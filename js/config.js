// ==========================================================
// config.js — Uygulamanın nerede çalıştığına göre değişen ayarlar
// ==========================================================

// Telefon uygulamasının (APK) bağlanacağı sunucu adresi.
// Uygulamayı başka bir adreste yayınlarsan yalnızca bu satırı değiştir.
// (Bu bir sır değildir; herkesin açabildiği site adresidir.)
const SERVER_URL = "https://planstrator-app.vercel.app";

// Telefon uygulamasının içinde miyiz? Capacitor, uygulama içinde window.Capacitor nesnesini tanımlar.
export const IS_NATIVE_APP = Boolean(
  window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform(),
);

// API isteklerinin başına gelecek adres.
//   Tarayıcıda: "" -> istekler sayfanın açıldığı siteye gider (/api/...)
//   Telefonda:  dosyalar uygulamanın içinde durduğu için sunucunun tam adresi gerekir
export const API_ORIGIN = IS_NATIVE_APP ? SERVER_URL : "";
