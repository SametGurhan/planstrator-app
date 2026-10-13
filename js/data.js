// ==========================================================
// data.js — Başlangıç verileri ve sabitler
// Görevler artık state.js üzerinden yönetilir ve localStorage'da saklanır.
// Buradaki başlangıç kayıtları yalnızca ilk açılışta (veya kullanıcı "sıfırla" derse) yüklenir.
// Her kurulum kendi cihazında, bu küçük karşılama kayıtlarıyla başlar.
// ==========================================================

import { todayKey, addDays } from "./utils.js";

const today = todayKey();

// Tarihleri "bugüne göre" üretiyoruz ki örnekler hangi gün açılırsa açılsın anlamlı olsun.
function day(offset) {
  return addDays(today, offset);
}

export const PRIORITY_LABELS = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

// Sıralamada kullanmak için: sayı küçükse daha önemli.
export const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };

// Görevin panodaki durumu (Kanban sütunları).
export const STATUS_LABELS = {
  todo: "Yapılacak",
  doing: "Devam ediyor",
  done: "Tamamlandı",
};

// Tekrarlanma kuralları.
export const RECURRENCE_LABELS = {
  none: "Tekrarlanmaz",
  daily: "Her gün",
  weekdays: "Hafta içi her gün",
  weekly: "Her hafta",
  monthly: "Her ay",
};

// Başlangıç kategorileri. Kullanıcı bunları Kategoriler sayfasından değiştirebilir.
export function createDefaultCategories() {
  return [
    { id: "cat-work", name: "İş", color: "#5457e0", icon: "💼" },
    { id: "cat-edu", name: "Eğitim", color: "#0ea5a4", icon: "📚" },
    { id: "cat-personal", name: "Kişisel", color: "#e0704a", icon: "🙂" },
    { id: "cat-health", name: "Sağlık", color: "#1f9d6b", icon: "💪" },
    { id: "cat-finance", name: "Finans", color: "#c9920a", icon: "💰" },
    { id: "cat-home", name: "Ev", color: "#8b5cf6", icon: "🏠" },
    { id: "cat-projects", name: "Projeler", color: "#3b82f6", icon: "🚀" },
    { id: "cat-travel", name: "Seyahat", color: "#e0508a", icon: "✈️" },
  ];
}

// Düz metin listesinden şablon nesnesi üretir (aşağıda tekrar tekrar yazmamak için).
function sampleTemplate(id, name, description, categoryId, itemTexts) {
  return {
    id: id,
    name: name,
    description: description,
    categoryId: categoryId,
    tags: [],
    items: itemTexts.map((text, index) => ({ id: `${id}-i${index + 1}`, text: text })),
  };
}

export function createSampleTemplates() {
  return [
    sampleTemplate("tpl-morning", "Sabah rutini", "Güne düzenli başlamak için", "cat-personal", ["Bir bardak su iç", "Yatağı topla", "10 dakika esneme", "Kahvaltı", "Günün planına göz at"]),
    sampleTemplate("tpl-evening", "Akşam rutini", "Günü kapatırken", "cat-personal", ["Yarının görevlerini belirle", "Çalışma masasını topla", "Ekranları kapat", "20 dakika kitap oku"]),
    sampleTemplate("tpl-weekly", "Haftalık planlama", "Her pazar akşamı", "cat-personal", ["Geçen haftayı gözden geçir", "Geciken görevleri yeniden planla", "Haftanın 3 ana hedefini yaz", "Takvimi kontrol et"]),
    sampleTemplate("tpl-study", "Ders çalışma hazırlığı", "Odaklanmadan önce", "cat-edu", ["Telefonu sessize al", "Su ve not defterini hazırla", "Çalışılacak konuyu belirle", "Pomodoro zamanlayıcısını kur"]),
    sampleTemplate("tpl-release", "Proje yayına alma", "Yayından önce son kontroller", "cat-projects", ["Tüm sayfaları test et", "Konsolda hata olmadığını doğrula", "Mobil görünümü kontrol et", "Yedek al", "Yayına al ve canlıda dene"]),
    sampleTemplate("tpl-shopping", "Alışveriş listesi", "Temel ihtiyaçlar", "cat-home", ["Ekmek", "Süt", "Yumurta", "Meyve ve sebze", "Temizlik malzemesi"]),
    sampleTemplate("tpl-cleaning", "Ev temizliği", "Haftalık temizlik", "cat-home", ["Toz al", "Süpür", "Banyoyu temizle", "Çöpleri at", "Çamaşırları yıka"]),
    sampleTemplate("tpl-travel", "Seyahat hazırlığı", "Yola çıkmadan önce", "cat-travel", ["Kimlik ve biletleri kontrol et", "Konaklama onayını kaydet", "Şarj aletleri ve powerbank", "Kıyafetleri hazırla", "İlaçlar ve kişisel bakım", "Evdeki fişleri çek"]),
  ];
}

