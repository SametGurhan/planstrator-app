// ==========================================================
// travel.js — Seyahat planlama
// Her seyahatin üç listesi vardır: gün gün plan, bavul listesi ve harcamalar.
// Üstte seyahat kartları, altta seçili seyahatin ayrıntısı gösterilir.
// ==========================================================

import { tripStore, validateTripInput, getTemplates, copyTemplateItems } from "../state.js";
import { createIconButton, createEmptyState, setFieldError, askConfirm } from "../components.js";
import { createStatCard } from "./dashboard.js";
import {
  todayKey, addDays, daysBetween, formatShortDate, formatDayMonth, formatMoney, percent,
  createId, el, icon, clear, byId, showToast, fillSelect,
} from "../utils.js";

let selectedTripId = null; // ayrıntısı gösterilen seyahat
let editingTripId = null;

// ---------------- HESAPLAMA ----------------

function getCountdownText(trip, today) {
  if (trip.startDate === "") return "Tarih belirlenmedi";
  const endDate = trip.endDate || trip.startDate;
  if (today < trip.startDate) return `${daysBetween(today, trip.startDate)} gün kaldı`;
  if (today <= endDate) return `Seyahattesin · ${daysBetween(trip.startDate, today) + 1}. gün`;
  return "Tamamlandı";
}

function getDateRangeText(trip) {
  if (trip.startDate === "") return "Tarih yok";
  if (trip.endDate === "" || trip.endDate === trip.startDate) return formatShortDate(trip.startDate);
  return `${formatDayMonth(trip.startDate)} – ${formatDayMonth(trip.endDate)}`;
}

function getTotalSpent(trip) {
  let total = 0;
  for (const expense of trip.expenses) {
    total += expense.amount;
  }
  return total;
}

// Planı tarihe, sonra saate göre sıralar. Tarihsizler sonda.
function comparePlanItems(a, b) {
  if (a.date !== b.date) {
    if (a.date === "") return 1;
    if (b.date === "") return -1;
    return a.date.localeCompare(b.date);
  }
  return a.time.localeCompare(b.time);
}

// ---------------- KÜÇÜK YARDIMCILAR ----------------

function createInput(type, placeholder, label) {
  const input = el("input", "input");
  input.type = type;
  if (placeholder) input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  return input;
}

// Satır içi form: kutular + "Ekle" düğmesi. formName gönderildiğinde hangisi olduğunu anlamak için.
function createInlineForm(formName, inputs) {
  const form = el("form", "inline-add inline-add--wrap");
  form.dataset.form = formName;
  form.noValidate = true;
  const button = el("button", "btn btn--ghost", "Ekle");
  button.type = "submit";
  form.append(...inputs, button);
  return form;
}

function createCardShell(title, hint) {
  const card = el("article", "card");
  const head = el("header", "card__head");
  head.append(el("h3", "card__title", title), el("span", "card__hint", hint));
  card.append(head);
  return card;
}

// ---------------- SEYAHAT KARTLARI ----------------

function createTripTile(trip, today) {
  const tile = el("article", "card tile trip");
  if (trip.id === selectedTripId) tile.classList.add("is-active");

  // Başlık bir düğme: tıklanınca bu seyahatin ayrıntısı açılır.
  const select = el("button", "trip__select");
  select.type = "button";
  select.dataset.action = "select";
  select.dataset.tripId = trip.id;
  select.setAttribute("aria-pressed", String(trip.id === selectedTripId));
  select.append(
    el("span", "card__title", trip.name),
    el("span", "card__hint", trip.destination !== "" ? `${trip.destination} · ${getDateRangeText(trip)}` : getDateRangeText(trip)),
  );

  const foot = el("footer", "tile__foot");
  const actions = el("div", "task__actions");
  actions.append(
    createIconButton("edit", `Düzenle: ${trip.name}`, { action: "edit", tripId: trip.id }),
    createIconButton("trash", `Sil: ${trip.name}`, { action: "delete", tripId: trip.id }),
  );
  foot.append(el("span", "badge", getCountdownText(trip, today)), actions);

  tile.append(select, foot);
  return tile;
}

// ---------------- AYRINTI: PLAN ----------------

