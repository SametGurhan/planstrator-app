// ==========================================================
// state.js — Uygulamanın verisi ve onu değiştiren fonksiyonlar
//
// Kural: Veriyi değiştirmek isteyen HER dosya buradaki fonksiyonları kullanır.
// Böylece doğrulama ve kaydetme tek yerde yapılır, hiçbir değişiklik kaydedilmeden kalmaz.
//
// Bölümler: 1) Ortak yardımcılar  2) Başlatma  3) Görevler
//           4) Kategoriler ve etiketler  5) Kontrol listeleri  6) Pomodoro
//           7) Hedefler, alışkanlıklar, notlar, seyahatler
// ==========================================================

import { loadData, saveData } from "./storage.js";
import {
  createSampleTasks, createDefaultCategories, createSampleTemplates, createSampleSessions,
  createSampleGoals, createSampleHabits, createSampleHabitEntries, createSampleNotes, createSampleTrips,
  PRIORITY_LABELS, STATUS_LABELS, RECURRENCE_LABELS, DEFAULT_SETTINGS, MODE_LABELS, SOUND_LABELS, ACCENT_LABELS, BACKGROUND_LABELS,
} from "./data.js";
import { todayKey, toDateKey, isDateKey, createId, parseTags, showToast, getNextRecurrence, formatShortDate } from "./utils.js";

const TITLE_MAX_LENGTH = 120;
const NAME_MAX_LENGTH = 40;
const ITEM_MAX_LENGTH = 200;
const MINUTES_MAX = 1440; // 24 saat
const DEFAULT_COLOR = "#2563eb";

let tasks = [];
let categories = [];
let checklistTemplates = [];
let checklistInstances = [];
let pomodoroSessions = [];
let settings = { ...DEFAULT_SETTINGS };
let timer = null; // zamanlayıcının durumu (bkz. bölüm 6)

// ==========================================================
// 1) ORTAK YARDIMCILAR
// ==========================================================

function persist() {
  const saved = saveData({
    tasks: tasks,
    categories: categories,
    checklistTemplates: checklistTemplates,
    checklistInstances: checklistInstances,
    pomodoroSessions: pomodoroSessions,
    settings: settings,
    timer: timer,
    goals: goalStore.all(),
    habits: habitStore.all(),
    habitEntries: habitEntries,
    notes: noteStore.all(),
    trips: tripStore.all(),
  });
  if (!saved) showToast("Değişiklik bu tarayıcıya kaydedilemedi.");
}

