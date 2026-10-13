// ==========================================================
// components.js — Birden fazla sayfada kullanılan arayüz parçaları
// (görev satırı, boş durum, onay penceresi)
// ==========================================================

import { PRIORITY_LABELS, RECURRENCE_LABELS } from "./data.js";
import { getCategoryById } from "./state.js";
import { el, icon, byId, daysBetween, formatShortDate, formatMinutes } from "./utils.js";

// ---------- Görev satırı ----------

export function createMetaItem(iconName, text, extraClass) {
  const item = el("span", "task__meta-item");
  if (extraClass) item.classList.add(extraClass);
  item.append(icon(iconName), el("span", "", text));
  return item;
}

function createActionButton(action, iconName, label, taskId) {
  const button = el("button", "icon-btn icon-btn--sm");
  button.type = "button";
  button.dataset.action = action; // "edit" veya "delete"
  button.dataset.taskId = taskId;
  button.setAttribute("aria-label", label);
  button.append(icon(iconName));
  return button;
}

// Görevin tarihini duruma göre anlatan bilgi parçası (Görevler sayfası için).
function createDateMeta(task, today) {
  if (!task.completed && task.dueDate < today) {
    const lateDays = daysBetween(task.dueDate, today);
    return createMetaItem("alert", `${lateDays} gün gecikti`, "task__meta-item--danger");
  }
  const dayText = task.dueDate === today ? "Bugün" : formatShortDate(task.dueDate);
  const text = task.startTime ? `${dayText} ${task.startTime}` : dayText;
  return createMetaItem("calendar", text);
}

// Tek bir görev satırı oluşturur.
// mode: "today" | "upcoming" | "overdue" (dashboard) | "full" (Görevler sayfası)
export function createTaskItem(task, mode, today) {
  const item = el("li", "task");
  if (task.completed) item.classList.add("is-done");
  if (mode === "full") item.classList.add("task--full"); // düğmeli satır: dar ekranda iki satıra bölünür (CSS)

  const checkbox = el("input", "task__check");
  checkbox.type = "checkbox";
  checkbox.checked = task.completed;
  checkbox.dataset.taskId = task.id; // tıklanınca hangi görev olduğunu buradan anlayacağız
  checkbox.setAttribute("aria-label", `Tamamlandı olarak işaretle: ${task.title}`);

  const body = el("div", "task__body");
  const meta = el("div", "task__meta");

  const category = getCategoryById(task.categoryId);
  if (category) {
    const categoryItem = el("span", "task__meta-item");
    const dot = el("span", "dot");
    dot.style.setProperty("--cat", category.color);
    categoryItem.append(dot, el("span", "", category.name));
    meta.append(categoryItem);
  }

  if (mode === "today" && task.startTime) {
    meta.append(createMetaItem("clock", task.startTime));
  }
  if (mode === "upcoming") {
    meta.append(createMetaItem("calendar", formatShortDate(task.dueDate)));
  }
  if (mode === "overdue") {
    const lateDays = daysBetween(task.dueDate, today);
    meta.append(createMetaItem("alert", `${lateDays} gün gecikti`, "task__meta-item--danger"));
  }
  if (mode === "full" && task.dueDate !== "") {
    meta.append(createDateMeta(task, today));
  }
  if (task.estimatedMinutes > 0) {
    meta.append(createMetaItem("timer", formatMinutes(task.estimatedMinutes)));
  }
  if (task.subtasks.length > 0) {
    const doneCount = task.subtasks.filter((subtask) => subtask.done).length;
    meta.append(createMetaItem("list", `${doneCount}/${task.subtasks.length}`));
  }
  if (task.recurrence !== "none") {
    meta.append(createMetaItem("reset", RECURRENCE_LABELS[task.recurrence]));
  }
  if (mode === "full" && task.status === "doing") {
    meta.append(el("span", "tag", "Devam ediyor"));
  }
  if (mode === "full") {
    for (const tag of task.tags) {
      meta.append(el("span", "tag", `#${tag}`));
    }
  }

  body.append(el("p", "task__title", task.title));
  if (mode === "full" && task.description !== "") {
    body.append(el("p", "task__desc", task.description));
  }
  body.append(meta);

  const priority = el("span", `priority priority--${task.priority}`, PRIORITY_LABELS[task.priority]);
  item.append(checkbox, body, priority);

  if (mode === "full") {
    const actions = el("div", "task__actions");
    actions.append(
      createActionButton("edit", "edit", `Düzenle: ${task.title}`, task.id),
      createActionButton("delete", "trash", `Sil: ${task.title}`, task.id),
    );
    item.append(actions);
  }
  return item;
}

