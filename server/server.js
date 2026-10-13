// ==========================================================
// server/server.js — Planstrator sunucusu (Node.js + Express)
//
// İki iş yapar:
//   1) Uygulamanın dosyalarını (index.html, css, js) tarayıcıya sunar.
//   2) /api/... adreslerinde veritabanıyla konuşan bir REST API sağlar.
// Frontend veritabanına ASLA doğrudan erişmez; yalnızca bu API ile konuşur.
//
// Bilgisayarında çalıştırmak için proje klasöründe:  npm start  ->  http://localhost:5500
// Vercel'de bu dosya doğrudan çalışmaz; api/index.js aynı uygulamayı Vercel'e verir.
// ==========================================================

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter, deleteExpiredSessions } from "./auth.js";
import { syncRouter } from "./sync.js";
import { boardsRouter } from "./boards.js";
import { HttpError } from "./helpers.js";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 5500;

export function createApp() {
  const app = express();
  app.disable("x-powered-by"); // sunucu yazılımını ilan etme
  // Barındırma hizmetleri isteği bir aracı (proxy) üzerinden iletir; gerçek kullanıcının
  // IP adresini doğru okumak için aracıya güveniyoruz (giriş denemesi sınırı bunu kullanır).
  app.set("trust proxy", 1);
  // Barındırma hizmetleri isteği bir aracı (proxy) üzerinden iletir; gerçek kullanıcının
  // IP adresini doğru okumak için aracıya güveniyoruz (giriş denemesi sınırı bunu kullanır).
  app.set("trust proxy", 1);

  // Güvenlik başlıkları: tarayıcıya sayfayı nasıl koruyacağını söyler.
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY"); // sayfa başka sitelerin içine gömülemesin
    response.setHeader("Referrer-Policy", "same-origin");
    // Yalnızca kendi dosyalarımız çalışsın; dışarıdan betik yüklenemesin.
    response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'");
    next();
  });

  // ---------- CORS: telefon uygulamasına izin ----------
  // Tarayıcılar, bir sayfanın BAŞKA bir sitedeki API'ye istek atmasını varsayılan olarak engeller.
  // Telefon uygulamasının sayfaları "https://localhost" adresinden yüklenir (uygulamanın içinden),
  // sunucu ise başka bir adrestedir; bu yüzden yalnızca o kaynaklara açıkça izin veriyoruz.
  // Çerez izni VERMİYORUZ (Allow-Credentials yok): uygulama oturumu başlıktaki anahtarla taşır.
  const APP_ORIGINS = ["https://localhost", "capacitor://localhost"];
  app.use("/api", (request, response, next) => {
    const origin = request.headers.origin;
    if (APP_ORIGINS.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Planstrator-Client");
      response.setHeader("Access-Control-Max-Age", "600");
    }
    // Tarayıcı asıl istekten önce "izin var mı?" diye bir OPTIONS isteği gönderir; ona hemen yanıt ver.
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  });

  // ---------- API ----------
  // İstek gövdesindeki JSON'u request.body nesnesine çevirir. Sınır: 6 MB.
  app.use("/api", express.json({ limit: "6mb" }));

  // Veri değiştiren isteklerde özel bir başlık şart. Başka bir site, kullanıcının
  // tarayıcısından bu başlıkla istek gönderemez (CSRF saldırısına karşı ek önlem).
  app.use("/api", (request, response, next) => {
    const changesData = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (changesData && request.headers["x-requested-with"] !== "planstrator") {
      throw new HttpError(403, "İstek reddedildi.");
    }
    if (request.body === undefined) request.body = {};
    response.setHeader("Cache-Control", "no-store"); // kişisel veri önbelleğe alınmasın
    next();
  });

  app.use("/api/auth", authRouter);
  app.use("/api", syncRouter);
  app.use("/api", boardsRouter);

  // Tanımlı olmayan API adresi
  app.use("/api", () => {
    throw new HttpError(404, "Böyle bir adres yok.");
  });

  // ---------- Uygulama dosyaları ----------
  // Proje klasörünün tamamını DEĞİL, yalnızca gereken klasörleri sunuyoruz;
  // böylece server/ klasörü ve veritabanı dosyası dışarıdan indirilemez.
  app.use("/css", express.static(path.join(projectRoot, "css")));
  app.use("/js", express.static(path.join(projectRoot, "js")));
  app.use("/assets", express.static(path.join(projectRoot, "assets")));
  for (const file of ["index.html", "privacy.html", "sw.js", "manifest.webmanifest"]) {
    app.get(`/${file}`, (request, response) => response.sendFile(path.join(projectRoot, file)));
  }
  app.get("/", (request, response) => response.sendFile(path.join(projectRoot, "index.html")));

  // ---------- Hata yakalama ----------
  // Yukarıdaki herhangi bir yerde fırlatılan hata buraya düşer.
  // eslint-disable-next-line no-unused-vars
  app.use((error, request, response, next) => {
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    if (error.type === "entity.too.large") {
      response.status(413).json({ error: "Gönderilen veri çok büyük." });
      return;
    }
    if (error.type === "entity.parse.failed") {
      response.status(400).json({ error: "Gönderilen veri okunamadı." });
      return;
    }
    // Beklenmeyen hata: ayrıntıyı sunucu günlüğüne yaz, kullanıcıya genel bir mesaj ver
    // (iç ayrıntıları dışarı sızdırmamak için).
    console.error(error);
    response.status(500).json({ error: "Sunucuda beklenmeyen bir hata oluştu." });
  });

  return app;
}

// Bu dosya doğrudan çalıştırıldıysa (npm start) sunucuyu başlat.
// Testler createApp'i içe aktarıp kendi geçici sunucusunu açar.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deleteExpiredSessions().catch((error) => console.error("Eski oturumlar temizlenemedi:", error));
  createApp().listen(PORT, () => {
    console.log(`Planstrator çalışıyor: http://localhost:${PORT}`);
  });
}