// Bir kaydın geçerli sayılması için en az id'si ve adı (ya da başlığı) olmalı.
function hasIdAndText(raw, fieldName) {
  return raw !== null && typeof raw === "object"
    && typeof raw.id === "string" && raw.id !== ""
    && typeof raw[fieldName] === "string" && raw[fieldName].trim() !== "";
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanId(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

// Diziyi güvenle okur: dizi değilse boş dizi döner.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Alt görev / liste maddesi: { id, text, done }
function normalizeItems(rawList) {
  return asArray(rawList)
    .filter((raw) => raw !== null && typeof raw === "object" && cleanText(raw.text, ITEM_MAX_LENGTH) !== "")
    .map((raw) => ({
      id: cleanId(raw.id) || createId("i"),
      text: cleanText(raw.text, ITEM_MAX_LENGTH),
      done: raw.done === true,
    }));
}

// ==========================================================
// 2) BAŞLATMA
// ==========================================================

function loadSampleData() {
  tasks = createSampleTasks().map(normalizeTask);
  categories = createDefaultCategories().map(normalizeCategory);
  checklistTemplates = createSampleTemplates().map(normalizeTemplate);
  checklistInstances = [];
  pomodoroSessions = createSampleSessions().map(normalizeSession);
  settings = { ...DEFAULT_SETTINGS };
  timer = normalizeTimer(null);
  goalStore.load(createSampleGoals());
  habitStore.load(createSampleHabits());
  loadHabitEntries(createSampleHabitEntries());
  noteStore.load(createSampleNotes());
  tripStore.load(createSampleTrips());
}

// Uygulama açılırken bir kez çağrılır. Okuma durumunu döndürür ("ok", "empty", ...).
export function initState() {
  const result = loadData();

  if (result.status === "ok") {
    // Kullanıcının verisi var: örnek verilerle ASLA üzerine yazmıyoruz.
    const data = result.data;
    tasks = asArray(data.tasks).filter((raw) => hasIdAndText(raw, "title")).map(normalizeTask);
    categories = asArray(data.categories).filter((raw) => hasIdAndText(raw, "name")).map(normalizeCategory);
    checklistTemplates = asArray(data.checklistTemplates).filter((raw) => hasIdAndText(raw, "name")).map(normalizeTemplate);
    checklistInstances = asArray(data.checklistInstances).filter((raw) => hasIdAndText(raw, "name")).map(normalizeInstance);
    // Sıra önemli: zamanlayıcı süreleri ayarlardan okur, bu yüzden önce ayarlar.
    settings = normalizeSettings(data.settings);
    pomodoroSessions = asArray(data.pomodoroSessions).filter(isValidSession).map(normalizeSession);
    timer = normalizeTimer(data.timer);
    goalStore.load(data.goals);
    habitStore.load(data.habits);
    loadHabitEntries(data.habitEntries);
    noteStore.load(data.notes);
    tripStore.load(data.trips);
  } else {
    // İlk açılış ya da okunamayan veri: örnek verilerle başla.
    loadSampleData();
    persist();
  }
  return result.status;
}

// Tüm veriyi silip örnekleri geri yükler. Yalnızca kullanıcının açık onayıyla çağrılmalı.
export function resetToSampleData() {
  loadSampleData();
  persist();
}

// ==========================================================
// 3) GÖREVLER
// ==========================================================

// Eksik veya hatalı alanları varsayılan değerlerle doldurur.
// Böylece uygulamanın geri kalanı her görevde tüm alanların bulunduğuna güvenebilir.
function normalizeTask(raw) {
  const minutes = Number(raw.estimatedMinutes);
  const spent = Number(raw.spentMinutes);
  const order = Number(raw.order);

  // "Tamamlandı" bilgisi iki yerde durur: completed (evet/hayır) ve status (pano sütunu).
  // İkisinin çelişmemesi için kural: completed doğruysa durum her zaman "done"dur.
  const completed = raw.completed === true;
  let status = raw.status in STATUS_LABELS ? raw.status : "todo";
  if (completed) {
    status = "done";
  } else if (status === "done") {
    status = "todo";
  }

  return {
    id: raw.id,
    title: cleanText(raw.title, TITLE_MAX_LENGTH),
    description: cleanText(raw.description, 1000),
    completed: completed,
    status: status,
    order: Number.isFinite(order) ? order : 0, // panoda sütun içindeki sıra (küçük olan üstte)
    recurrence: raw.recurrence in RECURRENCE_LABELS ? raw.recurrence : "none",
    priority: raw.priority in PRIORITY_LABELS ? raw.priority : "normal",
    categoryId: cleanId(raw.categoryId),
    dueDate: isDateKey(raw.dueDate) ? raw.dueDate : "",
    startTime: typeof raw.startTime === "string" ? raw.startTime : "",
    estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
    spentMinutes: Number.isFinite(spent) && spent > 0 ? Math.round(spent) : 0,
    tags: parseTags(asArray(raw.tags).join(",")),
    subtasks: normalizeItems(raw.subtasks),
    createdAt: isDateKey(raw.createdAt) ? raw.createdAt : todayKey(),
    completedAt: isDateKey(raw.completedAt) ? raw.completedAt : null,
  };
}

// Formdan gelen girdiyi kontrol eder. Hata yoksa boş nesne {} döner.
// Örnek sonuç: { title: "Başlık boş olamaz." }
export function validateTaskInput(input) {
  const errors = {};
  const title = String(input.title).trim();

  if (title === "") {
    errors.title = "Başlık boş olamaz.";
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.title = `Başlık en fazla ${TITLE_MAX_LENGTH} karakter olabilir.`;
  }

  if (input.dueDate !== "" && !isDateKey(input.dueDate)) {
    errors.dueDate = "Geçerli bir tarih seç.";
  } else if (input.dueDate === "" && input.recurrence !== undefined && input.recurrence !== "none") {
    errors.dueDate = "Tekrarlanan görev için bir tarih seç.";
  }

  if (input.estimatedMinutes !== "") {
    const minutes = Number(input.estimatedMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_MAX) {
      errors.estimatedMinutes = `Süre 0 ile ${MINUTES_MAX} dakika arasında tam sayı olmalı.`;
    }
  }

  return errors;
}

export function getTasks() {
  return tasks;
}

export function getTaskById(taskId) {
  return tasks.find((task) => task.id === taskId);
}

// Panoda sütun içi sıralama: önce order, eşitse eski görev üstte.
export function compareTaskOrder(a, b) {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
}

// Bir göreve değişiklikleri uygular ve YENİ halini döndürür (henüz kaydetmez).
// status ve completed alanlarından hangisi değiştiyse diğerini ona uydurur.
function buildTask(oldTask, changes) {
  // { ...a, ...b } -> a'nın alanlarını kopyala, b'dekileri üstüne yaz (spread).
  const merged = { ...oldTask, ...changes, id: oldTask.id };

  if ("status" in changes && !("completed" in changes)) {
    merged.completed = changes.status === "done";
  }
  if ("completed" in changes && !("status" in changes)) {
    if (changes.completed) {
      merged.status = "done";
    } else if (oldTask.status === "done") {
      merged.status = "todo"; // tamamlanmış görev yeniden açıldı
    }
  }
  // Tamamlanma tarihi: ilk tamamlandığı gün korunur; yeniden açılınca silinir.
  merged.completedAt = merged.completed === true ? oldTask.completedAt || todayKey() : null;

  return normalizeTask(merged);
}

// Tekrarlanan bir görev "yeni tamamlandıysa" sıradaki tekrarını oluşturur.
// Seri yeni görevle devam eder; tamamlanan görev geçmiş kaydı olarak kalır ve
// tekrarlanmaz olarak işaretlenir (yeniden açılıp kapatılırsa ikinci kopya üremesin diye).
function continueRecurrence(oldTask, updatedTask) {
  const justCompleted = !oldTask.completed && updatedTask.completed;
  if (!justCompleted || updatedTask.recurrence === "none" || updatedTask.dueDate === "") {
    return updatedTask;
  }

  const nextTask = normalizeTask({
    ...updatedTask,
    id: createId("t"),
    completed: false,
    status: "todo",
    completedAt: null,
    spentMinutes: 0,
    createdAt: todayKey(),
    order: Date.now(),
    dueDate: getNextRecurrence(updatedTask.dueDate, updatedTask.recurrence, todayKey()),
    // Alt görevler işaretsiz, yeni kimliklerle kopyalanır.
    subtasks: updatedTask.subtasks.map((subtask) => ({ id: "", text: subtask.text, done: false })),
  });
  tasks.push(nextTask);
  showToast(`Tekrarlanan görev: sıradaki ${formatShortDate(nextTask.dueDate)} için oluşturuldu.`);

  return { ...updatedTask, recurrence: "none" };
}

export function addTask(input) {
  const blankTask = { id: createId("t"), createdAt: todayKey(), completed: false, completedAt: null, status: "todo" };
  // order: şimdiki zaman damgası büyük bir sayıdır, yeni görev sütunun sonuna düşer.
  const task = continueRecurrence(blankTask, buildTask(blankTask, { ...input, order: Date.now() }));
  tasks.push(task);
  persist();
  return task;
}

export function updateTask(taskId, changes) {
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return null; // böyle bir görev yok

  const oldTask = tasks[index];
  tasks[index] = continueRecurrence(oldTask, buildTask(oldTask, changes));
  persist();
  return tasks[index];
}

export function deleteTask(taskId) {
  tasks = tasks.filter((task) => task.id !== taskId);
  persist();
}

// Tamamlandı <-> tamamlanmadı
export function toggleTask(taskId) {
  const task = getTaskById(taskId);
  if (!task) return null;
  return updateTask(taskId, { completed: !task.completed });
}

// Panoda bir kartı taşır: durumunu değiştirir ve hedef sütundaki yerini ayarlar.
// beforeTaskId: kart hangi görevin ÖNÜNE gelecek? null ise sütunun sonuna eklenir.
export function moveTask(taskId, status, beforeTaskId) {
  const oldTask = getTaskById(taskId);
  if (!oldTask) return;
  const movedTask = continueRecurrence(oldTask, buildTask(oldTask, { status: status }));

  // Hedef sütunun (taşınan kart hariç) sıralı hali
  const column = tasks.filter((task) => task.status === status && task.id !== taskId).sort(compareTaskOrder);

  let position = column.findIndex((task) => task.id === beforeTaskId);
  if (position === -1) position = column.length;
  column.splice(position, 0, movedTask); // kartı araya yerleştir

  // Sütundaki herkese yeni sıra numarası ver: 0, 1, 2, ...
  const orderById = {};
  column.forEach((task, index) => {
    orderById[task.id] = index;
  });

  tasks = tasks.map((task) => {
    if (task.id === taskId) return { ...movedTask, order: orderById[taskId] };
    if (task.id in orderById) return { ...task, order: orderById[task.id] };
    return task;
  });
  persist();
}

// ==========================================================
// 4) KATEGORİLER VE ETİKETLER
// ==========================================================

function normalizeCategory(raw) {
  const isHexColor = typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color);
  return {
    id: raw.id,
    name: cleanText(raw.name, NAME_MAX_LENGTH),
    color: isHexColor ? raw.color : DEFAULT_COLOR,
    icon: cleanText(raw.icon, 16), // bazı emojiler birkaç karakterden oluşur (ör. 👨‍👩‍👧)
  };
}

// ignoreId: düzenleme sırasında kategorinin kendi adıyla çakışmasını saymamak için.
export function validateCategoryInput(input, ignoreId) {
  const errors = {};
  const name = String(input.name).trim();

  if (name === "") {
    errors.name = "Kategori adı boş olamaz.";
  } else if (name.length > NAME_MAX_LENGTH) {
    errors.name = `Ad en fazla ${NAME_MAX_LENGTH} karakter olabilir.`;
  } else {
    const lowerName = name.toLocaleLowerCase("tr");
    const duplicate = categories.find(
      (category) => category.id !== ignoreId && category.name.toLocaleLowerCase("tr") === lowerName,
    );
    if (duplicate) errors.name = "Bu adda bir kategori zaten var.";
  }
  return errors;
}

export function getCategories() {
  return categories;
}

export function getCategoryById(categoryId) {
  return categories.find((category) => category.id === categoryId);
}

export function countTasksInCategory(categoryId) {
  return tasks.filter((task) => task.categoryId === categoryId).length;
}

export function addCategory(input) {
  const category = normalizeCategory({ ...input, id: createId("cat") });
  categories.push(category);
  persist();
  return category;
}

export function updateCategory(categoryId, changes) {
  const index = categories.findIndex((category) => category.id === categoryId);
  if (index === -1) return null;
  categories[index] = normalizeCategory({ ...categories[index], ...changes, id: categoryId });
  persist();
  return categories[index];
}

// Kategoriyi siler. İçindeki görevler SİLİNMEZ:
// moveToCategoryId verilirse oraya taşınır, verilmezse (null) kategorisiz kalır.
export function deleteCategory(categoryId, moveToCategoryId) {
  const target = moveToCategoryId || null;

  tasks = tasks.map((task) => (task.categoryId === categoryId ? { ...task, categoryId: target } : task));
  checklistTemplates = checklistTemplates.map(
    (template) => (template.categoryId === categoryId ? { ...template, categoryId: target } : template),
  );
  categories = categories.filter((category) => category.id !== categoryId);
  persist();
}

// Etiketler ayrı bir listede tutulmuyor; görevlerde kullanılanlardan türetiliyor.
// (Aşama 8'de SQL'e geçerken ayrı bir "tags" tablosuna dönüşecek.)
export function getAllTags() {
  const allTags = [];
  for (const task of tasks) {
    for (const tag of task.tags) {
      if (!allTags.includes(tag)) allTags.push(tag);
    }
  }
  return allTags.sort((a, b) => a.localeCompare(b, "tr"));
}

// ==========================================================
// 5) KONTROL LİSTELERİ
// Şablon (template): tekrar kullanılan kalıp. Maddeleri: { id, text }
// Liste (instance):  şablondan üretilen, işaretlenebilen kopya. Maddeleri: { id, text, done }
// ==========================================================

function normalizeTemplate(raw) {
  return {
    id: raw.id,
    name: cleanText(raw.name, NAME_MAX_LENGTH),
    description: cleanText(raw.description, 200),
    categoryId: cleanId(raw.categoryId),
    tags: parseTags(asArray(raw.tags).join(",")),
    // Şablonda "done" bilgisi tutmuyoruz; yalnızca id ve metin.
    items: normalizeItems(raw.items).map((item) => ({ id: item.id, text: item.text })),
  };
}

function normalizeInstance(raw) {
  return {
    id: raw.id,
    templateId: cleanId(raw.templateId),
    name: cleanText(raw.name, NAME_MAX_LENGTH),
    date: isDateKey(raw.date) ? raw.date : "",
    items: normalizeItems(raw.items),
    createdAt: isDateKey(raw.createdAt) ? raw.createdAt : todayKey(),
  };
}

export function validateTemplateInput(input) {
  const errors = {};
  const name = String(input.name).trim();

  if (name === "") {
    errors.name = "Şablon adı boş olamaz.";
  } else if (name.length > NAME_MAX_LENGTH) {
    errors.name = `Ad en fazla ${NAME_MAX_LENGTH} karakter olabilir.`;
  }
  if (normalizeItems(input.items).length === 0) {
    errors.items = "En az bir madde ekle.";
  }
  return errors;
}

// ---- Şablonlar ----

export function getTemplates() {
  return checklistTemplates;
}

export function getTemplateById(templateId) {
  return checklistTemplates.find((template) => template.id === templateId);
}

export function addTemplate(input) {
  const template = normalizeTemplate({ ...input, id: createId("tpl") });
  checklistTemplates.push(template);
  persist();
  return template;
}

export function updateTemplate(templateId, changes) {
  const index = checklistTemplates.findIndex((template) => template.id === templateId);
  if (index === -1) return null;
  checklistTemplates[index] = normalizeTemplate({ ...checklistTemplates[index], ...changes, id: templateId });
  persist();
  return checklistTemplates[index];
}

// Şablonu siler. Ondan daha önce üretilmiş listeler bağımsız kopyalar olduğu için etkilenmez.
export function deleteTemplate(templateId) {
  checklistTemplates = checklistTemplates.filter((template) => template.id !== templateId);
  persist();
}

// Şablonun maddelerini KOPYALAR: her madde için yepyeni bir nesne ve yeni bir id üretir.
// Bu yüzden kopyada yapılan değişiklik (işaretleme, silme, ekleme) şablonu etkilemez.
export function copyTemplateItems(templateId) {
  const template = getTemplateById(templateId);
  if (!template) return [];
  return template.items.map((item) => ({ id: createId("i"), text: item.text, done: false }));
}

// ---- Listeler ----

export function getInstances() {
  return checklistInstances;
}

export function createInstanceFromTemplate(templateId, options) {
  const template = getTemplateById(templateId);
  if (!template) return null;

  const instance = normalizeInstance({
    id: createId("cl"),
    templateId: template.id,
    name: options.name || template.name,
    date: options.date,
    items: copyTemplateItems(templateId),
    createdAt: todayKey(),
  });
  checklistInstances.push(instance);
  persist();
  return instance;
}

// Tek bir listeyi bulup değiştiren ortak yardımcı.
// changeItems: eski madde dizisini alır, YENİ madde dizisini döndürür.
function updateInstanceItems(instanceId, changeItems) {
  const index = checklistInstances.findIndex((instance) => instance.id === instanceId);
  if (index === -1) return;
  const instance = checklistInstances[index];
  checklistInstances[index] = { ...instance, items: normalizeItems(changeItems(instance.items)) };
  persist();
}

export function toggleInstanceItem(instanceId, itemId) {
  updateInstanceItems(instanceId, (items) =>
    items.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item)));
}