// Kategori göstergesi: renkli nokta + ad.
export function createCategoryMeta(category) {
  const item = el("span", "task__meta-item");
  const dot = el("span", "dot");
  dot.style.setProperty("--cat", category.color);
  item.append(dot, el("span", "", category.name));
  return item;
}

// Bir form alanının altındaki hata mesajını gösterir ya da gizler.
// message undefined ise hata yok demektir.
export function setFieldError(inputId, errorId, message) {
  const input = byId(inputId);
  const errorElement = byId(errorId);
  const hasError = message !== undefined;

  errorElement.textContent = hasError ? message : "";
  errorElement.hidden = !hasError;
  input.classList.toggle("is-invalid", hasError);
  input.setAttribute("aria-invalid", String(hasError));
}

export function createEmptyState(message) {
  const item = el("li", "empty");
  item.append(icon("inbox"), el("p", "", message));
  return item;
}

// ---------- Genel simge düğmesi ----------
// data: düğmeye yazılacak data-* bilgileri. Örnek:
//   createIconButton("trash", "Sil", { action: "delete", templateId: "tpl-1" })
//   -> <button data-action="delete" data-template-id="tpl-1">
export function createIconButton(iconName, label, data) {
  const button = el("button", "icon-btn icon-btn--sm");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  for (const key in data) {
    button.dataset[key] = data[key];
  }
  button.append(icon(iconName));
  return button;
}

// ---------- Madde düzenleyici ----------
// Görev formundaki "alt görevler" ve şablon formundaki "maddeler" aynı parçayı kullanır:
// metni değiştirilebilen, yukarı/aşağı taşınabilen ve silinebilen satırlar.
//
// Bu fonksiyon bir "fabrika"dır: her çağrıda kendi items dizisini hatırlayan
// bağımsız bir düzenleyici üretir ve onu yöneten fonksiyonları nesne olarak döndürür.
//   const editor = createItemEditor(byId("subtaskList"), { showCheck: true });
//   editor.setItems([...]);  editor.addItem("Süt al");  editor.getItems();
export function createItemEditor(listElement, options) {
  let items = [];

  function render() {
    listElement.replaceChildren();
    listElement.hidden = items.length === 0;

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const row = el("li", "item-editor__row");

      if (options.showCheck) {
        const check = el("input", "task__check item-editor__check");
        check.type = "checkbox";
        check.checked = item.done;
        check.dataset.index = index;
        check.setAttribute("aria-label", `Tamamlandı: ${item.text}`);
        row.append(check);
      }

      const text = el("input", "input item-editor__text");
      text.type = "text";
      text.value = item.text;
      text.maxLength = 200;
      text.dataset.index = index;
      text.setAttribute("aria-label", `${index + 1}. madde`);

      const up = createIconButton("up", "Yukarı taşı", { itemAction: "up", index: index });
      const down = createIconButton("down", "Aşağı taşı", { itemAction: "down", index: index });
      const remove = createIconButton("close", "Maddeyi sil", { itemAction: "delete", index: index });
      up.disabled = index === 0;
      down.disabled = index === items.length - 1;

      row.append(text, up, down, remove);
      listElement.append(row);
    }
  }

  // İki maddenin yerini değiştirir.
  function swap(indexA, indexB) {
    const temp = items[indexA];
    items[indexA] = items[indexB];
    items[indexB] = temp;
  }

  listElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-item-action]");
    if (!button) return;
    const index = Number(button.dataset.index);
    const action = button.dataset.itemAction;

    if (action === "delete") items.splice(index, 1);
    if (action === "up" && index > 0) swap(index, index - 1);
    if (action === "down" && index < items.length - 1) swap(index, index + 1);
    render();
  });

  // Metin her değiştiğinde diziyi güncelle (yeniden çizmeden, yoksa imleç kaybolur).
  listElement.addEventListener("input", (event) => {
    if (event.target.matches(".item-editor__text")) {
      items[Number(event.target.dataset.index)].text = event.target.value;
    }
  });

  listElement.addEventListener("change", (event) => {
    if (event.target.matches(".item-editor__check")) {
      items[Number(event.target.dataset.index)].done = event.target.checked;
    }
  });

  // Madde satırında Enter'a basmak formu göndermesin.
  listElement.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches(".item-editor__text")) event.preventDefault();
  });

  return {
    // Dışarıdan gelen diziyi kopyalıyoruz; form iptal edilirse asıl veri değişmemiş olur.
    setItems(newItems) {
      items = newItems.map((item) => ({ ...item }));
      render();
    },
    addItem(text) {
      items.push({ id: "", text: text, done: false }); // id'yi state.js kaydederken üretir
      render();
    },
    addItems(newItems) {
      for (const item of newItems) items.push({ ...item });
      render();
    },
    // Metni boş bırakılan satırları atar.
    getItems() {
      return items.filter((item) => item.text.trim() !== "");
    },
  };
}

