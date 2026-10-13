// ==========================================================
// tests/setup.js — Testlerin tarayıcı olmadan (Node.js ile) çalışabilmesi için hazırlık
//
// Uygulama kodu tarayıcıdaki localStorage ve document nesnelerini kullanır.
// Node.js'te bunlar yoktur; burada aynı işi gören basit "taklitlerini" tanımlıyoruz.
// ==========================================================

// Bellekte duran sahte localStorage.
const memory = new Map();

globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};

// Kod, bildirim göstermek için document.getElementById("toast") çağırır.
// null döndürünce bildirim sessizce atlanır; testler için yeterli.
globalThis.document = {
  getElementById: () => null,
};

// "Eleman bulunamadı" uyarıları test çıktısını kirletmesin.
console.warn = () => {};
