// ==========================================================
// checklists.js — Kontrol listeleri sayfası
//   Üst bölüm:  aktif listeler (işaretlenebilir kopyalar)
//   Alt bölüm:  şablonlar (tekrar kullanılan kalıplar)
// ==========================================================

import {
  getTemplates, getTemplateById, addTemplate, updateTemplate, deleteTemplate, validateTemplateInput,
  getInstances, createInstanceFromTemplate, toggleInstanceItem, addInstanceItem, deleteInstanceItem,
  resetInstance, deleteInstance, getCategories, getCategoryById,
} from "../state.js";
import { createIconButton, createItemEditor, askConfirm } from "../components.js";
import { el, icon, clear, byId, showToast, percent, todayKey, formatShortDate, parseTags, fillSelect } from "../utils.js";

let editingTemplateId = null; // null ise form "yeni şablon" modunda
let usingTemplateId = null;   // "Kullan" penceresinde hangi şablon seçili
let templateItemEditor = null;

// ---------------- AKTİF LİSTELER ----------------

function createInstanceItemRow(instance, item) {
  const row = el("li", "checklist__item");
  if (item.done) row.classList.add("is-done");

  // <label> içine koyunca metne tıklamak da kutuyu işaretler.
  const label = el("label", "checklist__label");
  const check = el("input", "task__check");
  check.type = "checkbox";
  check.checked = item.done;
  check.dataset.instanceId = instance.id;
  check.dataset.itemId = item.id;
  label.append(check, el("span", "checklist__text", item.text));

  const remove = createIconButton("close", `Maddeyi sil: ${item.text}`, {
    action: "delete-item", instanceId: instance.id, itemId: item.id,
  });

  row.append(label, remove);
  return row;
}

function createInstanceCard(instance, today) {
  const card = el("article", "card checklist");
  const doneCount = instance.items.filter((item) => item.done).length;
  const total = instance.items.length;
  const donePercent = percent(doneCount, total);

  // Başlık
  const head = el("header", "card__head");
  const titles = el("div", "");
  let dateText = "Tarihsiz";
  if (instance.date !== "") {
    dateText = instance.date === today ? "Bugün" : formatShortDate(instance.date);
  }
  titles.append(el("h3", "card__title", instance.name), el("p", "card__hint", dateText));

  const actions = el("div", "task__actions");
  actions.append(
    createIconButton("reset", `İşaretleri sıfırla: ${instance.name}`, { action: "reset", instanceId: instance.id }),
    createIconButton("trash", `Listeyi sil: ${instance.name}`, { action: "delete", instanceId: instance.id }),
  );
  head.append(titles, actions);

  // İlerleme
  const progress = el("div", "checklist__progress");
  const bar = el("div", "bar");
  const fill = el("div", "bar__fill");
  fill.style.width = `${donePercent}%`;
  bar.append(fill);
  progress.append(bar, el("span", "checklist__count", `${doneCount}/${total} · %${donePercent}`));

  // Maddeler
  const list = el("ul", "checklist__items");
  for (const item of instance.items) {
    list.append(createInstanceItemRow(instance, item));
  }

  // Madde ekleme formu
  const form = el("form", "inline-add");
  form.dataset.instanceId = instance.id;
  const input = el("input", "input");
  input.type = "text";
  input.maxLength = 200;
  input.placeholder = "Madde ekle…";
  input.setAttribute("aria-label", `${instance.name} listesine madde ekle`);
  const addButton = el("button", "btn btn--ghost", "Ekle");
  addButton.type = "submit";
  form.append(input, addButton);

  card.append(head, progress, list, form);
  return card;
}

function renderInstances() {
  const container = byId("instanceList");
  clear(container);

  // En yeni tarihli üstte. Diziyi kopyalıyoruz ([...]) çünkü sort asıl diziyi değiştirir.
  const instances = [...getInstances()].sort((a, b) => b.date.localeCompare(a.date));

  if (instances.length === 0) {
    const empty = el("div", "card empty");
    empty.append(icon("inbox"), el("p", "", "Aktif liste yok. Aşağıdaki bir şablonda \"Kullan\"a bas."));
    container.append(empty);
    return;
  }

  const today = todayKey();
  for (const instance of instances) {
    container.append(createInstanceCard(instance, today));
  }
}