export function addInstanceItem(instanceId, text) {
  updateInstanceItems(instanceId, (items) => [...items, { id: createId("i"), text: text, done: false }]);
}

export function deleteInstanceItem(instanceId, itemId) {
  updateInstanceItems(instanceId, (items) => items.filter((item) => item.id !== itemId));
}

// Tüm işaretleri kaldırır (liste yeniden kullanılabilir).
export function resetInstance(instanceId) {
  updateInstanceItems(instanceId, (items) => items.map((item) => ({ ...item, done: false })));
}

export function deleteInstance(instanceId) {
  checklistInstances = checklistInstances.filter((instance) => instance.id !== instanceId);
  persist();
}

// ==========================================================
// 6) POMODORO
// settings: süreler ve hedefler
// pomodoroSessions: tamamlanan oturumların kaydı
// timer: zamanlayıcının o anki durumu (sayfa yenilense de kaldığı yerden sürmesi için saklanır)
// ==========================================================

// Her ayarın izin verilen aralığı: [en az, en çok]
const SETTING_LIMITS = {
  focusMinutes: [1, 180],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 120],
  customSeconds: [1, 12 * 60 * 60], // 1 saniye - 12 saat
  sessionsBeforeLongBreak: [2, 10],
  dailyPomodoroGoal: [1, 20],
  dailyFocusGoalMinutes: [10, 720],
  soundVolume: [0, 100],
};

