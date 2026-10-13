// ==========================================================
// notes.js — Notlar sayfası: başlık + metin, kategori, görevle ilişki, arama
// ==========================================================

import { noteStore, validateNoteInput, getCategories, getCategoryById, getTasks, getTaskById } from "../state.js";
import { createCategoryMeta, createMetaItem, setFieldError, askConfirm } from "../components.js";
import { el, icon, clear, byId, showToast, fillSelect, toDateKey, todayKey, formatShortDate } from "../utils.js";

const EXCERPT_LENGTH = 180; // kartta gösterilecek en fazla karakter

let categoryFilter = "";
let searchText = "";
let editingNoteId = null;

// ---------------- HESAPLAMA ----------------

function matchesNote(note) {
  if (categoryFilter !== "" && note.categoryId !== categoryFilter) return false;
  if (searchText === "") return true;
  const haystack = `${note.title} ${note.content}`.toLocaleLowerCase("tr");
  return haystack.includes(searchText);
}

// Zaman damgasını okunur tarihe çevirir: "Bugün" ya da "12 Eki Pzt".
function formatUpdated(timestamp) {
  const dateKey = toDateKey(new Date(timestamp));
  return dateKey === todayKey() ? "Bugün" : formatShortDate(dateKey);
}

// ---------------- ÇİZİM ----------------

function createNoteCard(note) {
  // Kartın tamamı bir düğme: tıklanınca not düzenlemek için açılır.
  const card = el("button", "card note");
  card.type = "button";
  card.dataset.noteId = note.id;

  const excerpt = note.content.length > EXCERPT_LENGTH
    ? `${note.content.slice(0, EXCERPT_LENGTH)}…`
    : note.content;

  card.append(el("h3", "card__title", note.title));
  if (excerpt !== "") card.append(el("p", "note__text", excerpt));

  const meta = el("div", "task__meta");
  const category = getCategoryById(note.categoryId);
  if (category) meta.append(createCategoryMeta(category));
  const task = note.taskId ? getTaskById(note.taskId) : null;
  if (task) meta.append(createMetaItem("tasks", task.title));
  meta.append(el("span", "task__meta-item", formatUpdated(note.updatedAt)));
  card.append(meta);

  return card;
}

export function renderNotes() {
  const notes = noteStore.all();
  byId("notesSummary").textContent = `${notes.length} not`;

  fillSelect(
    byId("noteFilterCategory"),
    getCategories().map((category) => ({ value: category.id, label: category.name })),
    "Tüm kategoriler",
  );
  categoryFilter = byId("noteFilterCategory").value;

  const grid = byId("noteGrid");
  clear(grid);

  // En son değiştirilen en başta.
  const visible = notes.filter(matchesNote).sort((a, b) => b.updatedAt - a.updatedAt);

  if (visible.length === 0) {
    const hasFilter = searchText !== "" || categoryFilter !== "";
    const empty = el("div", "card empty");
    empty.append(icon("inbox"), el("p", "", hasFilter ? "Bu filtreye uyan not yok." : "Henüz not yok. \"Yeni not\" ile ilkini yaz."));
    grid.append(empty);
    return;
  }
  for (const note of visible) {
    grid.append(createNoteCard(note));
  }
}

// ---------------- FORM ----------------

function openNoteForm(noteId) {
  const note = noteId ? noteStore.get(noteId) : null;
  editingNoteId = note ? note.id : null;

  fillSelect(byId("noteCategory"), getCategories().map((c) => ({ value: c.id, label: c.name })), "Kategorisiz");
  // Yalnızca açık görevler; ama notun bağlı olduğu görev tamamlanmış olsa da listede kalsın.
  const taskOptions = getTasks()
    .filter((task) => !task.completed || (note && task.id === note.taskId))
    .map((task) => ({ value: task.id, label: task.title }));
  fillSelect(byId("noteTask"), taskOptions, "Görevle ilişkili değil");

  byId("noteDialogTitle").textContent = note ? "Notu düzenle" : "Yeni not";
  byId("noteSaveBtn").textContent = note ? "Kaydet" : "Ekle";
  byId("noteDeleteBtn").hidden = note === null;
  byId("noteTitle").value = note ? note.title : "";
  byId("noteContent").value = note ? note.content : "";
  byId("noteCategory").value = note && note.categoryId ? note.categoryId : "";
  byId("noteTask").value = note && note.taskId ? note.taskId : "";

  setFieldError("noteTitle", "noteTitleError", undefined);
  byId("noteDialog").showModal();
  byId("noteTitle").focus();
}

function handleSubmit(event) {
  event.preventDefault();
  const input = {
    title: byId("noteTitle").value,
    content: byId("noteContent").value,
    categoryId: byId("noteCategory").value,
    taskId: byId("noteTask").value,
    updatedAt: Date.now(),
  };

  const errors = validateNoteInput(input);
  setFieldError("noteTitle", "noteTitleError", errors.title);
  if (Object.keys(errors).length > 0) return;

  if (editingNoteId) {
    noteStore.update(editingNoteId, input);
    showToast("Not güncellendi.");
  } else {
    noteStore.add(input);
    showToast("Not eklendi.");
  }
  byId("noteDialog").close();
  renderNotes();
}

function handleDelete() {
  const note = noteStore.get(editingNoteId);
  if (!note) return;
  byId("noteDialog").close(); // onay penceresi üstte görünsün diye önce formu kapat

  askConfirm({
    title: "Not silinsin mi?",
    text: `"${note.title}" kalıcı olarak silinecek.`,
    confirmLabel: "Sil",
    onConfirm: () => {
      noteStore.remove(note.id);
      renderNotes();
      showToast("Not silindi.");
    },
  });
}

export function setNotesSearchText(text) {
  searchText = text.trim().toLocaleLowerCase("tr");
  renderNotes();
}

export function initNotes() {
  byId("newNoteBtn").addEventListener("click", () => openNoteForm(null));
  byId("noteForm").addEventListener("submit", handleSubmit);
  byId("noteCancelBtn").addEventListener("click", () => byId("noteDialog").close());
  byId("noteDeleteBtn").addEventListener("click", handleDelete);

  byId("noteFilterCategory").addEventListener("change", (event) => {
    categoryFilter = event.target.value;
    renderNotes();
  });

  byId("noteGrid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-note-id]");
    if (card) openNoteForm(card.dataset.noteId);
  });
}