// ---------------- ŞABLONLAR ----------------

function createTemplateCard(template) {
  const card = el("article", "card tile");

  const body = el("div", "tile__body");
  body.append(el("h3", "card__title", template.name));
  if (template.description !== "") body.append(el("p", "card__hint", template.description));

  const meta = el("div", "task__meta");
  meta.append(el("span", "task__meta-item", `${template.items.length} madde`));
  const category = getCategoryById(template.categoryId);
  if (category) {
    const categoryItem = el("span", "task__meta-item");
    const dot = el("span", "dot");
    dot.style.setProperty("--cat", category.color);
    categoryItem.append(dot, el("span", "", category.name));
    meta.append(categoryItem);
  }
  for (const tag of template.tags) {
    meta.append(el("span", "tag", `#${tag}`));
  }
  body.append(meta);

  const foot = el("footer", "tile__foot");
  const useButton = el("button", "btn btn--ghost btn--sm", "Kullan");
  useButton.type = "button";
  useButton.dataset.action = "use";
  useButton.dataset.templateId = template.id;

  const actions = el("div", "task__actions");
  actions.append(
    createIconButton("edit", `Şablonu düzenle: ${template.name}`, { action: "edit", templateId: template.id }),
    createIconButton("trash", `Şablonu sil: ${template.name}`, { action: "delete", templateId: template.id }),
  );
  foot.append(useButton, actions);

  card.append(body, foot);
  return card;
}

function renderTemplates() {
  const container = byId("templateList");
  clear(container);
  const templates = getTemplates();

  if (templates.length === 0) {
    const empty = el("div", "card empty");
    empty.append(icon("inbox"), el("p", "", "Hiç şablon yok. \"Yeni şablon\" ile başla."));
    container.append(empty);
    return;
  }
  for (const template of templates) {
    container.append(createTemplateCard(template));
  }
}

export function renderChecklists() {
  byId("checklistsSummary").textContent =
    `${getInstances().length} aktif liste, ${getTemplates().length} şablon`;
  renderInstances();
  renderTemplates();
}

// ---------------- ŞABLON FORMU ----------------

function showTemplateErrors(errors) {
  const nameError = byId("templateNameError");
  nameError.textContent = errors.name || "";
  nameError.hidden = errors.name === undefined;
  byId("templateName").classList.toggle("is-invalid", errors.name !== undefined);

  const itemsError = byId("templateItemsError");
  itemsError.textContent = errors.items || "";
  itemsError.hidden = errors.items === undefined;
}

function openTemplateForm(templateId) {
  const template = templateId ? getTemplateById(templateId) : null;
  editingTemplateId = template ? template.id : null;

  fillSelect(byId("templateCategory"), getCategories().map((c) => ({ value: c.id, label: c.name })), "Kategorisiz");

  byId("templateDialogTitle").textContent = template ? "Şablonu düzenle" : "Yeni şablon";
  byId("templateSaveBtn").textContent = template ? "Kaydet" : "Ekle";
  byId("templateName").value = template ? template.name : "";
  byId("templateDescription").value = template ? template.description : "";
  byId("templateCategory").value = template && template.categoryId ? template.categoryId : "";
  byId("templateTags").value = template ? template.tags.join(", ") : "";
  byId("templateItemInput").value = "";
  templateItemEditor.setItems(template ? template.items : []);

  showTemplateErrors({});
  byId("templateDialog").showModal();
  byId("templateName").focus();
}

function handleTemplateSubmit(event) {
  event.preventDefault();
  const input = {
    name: byId("templateName").value,
    description: byId("templateDescription").value,
    categoryId: byId("templateCategory").value,
    tags: parseTags(byId("templateTags").value),
    items: templateItemEditor.getItems(),
  };

  const errors = validateTemplateInput(input);
  showTemplateErrors(errors);
  if (Object.keys(errors).length > 0) return;

  if (editingTemplateId) {
    updateTemplate(editingTemplateId, input);
    showToast("Şablon güncellendi.");
  } else {
    addTemplate(input);
    showToast("Şablon eklendi.");
  }
  byId("templateDialog").close();
  renderChecklists();
}

