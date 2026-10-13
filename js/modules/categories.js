// ==========================================================
// categories.js — Kategoriler sayfası: ekleme, düzenleme, güvenli silme
// ==========================================================

import {
  getCategories, getCategoryById, countTasksInCategory,
  addCategory, updateCategory, deleteCategory, validateCategoryInput,
} from "../state.js";
import { createEmptyState, createIconButton, askConfirm } from "../components.js";
import { el, clear, byId, showToast, fillSelect } from "../utils.js";

let editingCategoryId = null;  // null ise form "yeni kategori" modunda
let deletingCategoryId = null; // taşıma penceresinde hangi kategori siliniyor
let selectedIcon = "";         // formda seçili simge ("" = simge yok)

// Simge panelinde gösterilecek emojiler. İstediğini ekleyip çıkarabilirsin.
const EMOJIS = [
  "💼", "📚", "🙂", "💪", "💰", "🏠", "🚀", "🎯",
  "✈️", "🧳", "🗺️", "🏖️", "🚗", "🍽️", "🛒", "🧹",
  "💻", "🎓", "✏️", "📝", "📅", "⏰", "💡", "🔧",
  "🎨", "🎵", "🎸", "🎮", "📷", "⚽", "🏃", "🧘",
  "❤️", "⭐", "🔥", "🌱", "🐾", "👨‍👩‍👧", "🎁", "🎉",
];

// ---------------- ÇİZİM ----------------

function createCategoryRow(category) {
  const row = el("li", "row");
  const count = countTasksInCategory(category.id);

  const swatch = el("span", "swatch", category.icon);
  swatch.style.setProperty("--cat", category.color);

  const body = el("div", "row__body");
  body.append(
    el("p", "row__title", category.name),
    el("p", "row__hint", count === 0 ? "Görev yok" : `${count} görev`),
  );

  const actions = el("div", "task__actions");
  actions.append(
    createIconButton("edit", `Düzenle: ${category.name}`, { action: "edit", categoryId: category.id }),
    createIconButton("trash", `Sil: ${category.name}`, { action: "delete", categoryId: category.id }),
  );

  row.append(swatch, body, actions);
  return row;
}

export function renderCategories() {
  const categories = getCategories();
  byId("categoriesSummary").textContent = `${categories.length} kategori`;

  const list = byId("categoryRows");
  clear(list);

  if (categories.length === 0) {
    list.append(createEmptyState("Hiç kategori yok. İlk kategorini ekle."));
    return;
  }
  for (const category of categories) {
    list.append(createCategoryRow(category));
  }
}

// ---------------- FORM ----------------

function showNameError(message) {
  const errorElement = byId("categoryNameError");
  const hasError = message !== undefined;
  errorElement.textContent = hasError ? message : "";
  errorElement.hidden = !hasError;
  byId("categoryName").classList.toggle("is-invalid", hasError);
}

// ---- Simge paneli ----

// Panelin düğmelerini bir kez oluşturur: önce "simge yok", sonra tüm emojiler.
function buildEmojiPanel() {
  const panel = byId("emojiPanel");

  const noneButton = el("button", "emoji-btn emoji-btn--none", "Yok");
  noneButton.type = "button";
  noneButton.dataset.emoji = "";
  panel.append(noneButton);

  for (const emoji of EMOJIS) {
    const button = el("button", "emoji-btn", emoji);
    button.type = "button";
    button.dataset.emoji = emoji;
    panel.append(button);
  }
}

function setEmojiPanelOpen(isOpen) {
  byId("emojiPanel").hidden = !isOpen;
  byId("categoryIconBtn").setAttribute("aria-expanded", String(isOpen));
}