function createPlanCard(trip) {
  const card = createCardShell("Gün gün plan", `${trip.plan.length} etkinlik`);
  const list = el("ul", "plan");
  const sorted = [...trip.plan].sort(comparePlanItems);

  if (sorted.length === 0) list.append(createEmptyState("Plan boş. Aşağıdan ilk etkinliği ekle."));

  let lastDate = null;
  for (const item of sorted) {
    // Tarih değiştiğinde araya bir gün başlığı koy.
    if (item.date !== lastDate) {
      let heading = "Tarihsiz";
      if (item.date !== "") {
        heading = formatShortDate(item.date);
        if (trip.startDate !== "" && item.date >= trip.startDate) {
          heading += ` · ${daysBetween(trip.startDate, item.date) + 1}. gün`;
        }
      }
      list.append(el("li", "plan__day", heading));
      lastDate = item.date;
    }
    const row = el("li", "plan__item");
    row.append(
      el("span", "plan__time", item.time !== "" ? item.time : "—"),
      el("span", "plan__title", item.title),
      createIconButton("close", `Etkinliği sil: ${item.title}`, { action: "delete-plan", itemId: item.id }),
    );
    list.append(row);
  }

  const dateInput = createInput("date", "", "Etkinlik tarihi");
  dateInput.name = "date";
  dateInput.value = trip.startDate;
  if (trip.startDate !== "") dateInput.min = trip.startDate;
  if (trip.endDate !== "") dateInput.max = trip.endDate;
  const timeInput = createInput("time", "", "Etkinlik saati");
  timeInput.name = "time";
  const titleInput = createInput("text", "Etkinlik (ör. Müze gezisi)", "Etkinlik adı");
  titleInput.name = "title";
  titleInput.maxLength = 120;

  card.append(list, createInlineForm("plan", [dateInput, timeInput, titleInput]));
  return card;
}

// ---------------- AYRINTI: BAVUL ----------------

function createPackingCard(trip) {
  const doneCount = trip.packing.filter((item) => item.done).length;
  const card = createCardShell("Bavul listesi", `${doneCount} / ${trip.packing.length} hazır`);

  const progress = el("div", "checklist__progress");
  const bar = el("div", "bar");
  const fill = el("div", "bar__fill");
  fill.style.width = `${percent(doneCount, trip.packing.length)}%`;
  bar.append(fill);
  progress.append(bar);

  const list = el("ul", "checklist__items");
  for (const item of trip.packing) {
    const row = el("li", "checklist__item");
    if (item.done) row.classList.add("is-done");
    const label = el("label", "checklist__label");
    const check = el("input", "task__check");
    check.type = "checkbox";
    check.checked = item.done;
    check.dataset.itemId = item.id;
    label.append(check, el("span", "checklist__text", item.text));
    row.append(label, createIconButton("close", `Sil: ${item.text}`, { action: "delete-packing", itemId: item.id }));
    list.append(row);
  }

  const textInput = createInput("text", "Eşya ekle…", "Bavul listesine eşya ekle");
  textInput.name = "text";
  textInput.maxLength = 200;

  // Kontrol listesi şablonlarından (ör. Seyahat hazırlığı) toplu ekleme
  const templateSelect = el("select", "input");
  templateSelect.dataset.role = "packing-template";
  templateSelect.setAttribute("aria-label", "Şablondan eşya ekle");
  fillSelect(templateSelect, getTemplates().map((template) => ({ value: template.id, label: template.name })), "Şablondan ekle…");

  card.append(progress, list, createInlineForm("packing", [textInput]), templateSelect);
  return card;
}

// ---------------- AYRINTI: HARCAMALAR ----------------

function createExpenseCard(trip) {
  const spent = getTotalSpent(trip);
  const card = createCardShell("Harcamalar", `Toplam ${formatMoney(spent)}`);

  const list = el("ul", "task-list");
  if (trip.expenses.length === 0) list.append(createEmptyState("Henüz harcama yok."));
  for (const expense of trip.expenses) {
    const row = el("li", "row row--compact");
    const body = el("div", "row__body");
    body.append(el("p", "row__title", expense.title));
    row.append(
      body,
      el("span", "badge", formatMoney(expense.amount)),
      createIconButton("close", `Harcamayı sil: ${expense.title}`, { action: "delete-expense", itemId: expense.id }),
    );
    list.append(row);
  }

  const titleInput = createInput("text", "Harcama (ör. Otel)", "Harcama adı");
  titleInput.name = "title";
  titleInput.maxLength = 80;
  const amountInput = createInput("number", "Tutar (₺)", "Harcama tutarı");
  amountInput.name = "amount";
  amountInput.min = "0";
  amountInput.step = "any";

  card.append(list, createInlineForm("expense", [titleInput, amountInput]));
  return card;
}

