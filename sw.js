// ==========================================================
// sw.js — Service worker: uygulamanın çevrimdışı da açılmasını sağlar
//
// Service worker, sayfadan ayrı çalışan ve ağ isteklerinin arasına giren bir betiktir.
// Strateji "önce ağ": internet varsa dosyanın en yenisini alır ve bir kopyasını saklar;
// internet yoksa saklanan kopyayı verir. Böylece güncellemeler hemen görünür,
// bağlantı kesilince de uygulama açılmaya devam eder.
// ==========================================================

// Dosya listesi değiştiğinde bu adı değiştir (v2, v3...); eski önbellek silinir.
const CACHE_NAME = "planstrator-v8";

// Uygulamanın çalışması için gereken dosyalar ("uygulama kabuğu").
const APP_FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "css/styles.css",
  "css/themes.css",
  "css/components.css",
  "css/effects.css",
  "js/app.js",
  "js/api.js",
  "js/components.js",
  "js/config.js",
  "js/data.js",
  "js/sound.js",
  "js/state.js",
  "js/storage.js",
  "js/theme.js",
  "js/utils.js",
  "js/modules/account.js",
  "js/modules/background.js",
  "js/modules/boards.js",
  "js/modules/categories.js",
  "js/modules/checklists.js",
  "js/modules/dashboard.js",
  "js/modules/goals.js",
  "js/modules/kanban.js",
  "js/modules/notes.js",
  "js/modules/planner.js",
  "js/modules/pomodoro.js",
  "js/modules/profile.js",
  "js/modules/settings.js",
  "js/modules/tasks.js",
  "js/modules/travel.js",
  "js/modules/whiteboard.js",
];

// Kurulum: dosyaları önbelleğe al.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Dosyaları tek tek ekliyoruz: biri bulunamazsa diğerleri yine de saklansın.
      Promise.all(APP_FILES.map((file) => cache.add(file).catch(() => console.warn("Önbelleğe alınamadı:", file)))),
    ),
  );
  self.skipWaiting(); // yeni sürüm beklemeden devreye girsin
});

// Etkinleşme: eski sürümlerin önbelleklerini sil.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
    ),
  );
  self.clients.claim();
});

// Her ağ isteğinde çalışır.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Yalnızca kendi sitemizin GET isteklerine karışıyoruz.
  // /api/ istekleri (sunucu verisi) asla önbellekten verilmez.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Başarılı yanıtın bir kopyasını sakla (yanıt yalnızca bir kez okunabildiği için clone).
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        // Ağ yok: önbellekteki kopyayı dene; sayfa isteğiyse ana sayfayı ver.
        caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match("index.html")),
      ),
  );
});
