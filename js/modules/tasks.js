// ==========================================================
// tasks.js — Görevler sayfası: listeleme, filtreleme, sıralama, ekleme, düzenleme, silme
// ==========================================================

import { PRIORITY_ORDER } from "../data.js";
import {
  getTasks, getTaskById, getCategories, getAllTags, getTemplates, copyTemplateItems,
  addTask, updateTask, deleteTask, toggleTask, validateTaskInput, resetToSampleData,
} from "../state.js";
import { createTaskItem, createEmptyState, createItemEditor, askConfirm } from "../components.js";
import { todayKey, clear, byId, showToast, parseTags, fillSelect } from "../utils.js";

// Sayfanın o anki durumu
let statusFilter = "open";   // "open" | "done" | "all"
let categoryFilter = "";     // "" = tüm kategoriler
let priorityFilter = "";
let tagFilter = "";
let sortBy = "smart";        // "smart" | "priority" | "title" | "created"
let searchText = "";
let editingTaskId = null;    // null ise form "yeni görev" modunda
let subtaskEditor = null;    // formdaki alt görev düzenleyicisi
let onTasksChanged = null;   // form kaydedilince app.js'e haber vermek için

const EMPTY_MESSAGES = {
  open: "Açık görev yok. Yeni bir görev ekleyebilirsin.",
  done: "Henüz tamamlanan görev yok.",
  all: "Hiç görev yok. İlk görevini ekle.",
};

// ---------------- HESAPLAMA ----------------

function matchesStatus(task) {
  if (statusFilter === "open") return !task.completed;
  if (statusFilter === "done") return task.completed;
  return true;
}

// Seçilen tüm filtrelere uyuyorsa true. Boş ("") filtre "hepsi" demektir.
function matchesFilters(task) {
  if (categoryFilter !== "" && task.categoryId !== categoryFilter) return false;
  if (priorityFilter !== "" && task.priority !== priorityFilter) return false;
  if (tagFilter !== "" && !task.tags.includes(tagFilter)) return false;
  return true;
}

function matchesSearch(task) {
  if (searchText === "") return true;
  const haystack = `${task.title} ${task.description} ${task.tags.join(" ")}`.toLocaleLowerCase("tr");
  return haystack.includes(searchText);
}

// ---- Sıralama kuralları ----
// Karşılaştırma fonksiyonu: eksi sayı -> a önce, artı sayı -> b önce, 0 -> eşit.

function compareByPriority(a, b) {
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
}

// Akıllı sıra: yakın tarihli olan üstte, tarihsizler sonda; eşitse önceliğe bak.
function compareSmart(a, b) {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === "") return 1;
    if (b.dueDate === "") return -1;
    return a.dueDate.localeCompare(b.dueDate);
  }
  return compareByPriority(a, b);
}

// Hangi seçenek hangi fonksiyonu kullanacak? (Fonksiyonları nesnede saklıyoruz.)
const SORTERS = {
  smart: compareSmart,
  priority: (a, b) => compareByPriority(a, b) || compareSmart(a, b),
  title: (a, b) => a.title.localeCompare(b.title, "tr"),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
};

// Tamamlananlar her zaman sonda; kendi içlerinde en son tamamlanan üstte.
function compareTasks(a, b) {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  if (a.completed && sortBy === "smart") {
    return String(b.completedAt).localeCompare(String(a.completedAt));
  }
  return SORTERS[sortBy](a, b);
}

// ---------------- ÇİZİM ----------------

// Kategori ve etiket listeleri değişebildiği için seçenekleri her çizimde yeniliyoruz.
function renderFilterOptions() {
  const categoryOptions = getCategories().map((category) => ({ value: category.id, label: category.name }));
  const tagOptions = getAllTags().map((tag) => ({ value: tag, label: `#${tag}` }));

  fillSelect(byId("filterCategory"), categoryOptions, "Tüm kategoriler");
  fillSelect(byId("filterTag"), tagOptions, "Tüm etiketler");

  // Seçili kategori/etiket silinmişse filtre de sıfırlanmalı.
  categoryFilter = byId("filterCategory").value;
  tagFilter = byId("filterTag").value;
}