// Görev modeli: ileride SQL tablosundaki bir satıra karşılık gelecek.
// categoryId -> categories içindeki bir kaydın id'si (ilişki kimlikle kurulur).
// Fonksiyon olmasının nedeni: her çağrıda YENİ bir dizi üretir.
// Böylece "örnek verilere sıfırla" dendiğinde temiz bir kopya elde ederiz.
export function createSampleTasks() {
  // Yalnızca iki karşılama görevi: uygulamayı kuran herkes bunlarla başlar,
  // gerisini kendi doldurur. (Kimsenin verisi başkasına görünmez; veri cihazda durur.)
  return [
    { id: "welcome-1", title: "Planstrator'a hoş geldin! Bu görevi tamamlandı olarak işaretle", description: "Soldaki kutuya tıklaman yeterli.", priority: "normal", categoryId: "cat-personal", dueDate: day(0), tags: [], createdAt: day(0) },
    { id: "welcome-2", title: "İlk kendi görevini ekle", description: "Dashboard'daki hızlı ekleme kutusunu ya da Görevler sayfasındaki \"Yeni görev\" düğmesini kullan.", priority: "normal", categoryId: "cat-personal", dueDate: day(0), tags: [], createdAt: day(0) },
  ];
}

export function createSampleSessions() {
  return []; // oturum geçmişi boş başlar; ilk Pomodoro'nu sen tamamlarsın
}

// Varsayılan ayarlar. Kullanıcı Pomodoro sayfasından değiştirebilir.
export const DEFAULT_SETTINGS = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  customSeconds: 45 * 60, // "Serbest" modda kullanıcının yazdığı süre (saniye cinsinden)
  sessionsBeforeLongBreak: 4,
  dailyPomodoroGoal: 6,
  dailyFocusGoalMinutes: 120,
  soundEnabled: true,
  soundType: "chime",
  soundVolume: 80, // 0-100
  displayName: "",       // kullanıcının adı (selamlama ve üstteki simge için; hesap yoksa buradan okunur)
  accentTheme: "blue",  // renk teması (bkz. css/themes.css)
  background: "waves",  // arka plan sahnesi (bkz. modules/background.js)
};

export const ACCENT_LABELS = {
  blue: "Mavi",
  violet: "Mor",
  green: "Yeşil",
  sunset: "Gün batımı",
  rose: "Pembe",
};

export const BACKGROUND_LABELS = {
  waves: "Dalga",
  forest: "Orman",
  river: "Nehirli orman",
  none: "Sade",
};

export const SOUND_LABELS = {
  chime: "Zil",
  beep: "Bip",
  melody: "Melodi",
  alarm: "Alarm",
};

export const MODE_LABELS = {
  focus: "Odaklanma",
  shortBreak: "Kısa mola",
  longBreak: "Uzun mola",
  custom: "Serbest çalışma", // Pomodoro döngüsünün dışında, istenen sürede sayaç
};

// ---------- Hedef, alışkanlık, not ve seyahat: boş başlar (tek bir karşılama notu hariç) ----------

export function createSampleGoals() {
  return [];
}

export function createSampleHabits() {
  return [];
}

export function createSampleHabitEntries() {
  return [];
}

export function createSampleNotes() {
  return [
    { id: "welcome-note", title: "Hoş geldin", content: "Planstrator'da görevlerini, zamanını ve hedeflerini tek yerden yönetebilirsin.\n\nBaşlamak için birkaç fikir:\n- Dashboard'dan bugüne bir görev ekle\n- Pomodoro'da 25 dakikalık bir odak seansı başlat\n- Ayarlar'dan renk temasını ve arka planı seç\n\nBu notu silebilirsin.", categoryId: null, taskId: null, updatedAt: Date.now() },
  ];
}

export function createSampleTrips() {
  return [];
}
