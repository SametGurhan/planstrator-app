// ==========================================================
// kanban.js — Pano: görevleri durum sütunları arasında sürükleyip bırakma
//
// Sürükle-bırak kodu components.js içindeki enableBoardDragDrop fonksiyonundadır
// (Ortak Panolar sayfası da aynı kodu kullanır); olayların açıklaması orada.
// Sürükleme dokunmatik ekranlarda çalışmadığı için her kartta ayrıca
// sola / sağa taşıma düğmeleri var; klavyeyle kullanım da böyle sağlanır.
// ==========================================================

import { PRIORITY_LABELS, STATUS_LABELS } from "../data.js";
import { getTasks, getCategories, getCategoryById, moveTask, compareTaskOrder } from "../state.js";
import { createMetaItem, createIconButton, enableBoardDragDrop } from "../components.js";
import { openTaskForm } from "./tasks.js";
import { todayKey, addDays, daysBetween, formatShortDate, el, clear, byId, fillSelect } from "../utils.js";

const STATUSES = ["todo", "doing", "done"]; // sütunların soldan sağa sırası
const DONE_DAYS = 14; // "Tamamlandı" sütununda yalnızca son 14 günün görevleri görünür

let categoryFilter = "";
let searchText = "";

// ---------------- HESAPLAMA ----------------

function isVisible(task, today) {
  if (categoryFilter !== "" && task.categoryId !== categoryFilter) return false;
  if (searchText !== "" && !task.title.toLocaleLowerCase("tr").includes(searchText)) return false;
  // Eski tamamlananlar panoyu doldurmasın.
  if (task.status === "done" && task.completedAt !== null && task.completedAt < addDays(today, -DONE_DAYS)) return false;
  return true;
}

// ---------------- ÇİZİM ----------------

function createCard(task, today) {
  const card = el("li", "kcard");
  card.draggable = true; // tarayıcıya "bu eleman sürüklenebilir" der
  card.dataset.taskId = task.id;

  const isLate = !task.completed && task.dueDate !== "" && task.dueDate < today;
  if (isLate) card.classList.add("is-late");
  if (task.completed) card.classList.add("is-done");

  const category = getCategoryById(task.categoryId);
  if (category) card.style.setProperty("--cat", category.color);

  // Başlık bir düğme: tıklanınca (ya da Enter ile) görev formu açılır.
  const title = el("button", "kcard__title", task.title);
  title.type = "button";
  title.dataset.openTask = task.id;

  const meta = el("div", "task__meta");
  if (category) {
    const categoryItem = el("span", "task__meta-item");
    categoryItem.append(el("span", "dot"), el("span", "", category.name));
    meta.append(categoryItem);
  }
  if (task.dueDate !== "") {
    if (isLate) {
      meta.append(createMetaItem("alert", `${daysBetween(task.dueDate, today)} gün gecikti`, "task__meta-item--danger"));
    } else {
      meta.append(createMetaItem("calendar", task.dueDate === today ? "Bugün" : formatShortDate(task.dueDate)));
    }
  }
  if (task.subtasks.length > 0) {
    const doneCount = task.subtasks.filter((subtask) => subtask.done).length;
    meta.append(createMetaItem("list", `${doneCount}/${task.subtasks.length}`));
  }
  if (task.recurrence !== "none") meta.append(createMetaItem("reset", "Tekrarlanır"));

  // Alt satır: öncelik + taşıma düğmeleri
  const foot = el("div", "kcard__foot");
  foot.append(el("span", `priority priority--${task.priority}`, PRIORITY_LABELS[task.priority]));

  const moves = el("div", "kcard__moves");
  const index = STATUSES.indexOf(task.status);
  if (index > 0) {
    const previous = STATUSES[index - 1];
    moves.append(createIconButton("chevron", `"${STATUS_LABELS[previous]}" sütununa taşı`, { moveTo: previous, taskId: task.id }));
  }
  if (index < STATUSES.length - 1) {
    const next = STATUSES[index + 1];
    moves.append(createIconButton("next", `"${STATUS_LABELS[next]}" sütununa taşı`, { moveTo: next, taskId: task.id }));
  }
  foot.append(moves);

  card.append(title, meta, foot);
  return card;
}

function createColumn(status, tasks, today) {
  const column = el("section", "kanban__col");
  column.dataset.status = status;

  const head = el("header", "kanban__head");
  const titleBox = el("div", "kanban__title");
  titleBox.append(el("h2", "card__title", STATUS_LABELS[status]), el("span", "badge", String(tasks.length)));
  const addButton = createIconButton("plus", `"${STATUS_LABELS[status]}" sütununa görev ekle`, { addStatus: status });
  head.append(titleBox, addButton);

  const list = el("ul", "kanban__list");
  for (const task of tasks) {
    list.append(createCard(task, today));
  }
  if (tasks.length === 0) {
    list.append(el("li", "kanban__empty", status === "done" ? `Son ${DONE_DAYS} günde tamamlanan yok` : "Buraya görev sürükle"));
  }

  column.append(head, list);
  return column;
}

export function renderKanban() {
  const today = todayKey();
  const visible = getTasks().filter((task) => isVisible(task, today));

  fillSelect(
    byId("kanbanCategory"),
    getCategories().map((category) => ({ value: category.id, label: category.name })),
    "Tüm kategoriler",
  );
  categoryFilter = byId("kanbanCategory").value;

  const openCount = visible.filter((task) => task.status !== "done").length;
  byId("kanbanSummary").textContent = `${openCount} açık görev · kartları sütunlar arasında sürükle`;

  const board = byId("kanbanBoard");
  clear(board);
  for (const status of STATUSES) {
    // filter yeni dizi döndürdüğü için sort asıl görev dizisini bozmaz.
    const columnTasks = visible.filter((task) => task.status === status).sort(compareTaskOrder);
    board.append(createColumn(status, columnTasks, today));
  }
}

// ---------------- DİĞER OLAYLAR ----------------

function handleClick(event) {
  const moveButton = event.target.closest("[data-move-to]");
  if (moveButton) {
    moveTask(moveButton.dataset.taskId, moveButton.dataset.moveTo, null); // hedef sütunun sonuna
    renderKanban();
    return;
  }
  const addButton = event.target.closest("[data-add-status]");
  if (addButton) {
    openTaskForm(null, { status: addButton.dataset.addStatus });
    return;
  }
  const openButton = event.target.closest("[data-open-task]");
  if (openButton) openTaskForm(openButton.dataset.openTask);
}

export function setKanbanSearchText(text) {
  searchText = text.trim().toLocaleLowerCase("tr");
  renderKanban();
}

export function initKanban() {
  const board = byId("kanbanBoard");
  board.addEventListener("click", handleClick);
  // Kart bırakılınca veriyi güncelle; sürükleme bitince panoyu yeniden çiz.
  enableBoardDragDrop(board, (taskId, status, beforeTaskId) => moveTask(taskId, status, beforeTaskId), renderKanban);

  byId("kanbanNewBtn").addEventListener("click", () => openTaskForm(null, { status: "todo" }));
  byId("kanbanCategory").addEventListener("change", (event) => {
    categoryFilter = event.target.value;
    renderKanban();
  });
}
