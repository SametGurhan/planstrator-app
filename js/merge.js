// ==========================================================
// merge.js — İki cihazın verisini birleştirme kuralları (eşitleme için)
//
// Bu dosya ekrana ya da sunucuya dokunmaz; yalnızca nesne alır, nesne döndürür.
// Böyle "saf" fonksiyonlar tarayıcı olmadan da kolayca test edilebilir.
//
// Birleştirmenin anahtarı "bu cihazda NE değişti?" bilgisidir (changes). Her yerel kayıtta
// önceki ve yeni veri karşılaştırılır, değişen kayıtların id'leri not edilir:
//   { tasks: ["id1", "id2"], settings: true }
//   liste bölümlerinde: değişen / eklenen / silinen kayıtların id'leri
//   nesne bölümlerinde (ayarlar): değişen alanların adları -> { settings: ["accentTheme"] }
//   diğerlerinde: true = bu bölüm değişti
// changes === null: neyin değiştiği bilinmiyor (cihaz hesaba ilk kez bağlanıyor) -> hepsi değişmiş say.
// ==========================================================

// Yalnızca bu cihaza ait bölümler: başka cihazdan gelen veri bunların üzerine yazmaz.
// Örnek: bilgisayarda çalışan bir Pomodoro sayacı, telefondaki bir değişiklik yüzünden durmamalı.
const DEVICE_ONLY_KEYS = ["timer"];

// Değişiklik takibine girmeyen bölümler (veri sürümü numarası gibi).
const IGNORED_KEYS = ["version"];

// Liste kimlikli kayıtlardan mı oluşuyor? ({ id: "..." } biçiminde)
function isIdList(value) {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === "object" && typeof item.id === "string");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------- DEĞİŞİKLİKLERİ BULMA ----------------

// Bir listede değişen, eklenen ve silinen kayıtların id'leri.
function changedIds(previousList, currentList) {
  const previousById = new Map(previousList.map((item) => [item.id, item]));
  const currentIds = new Set();
  const ids = [];
  for (const item of currentList) {
    currentIds.add(item.id);
    if (!same(previousById.get(item.id), item)) ids.push(item.id); // yeni ya da değişmiş
  }
  for (const item of previousList) {
    if (!currentIds.has(item.id)) ids.push(item.id); // silinmiş
  }
  return ids;
}

// previous -> current arasındaki farkları changes nesnesine EKLER ve yeni nesneyi döndürür.
export function findChanges(previous, current, changes) {
  if (changes === null) return null; // zaten "hepsi değişmiş" sayılıyor
  const result = { ...changes };
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(current)]);

  for (const key of keys) {
    if (IGNORED_KEYS.includes(key)) continue;
    const before = previous ? previous[key] : undefined;
    const after = current[key];
    if (same(before, after) || result[key] === true) continue;

    if (isIdList(before) && isIdList(after)) {
      const ids = new Set([...(result[key] || []), ...changedIds(before, after)]);
      if (ids.size > 0) result[key] = [...ids];
    } else if (isPlainObject(before) && isPlainObject(after)) {
      // Ayarlar gibi nesnelerde hangi alanların değiştiğini not et.
      const fields = new Set(result[key] || []);
      for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!same(before[field], after[field])) fields.add(field);
      }
      if (fields.size > 0) result[key] = [...fields];
    } else {
      result[key] = true;
    }
  }
  return result;
}

export function hasChanges(changes) {
  return changes === null || Object.keys(changes).length > 0;
}

// ---------------- BİRLEŞTİRME ----------------

// Liste birleştirme: bu cihazda değişen kayıtlarda bu cihazdaki hali, diğerlerinde sunucudaki hali.
//   Burada silinen kayıt   -> silinir
//   Sunucuda silinen kayıt -> burada değişmediyse silinir, değiştiyse kalır
//   İki yerde eklenenler   -> hepsi kalır
function mergeList(mine, theirs, myChangedIds) {
  const mineById = new Map(mine.map((item) => [item.id, item]));
  const theirIds = new Set(theirs.map((item) => item.id));
  const result = [];

  for (const item of theirs) {
    if (!myChangedIds.has(item.id)) {
      result.push(item);
    } else if (mineById.has(item.id)) {
      result.push(mineById.get(item.id));
    }
    // değişmiş ama bende yok: bu cihazda silinmiş -> ekleme
  }
  for (const item of mine) {
    if (!theirIds.has(item.id) && myChangedIds.has(item.id)) result.push(item); // bu cihazda eklenmiş
  }
  return result;
}

// Kimlik bilgisi olmadan birleştirme (changes === null): hiçbir kayıt kaybolmaz,
// ikisinde de olanlarda bu cihazdaki geçerli.
function unionList(mine, theirs) {
  const mineById = new Map(mine.map((item) => [item.id, item]));
  const theirIds = new Set(theirs.map((item) => item.id));
  const result = theirs.map((item) => mineById.get(item.id) || item);
  for (const item of mine) {
    if (!theirIds.has(item.id)) result.push(item);
  }
  return result;
}

// İKİ CİHAZDA DA DEĞİŞİKLİK VARSA: sunucudaki veriye bu cihazdaki değişiklikleri uygular.
export function mergeData(local, remote, changes) {
  const result = { ...remote };
  for (const key of Object.keys(local)) {
    const mine = local[key];
    const theirs = remote[key];
    const changed = changes === null ? true : changes[key];

    if (DEVICE_ONLY_KEYS.includes(key) || !(key in remote)) {
      result[key] = mine;
    } else if (!changed) {
      result[key] = theirs; // bu cihazda dokunulmamış: sunucudaki geçerli
    } else if (isIdList(mine) && isIdList(theirs)) {
      result[key] = Array.isArray(changed) ? mergeList(mine, theirs, new Set(changed)) : unionList(mine, theirs);
    } else if (isPlainObject(mine) && isPlainObject(theirs) && Array.isArray(changed)) {
      // Yalnızca bu cihazda değişen alanlar buradan, gerisi sunucudan.
      result[key] = { ...theirs };
      for (const field of changed) {
        if (field in mine) result[key][field] = mine[field];
      }
    } else {
      result[key] = mine;
    }
  }
  return result;
}

// YALNIZCA SUNUCUDA DEĞİŞİKLİK VARSA: sunucudakini alır, bu cihaza özel bölümleri korur.
export function takeRemote(local, remote) {
  const result = { ...remote };
  for (const key of DEVICE_ONLY_KEYS) {
    if (key in local) result[key] = local[key];
  }
  return result;
}