// Seçimi değişkene yazar, düğmenin yazısını ve paneldeki işareti günceller.
function selectIcon(emoji) {
  selectedIcon = emoji;
  byId("categoryIconBtn").textContent = emoji === "" ? "Simge seç" : `${emoji}  Değiştir`;

  const buttons = byId("emojiPanel").querySelectorAll(".emoji-btn");
  for (const button of buttons) {
    const isSelected = button.dataset.emoji === emoji;
    button.classList.toggle("is-active", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  }
}

function openCategoryForm(categoryId) {
  const category = categoryId ? getCategoryById(categoryId) : null;
  editingCategoryId = category ? category.id : null;

  byId("categoryDialogTitle").textContent = category ? "Kategoriyi düzenle" : "Yeni kategori";
  byId("categorySaveBtn").textContent = category ? "Kaydet" : "Ekle";
  byId("categoryName").value = category ? category.name : "";
  byId("categoryColor").value = category ? category.color : "#2563eb";
  selectIcon(category ? category.icon : "");
  setEmojiPanelOpen(false);

  showNameError(undefined);
  byId("categoryDialog").showModal();
  byId("categoryName").focus();
}

function handleFormSubmit(event) {
  event.preventDefault();
  const input = {
    name: byId("categoryName").value,
    color: byId("categoryColor").value,
    icon: selectedIcon,
  };

  const errors = validateCategoryInput(input, editingCategoryId);
  showNameError(errors.name);
  if (Object.keys(errors).length > 0) return;

  if (editingCategoryId) {
    updateCategory(editingCategoryId, input);
    showToast("Kategori güncellendi.");
  } else {
    addCategory(input);
    showToast("Kategori eklendi.");
  }
  byId("categoryDialog").close();
  renderCategories();
}

// ---------------- SİLME ----------------

// Kategori boşsa basit onay yeterli. İçinde görev varsa kullanıcıya
// görevlerin nereye gideceğini soruyoruz; görevler asla silinmez.
function handleDelete(categoryId) {
  const category = getCategoryById(categoryId);
  if (!category) return;
  const count = countTasksInCategory(categoryId);

  if (count === 0) {
    askConfirm({
      title: "Kategori silinsin mi?",
      text: `"${category.name}" kategorisi silinecek.`,
      confirmLabel: "Sil",
      onConfirm: () => {
        deleteCategory(categoryId, null);
        renderCategories();
        showToast("Kategori silindi.");
      },
    });
    return;
  }

  deletingCategoryId = categoryId;
  byId("categoryDeleteText").textContent =
    `"${category.name}" kategorisinde ${count} görev var. Görevler silinmeyecek; nereye taşınsın?`;

  const others = getCategories()
    .filter((item) => item.id !== categoryId)
    .map((item) => ({ value: item.id, label: item.name }));
  fillSelect(byId("categoryMoveTarget"), others, "Kategorisiz bırak");
  byId("categoryMoveTarget").value = "";

  byId("categoryDeleteDialog").showModal();
}

function confirmDeleteWithMove() {
  if (!deletingCategoryId) return;
  deleteCategory(deletingCategoryId, byId("categoryMoveTarget").value);
  deletingCategoryId = null;
  byId("categoryDeleteDialog").close();
  renderCategories();
  showToast("Kategori silindi, görevler korundu.");
}

// ---------------- OLAYLAR ----------------

export function initCategories() {
  byId("newCategoryBtn").addEventListener("click", () => openCategoryForm(null));
  byId("categoryForm").addEventListener("submit", handleFormSubmit);
  byId("categoryCancelBtn").addEventListener("click", () => byId("categoryDialog").close());

  // Simge paneli: düğme paneli açıp kapatır, bir emojiye tıklamak seçip kapatır.
  buildEmojiPanel();
  byId("categoryIconBtn").addEventListener("click", () => {
    setEmojiPanelOpen(byId("emojiPanel").hidden);
  });
  byId("emojiPanel").addEventListener("click", (event) => {
    const button = event.target.closest(".emoji-btn");
    if (!button) return;
    selectIcon(button.dataset.emoji);
    setEmojiPanelOpen(false);
    byId("categoryIconBtn").focus();
  });

  byId("categoryDeleteOk").addEventListener("click", confirmDeleteWithMove);
  byId("categoryDeleteCancel").addEventListener("click", () => byId("categoryDeleteDialog").close());

  byId("categoryRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit") openCategoryForm(button.dataset.categoryId);
    if (button.dataset.action === "delete") handleDelete(button.dataset.categoryId);
  });
}