const SETTING_NAMES = {
  focusMinutes: "Odaklanma süresi",
  shortBreakMinutes: "Kısa mola",
  longBreakMinutes: "Uzun mola",
  customSeconds: "Serbest süre (saniye)",
  sessionsBeforeLongBreak: "Uzun mola öncesi seans sayısı",
  dailyPomodoroGoal: "Günlük seans hedefi",
  dailyFocusGoalMinutes: "Günlük odak hedefi",
  soundVolume: "Ses seviyesi",
};

// Hangi mod hangi ayardaki süreyi kullanır?
// Pomodoro modları dakika, serbest mod saniye cinsinden saklanır.
const MODE_SETTING_KEYS = {
  focus: "focusMinutes",
  shortBreak: "shortBreakMinutes",
  longBreak: "longBreakMinutes",
  custom: "customSeconds",
};

function isInRange(value, limits) {
  return Number.isInteger(value) && value >= limits[0] && value <= limits[1];
}

// Geçersiz ya da eksik her ayar için varsayılan değeri kullanır.
function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  const result = { ...DEFAULT_SETTINGS };

  for (const key in SETTING_LIMITS) {
    const value = Number(source[key]);
    if (isInRange(value, SETTING_LIMITS[key])) result[key] = value;
  }
  if (typeof source.soundEnabled === "boolean") result.soundEnabled = source.soundEnabled;
  if (source.soundType in SOUND_LABELS) result.soundType = source.soundType;
  if (source.accentTheme in ACCENT_LABELS) result.accentTheme = source.accentTheme;
  if (source.background in BACKGROUND_LABELS) result.background = source.background;
  result.displayName = cleanText(source.displayName, 40);
  return result;
}

