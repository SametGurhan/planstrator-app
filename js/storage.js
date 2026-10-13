// ==========================================================
// storage.js — localStorage ile konuşan TEK dosya
// Diğer dosyalar localStorage'a doğrudan dokunmaz. İleride veriler bir
// sunucuya (API + SQL) taşındığında yalnızca bu dosyayı değiştirmemiz yeter.
// ==========================================================

import { createDefaultCategories, createSampleTemplates } from "./data.js";

const STORAGE_KEY = "planstrator.data";
const BACKUP_KEY = "planstrator.data.backup";

// Veri yapısı değiştikçe bu sayıyı artırıyoruz (bkz. migrate).
//   1: yalnızca görevler
//   2: + kategoriler, kontrol listesi şablonları ve listeleri
//   3: + Pomodoro oturumları, ayarlar, zamanlayıcı durumu ve "Seyahat" kategorisi
//   4: + görevlerde durum (status), sıra (order) ve tekrar (recurrence) alanları
//   5: + hedefler, alışkanlıklar, alışkanlık kayıtları, notlar ve seyahatler
//   6: zamanlayıcının varsayılan modu "Serbest" oldu
export const DATA_VERSION = 6;

// Eski sürümde kaydedilmiş veriyi yeni yapıya uyarlar ("migration").
// Adımlar sırayla çalışır: sürüm 1 veri önce 2'ye, ileride 2'den 3'e... yükselir.
// Kullanıcının mevcut görevlerine dokunmuyoruz, yalnızca eksik bölümleri ekliyoruz.
function migrate(data) {
  if (data.version === undefined) data.version = 1;

  if (data.version === 1) {
    data.categories = createDefaultCategories();
    data.checklistTemplates = createSampleTemplates();
    data.checklistInstances = [];
    data.version = 2;
  }

  if (data.version === 2) {
    // Yeni bölümler boş başlar; state.js eksikleri varsayılanlarla doldurur.
    data.pomodoroSessions = [];
    data.settings = {};
    data.timer = null;

    // "Seyahat" kategorisi: kullanıcıda benzeri (Seyahat / Gezi) yoksa ekle.
    if (Array.isArray(data.categories)) {
      const hasTravel = data.categories.some(
        (category) => category !== null && typeof category === "object" && /seyahat|gezi/i.test(String(category.name)),
      );
      if (!hasTravel) {
        data.categories.push({ id: "cat-travel", name: "Seyahat", color: "#e0508a", icon: "✈️" });
      }
    }
    data.version = 3;
  }

  if (data.version === 3) {
    // Yeni görev alanlarının (status, order, recurrence) varsayılanlarını
    // state.js içindeki normalizeTask doldurur; burada yalnızca sürümü yükseltiyoruz.
    data.version = 4;
  }

  if (data.version === 4) {
    // Yeni bölümler boş başlar: kullanıcının verisine örnek kayıt karıştırmıyoruz.
    data.goals = [];
    data.habits = [];
    data.habitEntries = [];
    data.notes = [];
    data.trips = [];
    data.version = 5;
  }

  if (data.version === 5) {
    // Varsayılan zamanlayıcı modu artık "Serbest". Bekleyen (çalışmayan) bir zamanlayıcı varsa
    // yeni varsayılana geçsin; çalışan ya da duraklatılmış bir oturuma dokunmuyoruz.
    const timer = data.timer;
    if (timer !== null && typeof timer === "object" && timer.status !== "running" && timer.status !== "paused") {
      timer.mode = "custom";
    }
    data.version = 6;
  }
  return data;
}

// Kayıtlı veriyi okur. Sonuç her zaman { status, data } biçimindedir:
//   "ok"          -> veri okundu
//   "empty"       -> hiç kayıt yok (ilk açılış)
//   "corrupt"     -> kayıt bozuk (yedeği alındı)
//   "unavailable" -> localStorage kullanılamıyor (ör. gizli sekme kısıtı)
export function loadData() {
  let rawText;
  try {
    rawText = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return { status: "unavailable", data: null };
  }

  if (rawText === null) return { status: "empty", data: null };

  try {
    const parsed = JSON.parse(rawText); // metin -> nesne
    if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.tasks)) {
      throw new Error("Beklenmeyen veri yapısı");
    }
    return { status: "ok", data: migrate(parsed) };
  } catch (error) {
    console.error("Kayıtlı veri okunamadı:", error);
    // Bozuk veriyi silmek yerine yedek anahtarına kopyalıyoruz; belki kurtarılabilir.
    try {
      localStorage.setItem(BACKUP_KEY, rawText);
    } catch (backupError) {
      console.warn("Yedek alınamadı:", backupError);
    }
    return { status: "corrupt", data: null };
  }
}

// Veriyi kaydeder. Başarılıysa true, değilse false döner
// (ör. depolama alanı dolduğunda setItem hata fırlatır).
export function saveData(data) {
  try {
    // data içindeki tüm bölümleri (tasks, categories, ...) sürüm numarasıyla birlikte sakla.
    const payload = { version: DATA_VERSION, ...data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); // nesne -> metin
    return true;
  } catch (error) {
    console.error("Veri kaydedilemedi:", error);
    return false;
  }
}

// ---------- Küçük tercihler (tema modu, menü durumu) ----------
// Ana veriden ayrı, kendi anahtarlarında saklanır.

export function readPreference(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

export function savePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn("Tercih kaydedilemedi:", error);
  }
}

export function removePreference(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn("Tercih silinemedi:", error);
  }
}

// ---------- Beyaz tahta ----------
// Çizimler büyüyebildiği için ana veriden ayrı bir anahtarda tutulur;
// böylece her görev kaydında tüm çizim yeniden yazılmaz.
const WHITEBOARD_KEY = "planstrator.whiteboard";

export function loadWhiteboard() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WHITEBOARD_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Çizim okunamadı:", error);
    return [];
  }
}

export function saveWhiteboard(strokes) {
  try {
    localStorage.setItem(WHITEBOARD_KEY, JSON.stringify(strokes));
    return true;
  } catch (error) {
    console.error("Çizim kaydedilemedi:", error);
    return false;
  }
}

// ---------- Yedekleme ----------

// Tüm veriyi tek bir nesne olarak döndürür (dosyaya yazmak için).
export function exportAll() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    console.warn("Dışa aktarılacak veri okunamadı:", error);
  }
  return {
    app: "planstrator",
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    data: data,
    whiteboard: loadWhiteboard(),
  };
}

// Bir yedeğin bu uygulamaya ait ve kullanılabilir olup olmadığını denetler.
export function isValidBackup(backup) {
  return backup !== null && typeof backup === "object"
    && backup.app === "planstrator"
    && backup.data !== null && typeof backup.data === "object"
    && Array.isArray(backup.data.tasks);
}

// Yedeği yükler. Mevcut veri silinmeden önce yedek anahtarına kopyalanır.
// Başarılıysa true döner; çağıran taraf sayfayı yenilemelidir.
export function importAll(backup) {
  if (!isValidBackup(backup)) return false;
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== null) localStorage.setItem(BACKUP_KEY, current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(backup.data));
    if (Array.isArray(backup.whiteboard)) saveWhiteboard(backup.whiteboard);
    return true;
  } catch (error) {
    console.error("Yedek yüklenemedi:", error);
    return false;
  }
}