// ---------------- ANA ÇİZİM ----------------

function renderDetail(trip, today) {
  const detail = byId("tripDetail");
  clear(detail);
  if (!trip) return;

  const spent = getTotalSpent(trip);
  const dayCount = trip.startDate !== "" && trip.endDate !== "" ? daysBetween(trip.startDate, trip.endDate) + 1 : 0;
  let budgetNote = "Bütçe belirlenmedi";
  if (trip.budget > 0) {
    budgetNote = spent <= trip.budget
      ? `${formatMoney(trip.budget - spent)} kaldı (${formatMoney(trip.budget)} bütçe)`
      : `Bütçe ${formatMoney(spent - trip.budget)} aşıldı`;
  }

  detail.append(el("h2", "section-title", trip.destination !== "" ? `${trip.name} · ${trip.destination}` : trip.name));
  if (trip.notes !== "") detail.append(el("p", "trip__notes", trip.notes));

  const stats = el("div", "stat-grid");
  stats.append(
    createStatCard({ tone: "accent", iconName: "calendar", label: "Tarih", value: getDateRangeText(trip), note: dayCount > 0 ? `${dayCount} gün` : "Süre belirsiz" }),
    createStatCard({ tone: "ok", iconName: "plane", label: "Durum", value: getCountdownText(trip, today), note: `${trip.plan.length} etkinlik planlandı` }),
    createStatCard({ tone: trip.budget > 0 && spent > trip.budget ? "danger" : "warn", iconName: "tag", label: "Harcanan", value: formatMoney(spent), note: budgetNote }),
  );

  const grid = el("div", "dash-grid");
  const left = el("div", "dash-col");
  const right = el("div", "dash-col");
  left.append(createPlanCard(trip));
  right.append(createPackingCard(trip), createExpenseCard(trip));
  grid.append(left, right);

  detail.append(stats, grid);
}

export function renderTravel() {
  const today = todayKey();
  const trips = tripStore.all();
  byId("travelSummary").textContent = `${trips.length} seyahat`;

  // Seçili seyahat silinmişse ya da hiç seçilmemişse ilk seyahati seç.
  if (!tripStore.get(selectedTripId)) {
    selectedTripId = trips.length > 0 ? trips[0].id : null;
  }

  const list = byId("tripList");
  clear(list);
  if (trips.length === 0) {
    const empty = el("div", "card empty");
    empty.append(icon("plane"), el("p", "", "Henüz seyahat yok. \"Yeni seyahat\" ile ilk planını oluştur."));
    list.append(empty);
  }
  for (const trip of trips) {
    list.append(createTripTile(trip, today));
  }

  renderDetail(tripStore.get(selectedTripId), today);
}

// ---------------- SEYAHAT FORMU ----------------

function openTripForm(tripId) {
  const trip = tripId ? tripStore.get(tripId) : null;
  editingTripId = trip ? trip.id : null;

  byId("tripDialogTitle").textContent = trip ? "Seyahati düzenle" : "Yeni seyahat";
  byId("tripSaveBtn").textContent = trip ? "Kaydet" : "Ekle";
  byId("tripName").value = trip ? trip.name : "";
  byId("tripDestination").value = trip ? trip.destination : "";
  byId("tripStart").value = trip ? trip.startDate : addDays(todayKey(), 7);
  byId("tripEnd").value = trip ? trip.endDate : addDays(todayKey(), 9);
  byId("tripBudget").value = trip && trip.budget > 0 ? trip.budget : "";
  byId("tripNotes").value = trip ? trip.notes : "";

  showTripErrors({});
  byId("tripDialog").showModal();
  byId("tripName").focus();
}

function showTripErrors(errors) {
  setFieldError("tripName", "tripNameError", errors.name);
  setFieldError("tripEnd", "tripEndError", errors.endDate);
  setFieldError("tripBudget", "tripBudgetError", errors.budget);
}

function handleTripSubmit(event) {
  event.preventDefault();
  const input = {
    name: byId("tripName").value,
    destination: byId("tripDestination").value,
    startDate: byId("tripStart").value,
    endDate: byId("tripEnd").value,
    budget: byId("tripBudget").value,
    notes: byId("tripNotes").value,
  };

  const errors = validateTripInput(input);
  showTripErrors(errors);
  if (Object.keys(errors).length > 0) return;

  if (editingTripId) {
    tripStore.update(editingTripId, input);
    showToast("Seyahat güncellendi.");
  } else {
    selectedTripId = tripStore.add(input).id; // yeni seyahat hemen açılsın
    showToast("Seyahat eklendi.");
  }
  byId("tripDialog").close();
  renderTravel();
}