// Hatalı alanların mesajlarını dizi olarak döndürür; boş dizi = geçerli.
export function validateSettingsInput(input) {
  const messages = [];
  for (const key in SETTING_LIMITS) {
    if (!(key in input)) continue; // formda olmayan ayarı atla
    const limits = SETTING_LIMITS[key];
    if (!isInRange(Number(input[key]), limits)) {
      messages.push(`${SETTING_NAMES[key]} ${limits[0]} ile ${limits[1]} arasında tam sayı olmalı.`);
    }
  }
  return messages;
}

export function getSettings() {
  return settings;
}

export function updateSettings(changes) {
  settings = normalizeSettings({ ...settings, ...changes });
  persist();
  return settings;
}

// Bir modun toplam süresi, saniye olarak.
export function getModeSeconds(mode) {
  const value = settings[MODE_SETTING_KEYS[mode]];
  return mode === "custom" ? value : value * 60;
}

// Aynı süre dakika olarak (oturum kaydı ve harcanan süre için). En az 1 dakika yazılır.
export function getModeMinutes(mode) {
  return Math.max(1, Math.round(getModeSeconds(mode) / 60));
}

// ---- Oturum kayıtları ----

function isValidSession(raw) {
  return raw !== null && typeof raw === "object"
    && Number.isFinite(Number(raw.endedAt)) && Number(raw.minutes) > 0;
}

