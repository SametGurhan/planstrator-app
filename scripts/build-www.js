// ==========================================================
// scripts/build-www.js — Mobil paket için web dosyalarını www/ klasörüne kopyalar
//
// Android uygulaması (Capacitor) yalnızca arayüz dosyalarını içermelidir;
// sunucu kodu, testler ve node_modules pakete girmemeli. Bu betik gereken
// dosyaları temiz bir www/ klasörüne kopyalar.
// Çalıştırmak için:  npm run build:www
// ==========================================================

import { cpSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "www");

// Pakete girecek dosya ve klasörler
const ITEMS = ["index.html", "privacy.html", "manifest.webmanifest", "sw.js", "css", "js", "assets"];

rmSync(target, { recursive: true, force: true }); // eski kopyayı sil
mkdirSync(target);

for (const item of ITEMS) {
  cpSync(path.join(root, item), path.join(target, item), { recursive: true });
}

console.log(`www/ hazır: ${ITEMS.join(", ")}`);
