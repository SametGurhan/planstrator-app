// ==========================================================
// server/helpers.js — Sunucuda ortak kullanılan küçük yardımcılar
// ==========================================================

// İstemciye gösterilebilecek, beklenen hatalar için (ör. "Parola yanlış").
// status: HTTP durum kodu -> 400 hatalı istek, 401 giriş gerekli, 403 yetki yok,
//         404 bulunamadı, 409 çakışma, 429 çok fazla istek
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---- Girdi temizleme: istemciden gelen HİÇBİR veriye güvenmiyoruz ----

export function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function cleanNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function cleanDate(value) {
  return isDateKey(value) ? value : "";
}

export function cleanEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Değer izin verilenlerden biriyse onu, değilse varsayılanı döndürür.
export function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Adres çubuğundaki :id gibi parametreleri tam sayıya çevirir.
export function toId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Geçersiz kimlik.");
  return id;
}