function normalizeSession(raw) {
  const endedAt = Number(raw.endedAt);
  const startedAt = Number(raw.startedAt);
  return {
    id: cleanId(raw.id) || createId("p"),
    type: raw.type in MODE_LABELS ? raw.type : "focus",
    taskId: cleanId(raw.taskId),
    // Oturumun hangi güne yazılacağı: bittiği anın YEREL tarihi.
    date: isDateKey(raw.date) ? raw.date : toDateKey(new Date(endedAt)),
    startedAt: Number.isFinite(startedAt) ? startedAt : endedAt,
    endedAt: endedAt,
    minutes: Math.round(Number(raw.minutes)),
  };
}

export function getSessions() {
  return pomodoroSessions;
}

// "Çalışma" sayılan oturum türleri: Pomodoro odağı ve serbest çalışma (molalar değil).
export function isWorkSession(session) {
  return session.type === "focus" || session.type === "custom";
}

export function addSession(input) {
  const session = normalizeSession({ ...input, id: createId("p") });
  pomodoroSessions.push(session);
  persist();
  return session;
}

export function clearSessions() {
  pomodoroSessions = [];
  persist();
}

// Odak oturumu bitince ilişkili görevin "harcanan süre"sini artırır.
export function addSpentMinutes(taskId, minutes) {
  const task = getTaskById(taskId);
  if (!task) return;
  updateTask(taskId, { spentMinutes: task.spentMinutes + minutes });
}

// ---- Zamanlayıcı durumu ----
// status:      "idle" (bekliyor) | "running" (çalışıyor) | "paused" (duraklatıldı)
// endsAt:      çalışırken oturumun BİTECEĞİ an (zaman damgası). Kalan süre = endsAt - şimdi.
// remainingMs: çalışmıyorken kalan süre (milisaniye)
// startedAt:   oturumun ilk başlatıldığı an
// focusCount:  bu döngüde tamamlanan odak sayısı (uzun mola zamanını bulmak için)

function normalizeTimer(raw) {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  // Varsayılan mod "Serbest": kullanıcı istediği süreyle çalışır; Pomodoro modları bir tık ötede.
  const mode = source.mode in MODE_SETTING_KEYS ? source.mode : "custom";
  const fullMs = getModeSeconds(mode) * 1000;

  let status = ["idle", "running", "paused"].includes(source.status) ? source.status : "idle";
  const endsAt = Number(source.endsAt);
  const remainingMs = Number(source.remainingMs);
  const startedAt = Number(source.startedAt);
  const focusCount = Number(source.focusCount);

  // "Çalışıyor" deniyor ama bitiş anı yoksa veri tutarsızdır; beklemeye al.
  if (status === "running" && !(endsAt > 0)) status = "idle";

  return {
    mode: mode,
    status: status,
    endsAt: status === "running" ? endsAt : null,
    remainingMs: status !== "idle" && remainingMs > 0 && remainingMs <= fullMs ? remainingMs : fullMs,
    startedAt: status !== "idle" && startedAt > 0 ? startedAt : null,
    taskId: cleanId(source.taskId),
    focusCount: Number.isInteger(focusCount) && focusCount > 0 ? focusCount : 0,
  };
}

export function getTimer() {
  return timer;
}

// Zamanlayıcının bazı alanlarını değiştirir ve kaydeder.
// Her saniye değil, yalnızca durum değişince çağrılır (başlat, duraklat, bitir...).
export function saveTimer(changes) {
  timer = normalizeTimer({ ...timer, ...changes });
  persist();
  return timer;
}