// ---------- Pano sürükle-bırak ----------
// Kişisel Pano ve Ortak Panolar aynı kodu kullanır. Tarayıcının hazır olayları:
//   dragstart -> sürükleme başladı (hangi kart?)
//   dragover  -> kart bir sütunun üzerinde (nereye bırakılacak?)
//   drop      -> bırakıldı (veriyi güncelle)
//   dragend   -> sürükleme bitti (temizlik)
//
// Beklenen HTML: board > .kanban__col[data-status] > .kanban__list > .kcard[data-task-id]
// onDrop(taskId, status, beforeTaskId): bırakılınca çağrılır.
//   beforeTaskId: kartın ÖNÜNE geleceği görev; null ise sütunun sonu.
// onEnd / onStart (isteğe bağlı): sürükleme bitince / başlayınca çağrılır.
export function enableBoardDragDrop(board, onDrop, onEnd, onStart) {
  let draggedId = null;     // sürüklenen kartın görev id'si
  let dropBeforeId = null;  // bırakılınca hangi kartın önüne gelecek
  const dropLine = el("li", "kanban__drop"); // bırakma yerini gösteren çizgi
  dropLine.setAttribute("aria-hidden", "true");

  // İmlecin (y) altındaki ilk kartı bulur: sürüklenen kart bunun önüne bırakılacak.
  function findCardBelow(list, y) {
    const cards = list.querySelectorAll(".kcard:not(.is-dragging)");
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      if (y < box.top + box.height / 2) return card; // imleç kartın üst yarısında
    }
    return null;
  }

  function clearDropMarks() {
    dropLine.remove();
    for (const column of board.querySelectorAll(".is-drop-target")) {
      column.classList.remove("is-drop-target");
    }
  }

  board.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".kcard");
    if (!card) return;
    draggedId = card.dataset.taskId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedId); // bazı tarayıcılar veri olmadan sürüklemeyi başlatmaz
    card.classList.add("is-dragging");
    if (onStart) onStart();
  });

  board.addEventListener("dragover", (event) => {
    if (draggedId === null) return;
    const column = event.target.closest(".kanban__col");
    if (!column) return;

    // Varsayılan davranış "buraya bırakılamaz"dır; preventDefault ile izin veriyoruz.
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const list = column.querySelector(".kanban__list");
    const cardBelow = findCardBelow(list, event.clientY);
    dropBeforeId = cardBelow ? cardBelow.dataset.taskId : null;

    // Bırakma çizgisini doğru yere taşı.
    clearDropMarks();
    column.classList.add("is-drop-target");
    if (cardBelow) {
      list.insertBefore(dropLine, cardBelow);
    } else {
      list.append(dropLine);
    }
  });

  board.addEventListener("drop", (event) => {
    const column = event.target.closest(".kanban__col");
    if (draggedId === null || !column) return;
    event.preventDefault();
    onDrop(draggedId, column.dataset.status, dropBeforeId);
  });

  // dragend, drop'tan hemen sonra (ya da sürükleme iptal edilince) çalışır.
  board.addEventListener("dragend", () => {
    draggedId = null;
    dropBeforeId = null;
    clearDropMarks();
    for (const card of board.querySelectorAll(".is-dragging")) {
      card.classList.remove("is-dragging");
    }
    if (onEnd) onEnd();
  });
}

// ---------- Onay penceresi ----------
// Kullanıcı "Evet" derse çalıştırılacak fonksiyonu burada bekletiyoruz.
// (JavaScript'te fonksiyonlar da birer değerdir; değişkende saklanabilir.)
let confirmCallback = null;

// Kullanım:
//   askConfirm({ title: "Silinsin mi?", text: "...", confirmLabel: "Sil", onConfirm: () => {...} });
export function askConfirm(options) {
  byId("confirmTitle").textContent = options.title;
  byId("confirmText").textContent = options.text;
  byId("confirmOk").textContent = options.confirmLabel;
  confirmCallback = options.onConfirm;
  byId("confirmDialog").showModal();
}

// Dinleyicileri bir kez ekler (app.js açılışta çağırır).
export function initConfirmDialog() {
  const dialog = byId("confirmDialog");

  byId("confirmCancel").addEventListener("click", () => dialog.close());

  byId("confirmOk").addEventListener("click", () => {
    dialog.close();
    if (confirmCallback) confirmCallback();
  });

  // Pencere nasıl kapanırsa kapansın (Esc dahil) bekleyen işlemi unut.
  dialog.addEventListener("close", () => { confirmCallback = null; });
}
