// ==========================================================
// utils.js — Her yerde kullanılan küçük yardımcı fonksiyonlar
// ==========================================================

// ---------- TARİH YARDIMCILARI ----------
// Kural: Tarihleri "2026-10-13" gibi YYYY-AA-GG metni olarak saklıyoruz.
// Neden? Date nesnesi JSON'a çevrilirken UTC'ye döner ve Türkiye'de (UTC+3)
// gece yarısına yakın tarihler bir gün geriye kayabilir. Düz metin kaymaz.

// Date nesnesini yerel saate göre "YYYY-AA-GG" metnine çevirir.
export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // getMonth 0'dan başlar
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// "YYYY-AA-GG" metnini yerel saatte bir Date nesnesine çevirir.
export function parseDateKey(dateKey) {
  const parts = dateKey.split("-"); // ["2026", "10", "13"]
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

// Bir değer "YYYY-AA-GG" biçiminde metin mi? (Kayıtlı veriyi doğrularken kullanılır.)
export function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Benzersiz kimlik üretir: createId("t") -> "t-mgp3k2x1-8f3a1c"
// Şimdiki zaman + rastgele parça; aynı anda iki kayıt oluşsa bile çakışmaz.
export function createId(prefix) {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${timePart}-${randomPart}`;
}

export function todayKey() {
  return toDateKey(new Date());
}

// Bir tarihe gün ekler (negatif sayı verilirse çıkarır).
export function addDays(dateKey, amount) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

// O tarihi içeren haftanın pazartesisi.
// getDay(): Pazar=0, Pazartesi=1 ... Cumartesi=6. (getDay() + 6) % 7 ile Pazartesi=0 yapıyoruz.
export function startOfWeek(dateKey) {
  const daysSinceMonday = (parseDateKey(dateKey).getDay() + 6) % 7;
  return addDays(dateKey, -daysSinceMonday);
}

// "2026-10-13" -> "2026-10-01"
export function startOfMonth(dateKey) {
  return `${dateKey.slice(0, 8)}01`;
}

// Ayın ilk gününe ay ekler: addMonths("2026-10-13", 1) -> "2026-11-01"
export function addMonths(dateKey, amount) {
  const date = parseDateKey(startOfMonth(dateKey));
  date.setMonth(date.getMonth() + amount); // 12'yi geçerse yılı kendisi artırır
  return toDateKey(date);
}

// "Ekim 2026"
export function formatMonthYear(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
}

// "13 Eki"
export function formatDayMonth(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

// "09:30" -> 570 (gece yarısından beri geçen dakika)
export function timeToMinutes(time) {
  const parts = time.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

// 570 -> "09:30"
export function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Tekrarlanan görevin bir sonraki tarihi (tek adım).
function stepRecurrence(dateKey, rule) {
  if (rule === "daily") return addDays(dateKey, 1);
  if (rule === "weekly") return addDays(dateKey, 7);

  if (rule === "weekdays") {
    // Bir gün ilerle; cumartesi (6) ya da pazara (0) denk gelirse ilerlemeye devam et.
    let next = addDays(dateKey, 1);
    while ([0, 6].includes(parseDateKey(next).getDay())) {
      next = addDays(next, 1);
    }
    return next;
  }

  if (rule === "monthly") {
    // Sonraki ayın aynı günü. O ayda o gün yoksa (ör. 31 Şubat) ayın son günü.
    const day = parseDateKey(dateKey).getDate();
    const nextMonthStart = addMonths(dateKey, 1);
    const lastDay = parseDateKey(addDays(addMonths(nextMonthStart, 1), -1)).getDate();
    return `${nextMonthStart.slice(0, 8)}${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  }
  return dateKey;
}

// Sıradaki tekrar tarihi. Görev çok gecikmişse geçmişte kalan tekrarları atlar:
// sonuç her zaman bugün ya da sonrasıdır.
export function getNextRecurrence(dateKey, rule, today) {
  let next = stepRecurrence(dateKey, rule);
  let guard = 0; // sonsuz döngüye karşı emniyet
  while (next < today && guard < 1000) {
    next = stepRecurrence(next, rule);
    guard += 1;
  }
  return next;
}

// İki tarih arasındaki gün farkı (to - from).
export function daysBetween(fromKey, toKey) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((parseDateKey(toKey) - parseDateKey(fromKey)) / msPerDay);
}