// ==========================================================
// 7) HEDEFLER, ALIŞKANLIKLAR, NOTLAR, SEYAHATLER
//
// Bu dört kayıt türü aynı işlemlere ihtiyaç duyar: listele, bul, ekle, güncelle, sil.
// Aynı kodu dört kez yazmamak için bir "fabrika" kullanıyoruz: createCollection her
// çağrıda kendi kayıt listesini hatırlayan bir depo üretir.
//   goalStore.all()   goalStore.get(id)   goalStore.add({...})
//   goalStore.update(id, {...})           goalStore.remove(id)
// ==========================================================

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// prefix: kimliklerin ön eki   fieldName: zorunlu metin alanı   normalize: kaydı düzelten fonksiyon
function createCollection(prefix, fieldName, normalize) {
  let records = [];

  return {
    // Kayıttan okunan ham listeyi yükler (geçersizleri atar, eksikleri tamamlar).
    load(rawList) {
      records = asArray(rawList).filter((raw) => hasIdAndText(raw, fieldName)).map(normalize);
    },
    all() {
      return records;
    },
    get(id) {
      return records.find((record) => record.id === id);
    },
    add(input) {
      const record = normalize({ ...input, id: createId(prefix), createdAt: todayKey() });
      records.push(record);
      persist();
      return record;
    },
    update(id, changes) {
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) return null;
      records[index] = normalize({ ...records[index], ...changes, id: id });
      persist();
      return records[index];
    },
    remove(id) {
      records = records.filter((record) => record.id !== id);
      persist();
    },
  };
}

// Başlangıç ve bitiş tarihi birlikte verildiyse bitiş önce olamaz.
function hasDateOrderError(input) {
  return isDateKey(input.startDate) && isDateKey(input.endDate) && input.endDate < input.startDate;
}

// ---- Hedefler ----
// type: "numeric" (sayısal: 20 bölümden 6'sı) | "simple" (tek adım: yapıldı / yapılmadı)

function normalizeGoal(raw) {
  const type = raw.type === "simple" ? "simple" : "numeric";
  const targetValue = type === "simple" ? 1 : Math.max(toNumber(raw.targetValue, 1), 0.01);
  const currentValue = Math.max(toNumber(raw.currentValue, 0), 0);
  const isDone = currentValue >= targetValue;

  return {
    id: raw.id,
    title: cleanText(raw.title, TITLE_MAX_LENGTH),
    description: cleanText(raw.description, 300),
    categoryId: cleanId(raw.categoryId),
    type: type,
    targetValue: targetValue,
    currentValue: type === "simple" ? Math.min(currentValue, 1) : currentValue,
    unit: type === "simple" ? "" : cleanText(raw.unit, 20),
    startDate: isDateKey(raw.startDate) ? raw.startDate : "",
    endDate: isDateKey(raw.endDate) ? raw.endDate : "",
    createdAt: isDateKey(raw.createdAt) ? raw.createdAt : todayKey(),
    // Hedefe ilk ulaşıldığı gün korunur; değer geri düşerse silinir.
    completedAt: isDone ? (isDateKey(raw.completedAt) ? raw.completedAt : todayKey()) : null,
  };
}

export function validateGoalInput(input) {
  const errors = {};
  if (String(input.title).trim() === "") errors.title = "Hedef adı boş olamaz.";

  if (input.type !== "simple") {
    const target = Number(input.targetValue);
    if (!Number.isFinite(target) || target <= 0) errors.targetValue = "Hedef değer 0'dan büyük bir sayı olmalı.";
    const current = Number(input.currentValue);
    if (!Number.isFinite(current) || current < 0) errors.currentValue = "Şu anki değer 0 ya da daha büyük olmalı.";
  }
  if (hasDateOrderError(input)) errors.endDate = "Bitiş tarihi başlangıçtan önce olamaz.";
  return errors;
}

export const goalStore = createCollection("g", "title", normalizeGoal);

// ---- Alışkanlıklar ----
// frequency: "daily" (her gün) | "weekly" (haftada weeklyTarget gün)

function normalizeHabit(raw) {
  const weeklyTarget = Math.round(toNumber(raw.weeklyTarget, 3));
  return {
    id: raw.id,
    title: cleanText(raw.title, 80),
    frequency: raw.frequency === "weekly" ? "weekly" : "daily",
    weeklyTarget: weeklyTarget >= 1 && weeklyTarget <= 7 ? weeklyTarget : 3,
    categoryId: cleanId(raw.categoryId),
    createdAt: isDateKey(raw.createdAt) ? raw.createdAt : todayKey(),
  };
}

export function validateHabitInput(input) {
  const errors = {};
  if (String(input.title).trim() === "") errors.title = "Alışkanlık adı boş olamaz.";
  if (input.frequency === "weekly") {
    const target = Number(input.weeklyTarget);
    if (!Number.isInteger(target) || target < 1 || target > 7) errors.weeklyTarget = "Haftalık hedef 1 ile 7 arasında olmalı.";
  }
  return errors;
}