// ---------------- OLAYLAR ----------------

function handleListClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const trip = tripStore.get(button.dataset.tripId);
  if (!trip) return;

  if (button.dataset.action === "select") {
    selectedTripId = trip.id;
    renderTravel();
  }
  if (button.dataset.action === "edit") openTripForm(trip.id);
  if (button.dataset.action === "delete") {
    askConfirm({
      title: "Seyahat silinsin mi?",
      text: `"${trip.name}" ile birlikte planı, bavul listesi ve harcamaları silinecek.`,
      confirmLabel: "Sil",
      onConfirm: () => {
        tripStore.remove(trip.id);
        renderTravel();
        showToast("Seyahat silindi.");
      },
    });
  }
}

// Ayrıntıdaki üç formdan biri gönderildi.
function handleDetailSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const trip = tripStore.get(selectedTripId);
  if (!trip) return;

  // form.elements.title -> name="title" olan kutu
  if (form.dataset.form === "plan") {
    const title = form.elements.title.value.trim();
    if (title === "") return;
    const newItem = { id: createId("pl"), date: form.elements.date.value, time: form.elements.time.value, title: title };
    tripStore.update(trip.id, { plan: [...trip.plan, newItem] });
  }
  if (form.dataset.form === "packing") {
    const text = form.elements.text.value.trim();
    if (text === "") return;
    tripStore.update(trip.id, { packing: [...trip.packing, { id: createId("i"), text: text, done: false }] });
  }
  if (form.dataset.form === "expense") {
    const title = form.elements.title.value.trim();
    const amount = Number(form.elements.amount.value);
    if (title === "" || !(amount > 0)) {
      showToast("Harcama adı ve 0'dan büyük bir tutar gir.");
      return;
    }
    tripStore.update(trip.id, { expenses: [...trip.expenses, { id: createId("ex"), title: title, amount: amount }] });
  }

  renderTravel();
  // Art arda ekleme yapabilmek için aynı formun ilk metin kutusuna geri odaklan.
  const sameForm = byId("tripDetail").querySelector(`form[data-form="${form.dataset.form}"]`);
  if (sameForm) sameForm.querySelector('input[type="text"]').focus();
}

function handleDetailClick(event) {
  const button = event.target.closest("[data-action]");
  const trip = tripStore.get(selectedTripId);
  if (!button || !trip) return;
  const itemId = button.dataset.itemId;

  if (button.dataset.action === "delete-plan") {
    tripStore.update(trip.id, { plan: trip.plan.filter((item) => item.id !== itemId) });
  }
  if (button.dataset.action === "delete-packing") {
    tripStore.update(trip.id, { packing: trip.packing.filter((item) => item.id !== itemId) });
  }
  if (button.dataset.action === "delete-expense") {
    tripStore.update(trip.id, { expenses: trip.expenses.filter((item) => item.id !== itemId) });
  }
  renderTravel();
}

function handleDetailChange(event) {
  const trip = tripStore.get(selectedTripId);
  if (!trip) return;

  // Bavul listesinde bir kutu işaretlendi.
  if (event.target.matches(".task__check")) {
    const itemId = event.target.dataset.itemId;
    const packing = trip.packing.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item));
    tripStore.update(trip.id, { packing: packing });
    renderTravel();
  }
  // Şablondan eşya ekleme: şablonun maddeleri kopyalanır, şablon değişmez.
  if (event.target.dataset.role === "packing-template" && event.target.value !== "") {
    tripStore.update(trip.id, { packing: [...trip.packing, ...copyTemplateItems(event.target.value)] });
    renderTravel();
    showToast("Şablondaki maddeler bavul listesine eklendi.");
  }
}

export function initTravel() {
  byId("newTripBtn").addEventListener("click", () => openTripForm(null));
  byId("tripForm").addEventListener("submit", handleTripSubmit);
  byId("tripCancelBtn").addEventListener("click", () => byId("tripDialog").close());

  byId("tripList").addEventListener("click", handleListClick);

  const detail = byId("tripDetail");
  detail.addEventListener("submit", handleDetailSubmit);
  detail.addEventListener("click", handleDetailClick);
  detail.addEventListener("change", handleDetailChange);
}
