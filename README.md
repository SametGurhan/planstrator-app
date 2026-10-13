# Planstrator

Pomodoro, planlama ve kişisel görev yönetim uygulaması. Görevler, Kanban panosu, zamanlayıcı, takvim, kontrol listeleri, hedefler, notlar, seyahat planı ve beyaz tahta tek yerde; arkadaşlarla paylaşılan ortak panolar da var.

Arayüz düz HTML, CSS ve JavaScript ile (kütüphanesiz) yazıldı. Sunucu Node.js + Express, veritabanı SQLite.

**Canlı sürüm:** https://planstrator-app.vercel.app

## Hızlı başlangıç

Gerekenler: [Node.js](https://nodejs.org) 22 ya da daha yenisi.

Depoyu indir, klasöre gir ve bağımlılıkları kur:

```bash
npm install
```

Uygulamayı başlat:

```bash
npm start
```

Tarayıcıda `http://localhost:5500` adresini aç. Hiçbir ayar gerekmez: veritabanı `server/data/planstrator.db` dosyasında kendiliğinden oluşur.

- Farklı bir port için: PowerShell'de `$env:PORT=3000; npm start`, diğerlerinde `PORT=3000 npm start`.
- Sunucusuz da açılır (ör. VS Code **Live Server** ile `index.html`). O zaman hesap, bulut yedeği ve ortak panolar kapalı olur; geri kalan her şey çalışır.
- `index.html` dosyasına çift tıklayarak (`file://`) açmak çalışmaz; JavaScript modülleri bir sunucu ister.

## Testler

```bash
npm test
```

52 test çalışır: tarih ve tekrar hesapları, veri katmanı (kaydetme, eski sürümden geçiş, bozuk veri), sunucu (kayıt, giriş, yedekleme, davet, yetki) ve e-posta doğrulama.

## Özellikler

| Sayfa | Ne yapar |
|---|---|
| Dashboard | Günün özeti: görevler, gecikenler, odak süresi, hedefler, kategori dağılımı |
| Görevler | Ekle, düzenle, sil; öncelik, kategori, etiket, alt görev, tekrar; filtre, sıralama, arama |
| Pano | Kişisel Kanban: Yapılacak, Devam ediyor, Tamamlandı; sürükle-bırak |
| Ortak Panolar | E-posta ile davet edilen arkadaşlarla paylaşılan Kanban (hesap gerekir) |
| Pomodoro | Gerçek zamana dayalı zamanlayıcı; serbest süre (saat, dakika, saniye) ve klasik Pomodoro modları; ses seçenekleri; oturum geçmişi |
| Planlayıcı | Günlük zaman blokları, haftalık ve aylık takvim, planlanan ve gerçekleşen süre |
| Kontrol Listeleri | Tekrar kullanılabilir şablonlar ve onlardan üretilen işaretlenebilir listeler |
| Hedefler | Sayısal ve tek adımlı hedefler; günlük ve haftalık alışkanlık takibi |
| Notlar | Kategorili, aranabilir, görevle ilişkilendirilebilir notlar |
| Seyahat | Gün gün plan, bavul listesi, bütçe ve harcamalar |
| Beyaz Tahta | Serbest çizim, şekiller, geri al, PNG indirme |
| Ayarlar | Profil, açık/koyu mod, renk teması, arka plan sahnesi, yedekleme, hesap |

## Veri nerede duruyor?

- **Cihazda:** kişisel verin tarayıcının `localStorage` alanında durur (yaklaşık 5 MB sınır). Kimse başkasının verisini göremez; her kurulum kendi boş kopyasıyla başlar. Tarayıcıya ve adrese özeldir; tarayıcı verisini temizlersen silinir.
- **Dosya yedeği:** Ayarlar → *Yedeği indir (JSON)* ve *Yedekten geri yükle*.
- **Bulut yedeği:** hesap açıp *Buluta yedekle* dersen verin sunucuya yazılır; başka cihazda *Buluttan geri yükle* ile alırsın. Eşitleme kendiliğinden değildir; son yedekleyen kazanır.
- **Ortak panolar:** yalnızca sunucuda durur, üyeler arasında 8 saniyede bir tazelenir.

## Ortak pano nasıl kullanılır?

1. Sağ üstteki profil simgesinden hesap aç ve e-posta adresini doğrula.
2. *Ortak Panolar*'da bir pano oluştur, arkadaşının e-posta adresini yazıp davet et.
3. Arkadaşın **aynı e-posta adresiyle** hesap açıp adresini doğrulayınca daveti *Ortak Panolar* sayfasında görür ve kabul eder.

## Ortam değişkenleri (hepsi isteğe bağlı)

Bilgisayarında denemek için hiçbirine gerek yok. Yayına alırken sunucunun ayarlarına girilir; **koda ya da depoya yazılmaz**.

| Değişken | Ne işe yarar | Tanımlı değilse |
|---|---|---|
| `PORT` | Sunucunun portu | 5500 |
| `TURSO_DATABASE_URL` | Barındırılan veritabanının adresi (`libsql://...`) | Yerel dosya kullanılır |
| `TURSO_AUTH_TOKEN` | O veritabanının anahtarı | (yerelde gerekmez) |
| `SMTP_USER` | Mail gönderen adres (ör. bir Gmail hesabı) | E-posta özelliği kapalı |
| `SMTP_PASS` | O hesabın uygulama parolası | E-posta özelliği kapalı |
| `SMTP_HOST`, `SMTP_PORT` | Gmail dışında bir servis için | `smtp.gmail.com`, 465 |
| `APP_URL` | Maillerdeki bağlantıların başına gelecek site adresi | Vercel'de kendiliğinden bulunur |
| `ADMIN_EMAIL` | Yönetim sayfasını görebilecek hesabın e-posta adresi (birden çoksa virgülle) | Yönetici yok |
| `NODE_ENV` | `production` ise oturum çerezi yalnızca HTTPS'te gönderilir | Geliştirme modu |

E-posta kapalıyken mail gitmez ve e-posta doğrulaması istenmez; ortak panolar yine çalışır.

## Yayına alma (Vercel + Turso)

Proje bu ikili için hazırdır; ikisinin de ücretsiz planı var.

- **Vercel** arayüz dosyalarını sunar ve `/api` isteklerinde `api/index.js` üzerinden sunucu kodunu çalıştırır (ayarlar `vercel.json` içinde).
- **Turso** veritabanını barındırır; Vercel'de dosyalar kalıcı olmadığı için veritabanı ayrı durmalıdır.

1. [turso.tech](https://turso.tech) üzerinde bir veritabanı aç; adresini ve bir anahtar al.
2. Proje klasöründe `npx vercel login`, sonra `npx vercel --yes`.
3. Vercel panelinde **Environment Variables** altına `TURSO_DATABASE_URL` ve `TURSO_AUTH_TOKEN` değerlerini gir (mail için `SMTP_USER` ve `SMTP_PASS`).
4. `npx vercel --prod --yes` ile yayınla. Kod değiştikçe aynı komutu yeniden çalıştır.

Kendi adresinde yayınlarsan `js/config.js` içindeki `SERVER_URL` değerini de güncelle; telefon uygulaması oraya bağlanır.

## Telefona ve bilgisayara kurma

Uygulama bir PWA'dır: HTTPS adresinden açıldığında kurulabilir ve çevrimdışı açılır.

- **iPhone / iPad:** Safari'de siteyi aç → Paylaş → *Ana Ekrana Ekle*.
- **Android (Chrome):** menü → *Uygulamayı yükle*.
- **Windows / macOS (Chrome, Edge):** adres çubuğundaki *Yükle* simgesi.

### Android uygulaması (APK)

Proje [Capacitor](https://capacitorjs.com) ile bir Android projesine sarılıdır (`android/` klasörü). Gerekenler: Android Studio (SDK ve JDK ile birlikte gelir).

Arayüz dosyalarını Android projesine kopyala:

```bash
npm run android:sync
```

Android Studio'da aç ve **Build → Build APK(s)** ile derle:

```bash
npm run android:open
```

Derlenen dosya: `android/app/build/outputs/apk/debug/app-debug.apk`. Bu bir deneme (debug) paketidir; mağaza için imzalı sürüm gerekir. APK dosyaları depoya dahil değildir.

Telefon uygulamasında çalışmayanlar: sistem bildirimleri, PNG ve yedek dosyası indirme.

### Diğer platformlar

- **Windows `.exe`:** [Electron](https://www.electronjs.org) ya da [Tauri](https://tauri.app) ile paketlenebilir; henüz hazır değil.
- **iOS (App Store):** Mac, Xcode ve ücretli Apple geliştirici hesabı gerekir; alternatif yukarıdaki *Ana Ekrana Ekle*.

## Klasör yapısı

```
index.html              Sayfa iskeleti ve tüm pencereler
sw.js                   Çevrimdışı çalışma (service worker)
manifest.webmanifest    Kurulabilir uygulama tanımı
css/
  styles.css            Tasarım değişkenleri, temel stiller, sayfa düzeni
  themes.css            Renk temaları ve arka plan sahnesi renkleri
  components.css        Kart, buton, liste, form gibi parçalar
  effects.css           Cam yüzeyler, ışıltılı butonlar, animasyonlar
js/
  app.js                Giriş noktası: menü, sayfa geçişleri, modülleri başlatma
  state.js              Uygulamanın verisi ve onu değiştiren tüm fonksiyonlar
  storage.js            localStorage ile konuşan tek dosya (sürüm geçişleri burada)
  api.js                Sunucuyla konuşan tek dosya
  config.js             Sunucu adresi ve "telefon uygulamasında mıyız?" bilgisi
  data.js               Başlangıç verileri ve sabitler
  utils.js              Tarih, biçimlendirme ve DOM yardımcıları
  components.js         Sayfaların ortak kullandığı arayüz parçaları
  theme.js, sound.js    Görünüm ve bildirim sesleri
  modules/              Her sayfa için bir dosya
server/
  server.js             Express uygulaması ve güvenlik ayarları
  schema.sql            Veritabanı tabloları (açıklamalı)
  db.js                 Veritabanı bağlantısı
  auth.js               Kayıt, giriş, oturum, e-posta doğrulama
  mail.js               E-posta gönderme
  sync.js               Bulut yedeği ve istatistik sorguları
  boards.js             Ortak panolar, davetler, ortak görevler
api/index.js            Vercel giriş noktası
android/                Android projesi (Capacitor)
scripts/build-www.js    Mobil paket için web dosyalarını kopyalar
tests/                  Otomatik testler
```

## Güvenlik notları

- Parolalar düz metin saklanmaz; scrypt ile özetlenir.
- Tüm SQL sorguları parametrelidir (`?`); kullanıcı girdisi sorgu metnine yapıştırılmaz.
- Tarayıcıda oturum çerezi `HttpOnly` ve `SameSite=Lax`tır; veri değiştiren istekler özel bir başlık ister.
- Davetler e-posta adresine göre eşleştiği için, e-posta açıkken adresini doğrulamayan hesap davet göremez ve kabul edemez.
- Kullanıcı metinleri sayfaya `textContent` ile yazılır, HTML olarak çalıştırılmaz.
- `server/` klasörü ve veritabanı dosyası web üzerinden indirilemez.
- Veritabanı dosyası, `node_modules/`, `.vercel/` ve `.env` dosyaları `.gitignore` içindedir.

## Öğrenme notları

Kod, JavaScript ve SQL öğrenirken okunabilsin diye Türkçe yorumlarla yazıldı.

**JavaScript:** `js/utils.js` (tarihler), `js/state.js` (veri ve doğrulama), `js/modules/pomodoro.js` (gerçek zamana dayalı sayaç), `js/modules/kanban.js` ve `js/components.js` (sürükle-bırak), `js/modules/whiteboard.js` (canvas ve işaretçi olayları), `js/api.js` (fetch, async / await).

**SQL ve sunucu:**

1. Tablolar, veri tipleri, birincil ve yabancı anahtar: `server/schema.sql`
2. `SELECT`, `WHERE`, `ORDER BY`, `INSERT`, `UPDATE`, `DELETE`: `server/boards.js`
3. `JOIN` ve `GROUP BY`: `server/sync.js` içindeki `/stats`, `server/boards.js` içindeki `getMembers`
4. Çoka-çok ilişki (ara tablo): `schema.sql` içindeki `board_members`
5. İşlem (transaction): `server/db.js` içindeki `batch`
6. Parametreli sorgu ve SQL injection: `server/db.js` başındaki açıklama
7. Kimlik doğrulama ve yetkilendirme: `server/auth.js`, `boards.js` içindeki `requireMember`

Yerel veritabanını incelemek için [DB Browser for SQLite](https://sqlitebrowser.org) ile `server/data/planstrator.db` dosyasını açabilirsin.