export const habitStore = createCollection("h", "title", normalizeHabit);

// Alışkanlık kayıtları: "şu alışkanlık şu gün yapıldı" bilgisinin listesi.
//   { habitId: "h1", date: "2026-10-13" }
// Seri ve yüzde gibi değerleri SAKLAMIYORUZ; her seferinde bu kayıtlardan hesaplıyoruz.
// Böylece alışkanlığın sıklığı sonradan değişse bile geçmiş kayıtlar bozulmaz.
let habitEntries = [];

function loadHabitEntries(rawList) {
  const seen = []; // aynı gün için çift kayıt olmasın
  habitEntries = [];
  for (const raw of asArray(rawList)) {
    if (raw === null || typeof raw !== "object" || !cleanId(raw.habitId) || !isDateKey(raw.date)) continue;
    const key = `${raw.habitId}|${raw.date}`;
    if (seen.includes(key)) continue;
    seen.push(key);
    habitEntries.push({ habitId: raw.habitId, date: raw.date });
  }
}

export function isHabitDone(habitId, date) {
  return habitEntries.some((entry) => entry.habitId === habitId && entry.date === date);
}

// O gün için kaydı varsa siler, yoksa ekler.
export function toggleHabitEntry(habitId, date) {
  if (isHabitDone(habitId, date)) {
    habitEntries = habitEntries.filter((entry) => !(entry.habitId === habitId && entry.date === date));
  } else {
    habitEntries.push({ habitId: habitId, date: date });
  }
  persist();
}

// Alışkanlığı ve ona ait tüm kayıtları siler.
export function deleteHabit(habitId) {
  habitEntries = habitEntries.filter((entry) => entry.habitId !== habitId);
  habitStore.remove(habitId); // remove kaydeder
}

// ---- Notlar ----

function normalizeNote(raw) {
  return {
    id: raw.id,
    title: cleanText(raw.title, TITLE_MAX_LENGTH),
    content: cleanText(raw.content, 5000),
    categoryId: cleanId(raw.categoryId),
    taskId: cleanId(raw.taskId), // ilişkili görev (isteğe bağlı)
    createdAt: isDateKey(raw.createdAt) ? raw.createdAt : todayKey(),
    updatedAt: toNumber(raw.updatedAt, Date.now()), // son değişiklik anı (zaman damgası)
  };
}

export function validateNoteInput(input) {
  const errors = {};
  if (String(input.title).trim() === "") errors.title = "Not başlığı boş olamaz.";
  return errors;
}

export const noteStore = createCollection("n", "title", normalizeNote);

// ---- Seyahatler ----
// plan:     gün gün program  [{ id, date, time, title }]
// packing:  bavul listesi    [{ id, text, done }]
// expenses: harcamalar       [{ id, title, amount }]

function normalizePlanItems(rawList) {
  return asArray(rawList)
    .filter((raw) => raw !== null && typeof raw === "object" && cleanText(raw.title, 120) !== "")
    .map((raw) => ({
      id: cleanId(raw.id) || createId("pl"),
      date: isDateKey(raw.date) ? raw.date : "",
      time: typeof raw.time === "string" ? raw.time : "",
      title: cleanText(raw.title, 120),
    }));
}

function normalizeExpenses(rawList) {
  return asArray(rawList)
    .filter((raw) => raw !== null && typeof raw === "object" && cleanText(raw.title, 80) !== "")
    .map((raw) => ({
      id: cleanId(raw.id) || createId("ex"),
      title: cleanText(raw.title, 80),
      amount: Math.max(toNumber(raw.amount, 0), 0),
    }));
}

function normalizeTrip(raw) {
  return {
    id: raw.id,
    name: cleanText(raw.name, 60),
    destination: cleanText(raw.destination, 80),
    startDate: isDateKey(raw.startDate) ? raw.startDate : "",
    endDate: isDateKey(raw.endDate) ? raw.endDate : "",
    budget: Math.max(toNumber(raw.budget, 0), 0),
    notes: cleanText(raw.notes, 1000),
    plan: normalizePlanItems(raw.plan),
    packing: normalizeItems(raw.packing),
    expenses: normalizeExpenses(raw.expenses),
    createdAt: isDateKey(raw.createdAt) ? raw.createdAt : todayKey(),
  };
}

export function validateTripInput(input) {
  const errors = {};
  if (String(input.name).trim() === "") errors.name = "Seyahat adı boş olamaz.";
  if (hasDateOrderError(input)) errors.endDate = "Dönüş tarihi gidişten önce olamaz.";
  if (input.budget !== "" && !(Number(input.budget) >= 0)) errors.budget = "Bütçe 0 ya da daha büyük bir sayı olmalı.";
  return errors;
}

export const tripStore = createCollection("trip", "name", normalizeTrip);