// "13 Ekim 2026"
export function formatLongDate(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString("tr-TR", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// "Salı"
export function formatWeekday(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString("tr-TR", { weekday: "long" });
}

// "15 Eki Per"
export function formatShortDate(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString("tr-TR", {
    day: "numeric", month: "short", weekday: "short",
  });
}

// 95 -> "1 sa 35 dk"
export function formatMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} dk`;
  if (minutes === 0) return `${hours} sa`;
  return `${hours} sa ${minutes} dk`;
}

// 1500 -> "₺1.500"
export function formatMoney(amount) {
  return amount.toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
}

// Yüzde hesabı: bölen 0 ise 0 döner, sonuç 100'ü geçmez.
export function percent(part, total) {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

// ---------- ETİKET YARDIMCISI ----------

// "JavaScript, #ödev,  ödev" -> ["javascript", "ödev"]
// Virgülle ayırır, boşlukları ve # işaretini temizler, küçük harfe çevirir, tekrarları atar.
export function parseTags(text) {
  return String(text)
    .split(",")
    .map((tag) => tag.trim().replace(/^#/, "").toLocaleLowerCase("tr"))
    .filter((tag) => tag !== "")
    .filter((tag, index, list) => list.indexOf(tag) === index) // ilk görüldüğü yer burasıysa tut
    .slice(0, 8);
}

// ---------- DOM YARDIMCILARI ----------

// Bir <select> kutusunu seçeneklerle doldurur. İlk seçenek her zaman boş değerlidir.
// options: [{ value: "cat-work", label: "İş" }, ...]
export function fillSelect(select, options, emptyLabel) {
  const previousValue = select.value; // yeniden doldururken kullanıcının seçimini koru
  clear(select);

  const allOptions = [{ value: "", label: emptyLabel }, ...options];
  for (const item of allOptions) {
    const option = el("option", "", item.label);
    option.value = item.value;
    select.append(option);
  }

  select.value = previousValue;
  if (select.value !== previousValue) select.value = ""; // eski seçim artık yoksa boşa dön
}

// Kısa yoldan eleman oluşturur: el("p", "task__title", "Merhaba")
// Metni textContent ile yazdığımız için kullanıcı girdisi HTML olarak çalışmaz (güvenli).
export function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// index.html içindeki sprite'tan ikon oluşturur: icon("clock")
export function icon(name) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  const use = document.createElementNS(svgNamespace, "use");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

// Bir elemanın içini boşaltır.
export function clear(element) {
  element.replaceChildren();
}

// id ile eleman bulur; bulunamazsa konsola anlaşılır bir uyarı yazar.
export function byId(id) {
  const element = document.getElementById(id);
  if (!element) console.warn(`Eleman bulunamadı: #${id}`);
  return element;
}

// ---------- TOAST (uygulama içi bildirim) ----------
let toastTimer = null;

export function showToast(message) {
  const toast = byId("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  // popover: bildirimi tarayıcının "en üst katmanına" çıkarır; böylece açık bir
  // pencerenin (dialog) arkasında kalmaz. Kapatıp yeniden açmak en üste taşır.
  if (typeof toast.showPopover === "function") {
    if (toast.matches(":popover-open")) toast.hidePopover();
    toast.showPopover();
  }
  clearTimeout(toastTimer); // önceki zamanlayıcıyı iptal et, üst üste binmesin
  toastTimer = setTimeout(() => {
    if (typeof toast.hidePopover === "function" && toast.matches(":popover-open")) toast.hidePopover();
    toast.hidden = true;
  }, 3000);
}