export function renderTasks() {
  const allTasks = getTasks();
  const openCount = allTasks.filter((task) => !task.completed).length;
  const doneCount = allTasks.length - openCount;

  byId("tasksSummary").textContent = `${openCount} açık, ${doneCount} tamamlanmış görev`;
  byId("countOpen").textContent = String(openCount);
  byId("countDone").textContent = String(doneCount);
  byId("countAll").textContent = String(allTasks.length);

  // Hangi durum düğmesi seçili?
  const buttons = byId("taskFilters").querySelectorAll("[data-filter]");
  for (const button of buttons) {
    const isActive = button.dataset.filter === statusFilter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  renderFilterOptions();

  const list = byId("taskList");
  clear(list);

  // filter yeni bir dizi döndürdüğü için sort asıl diziyi bozmaz.
  const visible = allTasks
    .filter(matchesStatus)
    .filter(matchesFilters)
    .filter(matchesSearch)
    .sort(compareTasks);

  if (visible.length === 0) {
    const hasFilter = searchText !== "" || categoryFilter !== "" || priorityFilter !== "" || tagFilter !== "";
    list.append(createEmptyState(hasFilter ? "Bu filtrelere uyan görev yok." : EMPTY_MESSAGES[statusFilter]));
    return;
  }

  const today = todayKey();
  for (const task of visible) {
    list.append(createTaskItem(task, "full", today));
  }
}

// ---------------- FORM ----------------

function showFieldError(errorId, inputId, message) {
  const errorElement = byId(errorId);
  const input = byId(inputId);
  const hasError = message !== undefined;

  errorElement.textContent = hasError ? message : "";
  errorElement.hidden = !hasError;
  input.classList.toggle("is-invalid", hasError);
  input.setAttribute("aria-invalid", String(hasError));
}

function showFormErrors(errors) {
  showFieldError("taskTitleError", "taskTitle", errors.title);
  showFieldError("taskDueDateError", "taskDueDate", errors.dueDate);
  showFieldError("taskMinutesError", "taskMinutes", errors.estimatedMinutes);
}

// taskId verilirse düzenleme, verilmezse yeni görev formu açılır.
// defaults (isteğe bağlı): yeni görevde tarih ve saat dolu gelsin diye, ör. { dueDate, startTime }.
// Planlayıcı da bu formu kullandığı için dışa açık.
export function openTaskForm(taskId, defaults) {
  const preset = defaults || {};
  const task = taskId ? getTaskById(taskId) : null;
  editingTaskId = task ? task.id : null;

  // Seçenek listeleri güncel olsun (kategori veya şablon eklenmiş olabilir).
  fillSelect(byId("taskCategory"), getCategories().map((c) => ({ value: c.id, label: c.name })), "Kategorisiz");
  fillSelect(byId("subtaskTemplate"), getTemplates().map((t) => ({ value: t.id, label: t.name })), "Şablondan ekle…");

  byId("taskDialogTitle").textContent = task ? "Görevi düzenle" : "Yeni görev";
  byId("taskSaveBtn").textContent = task ? "Kaydet" : "Ekle";

  byId("taskTitle").value = task ? task.title : "";
  byId("taskDescription").value = task ? task.description : "";
  byId("taskPriority").value = task ? task.priority : "normal";
  byId("taskCategory").value = task && task.categoryId ? task.categoryId : "";
  byId("taskDueDate").value = task ? task.dueDate : preset.dueDate || todayKey();
  byId("taskStartTime").value = task ? task.startTime : preset.startTime || "";
  byId("taskStatus").value = task ? task.status : preset.status || "todo";
  byId("taskRecurrence").value = task ? task.recurrence : "none";
  byId("taskMinutes").value = task && task.estimatedMinutes > 0 ? task.estimatedMinutes : "";
  byId("taskTags").value = task ? task.tags.join(", ") : "";
  byId("subtaskInput").value = "";
  byId("subtaskTemplate").value = "";
  subtaskEditor.setItems(task ? task.subtasks : []);

  showFormErrors({}); // önceki hataları temizle
  byId("taskDialog").showModal();
  byId("taskTitle").focus();
}

function readForm() {
  return {
    title: byId("taskTitle").value,
    description: byId("taskDescription").value,
    priority: byId("taskPriority").value,
    categoryId: byId("taskCategory").value,
    dueDate: byId("taskDueDate").value,
    startTime: byId("taskStartTime").value,
    estimatedMinutes: byId("taskMinutes").value,
    status: byId("taskStatus").value,
    recurrence: byId("taskRecurrence").value,
    tags: parseTags(byId("taskTags").value),
    subtasks: subtaskEditor.getItems(),
  };
}

function handleFormSubmit(event) {
  event.preventDefault();
  const input = readForm();
  const errors = validateTaskInput(input);
  showFormErrors(errors);

  // Object.keys(errors) -> hata olan alanların adları. Boşsa form geçerli.
  if (Object.keys(errors).length > 0) return;

  if (editingTaskId) {
    updateTask(editingTaskId, input);
    showToast("Görev güncellendi.");
  } else {
    addTask(input);
    showToast("Görev eklendi.");
  }

  byId("taskDialog").close();
  renderTasks();
  if (onTasksChanged) onTasksChanged(); // form başka bir sayfadan açıldıysa orası da tazelensin
}

function addSubtaskFromInput() {
  const input = byId("subtaskInput");
  const text = input.value.trim();
  if (text === "") return;
  subtaskEditor.addItem(text);
  input.value = "";
  input.focus();
}

// ---------------- OLAYLAR ----------------

function handleDelete(taskId) {
  const task = getTaskById(taskId);
  if (!task) return;

  askConfirm({
    title: "Görev silinsin mi?",
    text: `"${task.title}" kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
    confirmLabel: "Sil",
    onConfirm: () => {
      deleteTask(taskId);
      renderTasks();
      showToast("Görev silindi.");
    },
  });
}

function handleReset() {
  askConfirm({
    title: "Tüm veriler sıfırlansın mı?",
    text: "Bu cihazdaki tüm görevlerin, notların, hedeflerin ve ayarların silinecek; uygulama ilk kurulduğu haline dönecek. Önce Ayarlar'dan yedek almak isteyebilirsin.",
    confirmLabel: "Sıfırla",
    onConfirm: () => {
      resetToSampleData();
      // Ayarlar (tema, süreler) da sıfırlandı; her şeyin güncel açılması için sayfayı yenile.
      window.location.reload();
    },
  });
}

export function setTaskSearchText(text) {
  searchText = text.trim().toLocaleLowerCase("tr");
  renderTasks();
}

// Olay dinleyicilerini yalnızca BİR KEZ ekler (app.js açılışta çağırır).
export function initTasks(options) {
  onTasksChanged = options.onTasksChanged;
  subtaskEditor = createItemEditor(byId("subtaskList"), { showCheck: true });

  byId("newTaskBtn").addEventListener("click", () => openTaskForm(null));
  byId("taskForm").addEventListener("submit", handleFormSubmit);
  byId("taskCancelBtn").addEventListener("click", () => byId("taskDialog").close());
  byId("taskDialogClose").addEventListener("click", () => byId("taskDialog").close());
  byId("resetDataBtn").addEventListener("click", handleReset);

  // Durum düğmeleri (olay delegasyonu)
  byId("taskFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    statusFilter = button.dataset.filter;
    renderTasks();
  });

  // Açılır filtreler ve sıralama
  byId("filterCategory").addEventListener("change", (event) => {
    categoryFilter = event.target.value;
    renderTasks();
  });
  byId("filterPriority").addEventListener("change", (event) => {
    priorityFilter = event.target.value;
    renderTasks();
  });
  byId("filterTag").addEventListener("change", (event) => {
    tagFilter = event.target.value;
    renderTasks();
  });
  byId("sortSelect").addEventListener("change", (event) => {
    sortBy = event.target.value;
    renderTasks();
  });

  // Alt görev ekleme: düğmeyle ya da Enter ile (Enter formu göndermesin)
  byId("subtaskAddBtn").addEventListener("click", addSubtaskFromInput);
  byId("subtaskInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSubtaskFromInput();
    }
  });

  // Şablon seçilince maddelerinin KOPYASI alt görev olarak eklenir.
  byId("subtaskTemplate").addEventListener("change", (event) => {
    if (event.target.value === "") return;
    subtaskEditor.addItems(copyTemplateItems(event.target.value));
    event.target.value = "";
  });

  const list = byId("taskList");

  // Onay kutusu
  list.addEventListener("change", (event) => {
    if (event.target.matches(".task__check")) {
      toggleTask(event.target.dataset.taskId);
      renderTasks();
    }
  });

  // Düzenle / Sil düğmeleri. closest: tıklanan ikon olsa bile düğmeyi bulur.
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit") openTaskForm(button.dataset.taskId);
    if (button.dataset.action === "delete") handleDelete(button.dataset.taskId);
  });
}