function addTemplateItemFromInput() {
  const input = byId("templateItemInput");
  const text = input.value.trim();
  if (text === "") return;
  templateItemEditor.addItem(text);
  input.value = "";
  input.focus();
}

// ---------------- ŞABLONU KULLAN ----------------

function openUseDialog(templateId) {
  const template = getTemplateById(templateId);
  if (!template) return;
  usingTemplateId = templateId;

  byId("useTemplateName").value = template.name;
  byId("useTemplateDate").value = todayKey();
  byId("useTemplateDialog").showModal();
}

function handleUseSubmit(event) {
  event.preventDefault();
  const instance = createInstanceFromTemplate(usingTemplateId, {
    name: byId("useTemplateName").value.trim(),
    date: byId("useTemplateDate").value,
  });
  byId("useTemplateDialog").close();
  usingTemplateId = null;

  if (instance) {
    renderChecklists();
    showToast("Liste oluşturuldu.");
    byId("instanceHeading").scrollIntoView({ block: "start" });
  }
}

// ---------------- OLAYLAR ----------------

function handleInstanceClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const instanceId = button.dataset.instanceId;
  const action = button.dataset.action;

  if (action === "reset") {
    resetInstance(instanceId);
    renderChecklists();
    showToast("İşaretler sıfırlandı.");
  }
  if (action === "delete-item") {
    deleteInstanceItem(instanceId, button.dataset.itemId);
    renderChecklists();
  }
  if (action === "delete") {
    askConfirm({
      title: "Liste silinsin mi?",
      text: "Bu liste ve işaretlerin silinecek. Şablonu etkilenmez.",
      confirmLabel: "Sil",
      onConfirm: () => {
        deleteInstance(instanceId);
        renderChecklists();
        showToast("Liste silindi.");
      },
    });
  }
}

function handleInstanceSubmit(event) {
  event.preventDefault(); // submit olayı formdan yukarı doğru yayılır, burada yakalıyoruz
  const form = event.target;
  const instanceId = form.dataset.instanceId;
  const text = form.querySelector("input").value.trim();
  if (text === "") return;

  addInstanceItem(instanceId, text);
  renderChecklists();

  // Liste yeniden çizildi; art arda madde yazabilmek için aynı kutuya geri odaklan.
  const newForm = byId("instanceList").querySelector(`form[data-instance-id="${instanceId}"]`);
  if (newForm) newForm.querySelector("input").focus();
}

function handleTemplateClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const templateId = button.dataset.templateId;
  const action = button.dataset.action;

  if (action === "use") openUseDialog(templateId);
  if (action === "edit") openTemplateForm(templateId);
  if (action === "delete") {
    const template = getTemplateById(templateId);
    if (!template) return;
    askConfirm({
      title: "Şablon silinsin mi?",
      text: `"${template.name}" şablonu silinecek. Ondan oluşturduğun listeler kalır.`,
      confirmLabel: "Sil",
      onConfirm: () => {
        deleteTemplate(templateId);
        renderChecklists();
        showToast("Şablon silindi.");
      },
    });
  }
}

export function initChecklists() {
  templateItemEditor = createItemEditor(byId("templateItemList"), { showCheck: false });

  byId("newTemplateBtn").addEventListener("click", () => openTemplateForm(null));
  byId("templateForm").addEventListener("submit", handleTemplateSubmit);
  byId("templateCancelBtn").addEventListener("click", () => byId("templateDialog").close());

  byId("templateItemAddBtn").addEventListener("click", addTemplateItemFromInput);
  byId("templateItemInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTemplateItemFromInput();
    }
  });

  byId("useTemplateForm").addEventListener("submit", handleUseSubmit);
  byId("useTemplateCancel").addEventListener("click", () => byId("useTemplateDialog").close());

  const instanceList = byId("instanceList");
  instanceList.addEventListener("click", handleInstanceClick);
  instanceList.addEventListener("submit", handleInstanceSubmit);
  instanceList.addEventListener("change", (event) => {
    if (event.target.matches(".task__check")) {
      toggleInstanceItem(event.target.dataset.instanceId, event.target.dataset.itemId);
      renderChecklists();
    }
  });

  byId("templateList").addEventListener("click", handleTemplateClick);
}
