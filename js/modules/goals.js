// ==========================================================
// goals.js — Hedefler ve alışkanlıklar sayfası
//   Alışkanlık: düzenli tekrarlanan davranış (her gün / haftada N gün). Günlük işaretlenir.
//   Hedef:      ulaşılacak bir sonuç (20 bölüm bitir / projeyi yayınla). İlerleme ölçülür.
// ==========================================================

import {
  goalStore, habitStore, validateGoalInput, validateHabitInput,
  isHabitDone, toggleHabitEntry, deleteHabit, getCategories, getCategoryById,
} from "../state.js";
import { createEmptyState, createIconButton, createCategoryMeta, setFieldError, askConfirm } from "../components.js";
import {
  todayKey, addDays, startOfWeek, daysBetween, formatLongDate, formatShortDate, percent,
  el, icon, clear, byId, showToast, fillSelect,
} from "../utils.js";

const WEEKDAY_LETTERS = ["P", "S", "Ç", "P", "C", "C", "P"]; // Pazartesi ... Pazar

let editingGoalId = null;
let editingHabitId = null;

// ---------------- ALIŞKANLIK HESAPLARI ----------------

// Art arda kaç gündür yapılıyor? Bugün henüz işaretlenmediyse dünden saymaya başlarız
// (gün bitmeden seri "kırılmış" görünmesin).
function getDailyStreak(habitId, today) {
  let date = isHabitDone(habitId, today) ? today : addDays(today, -1);
  let streak = 0;
  while (isHabitDone(habitId, date)) {
    streak += 1;
    date = addDays(date, -1);
  }
  return streak;
}

function countWeekEntries(habitId, weekStart) {
  let count = 0;
  for (let index = 0; index < 7; index++) {
    if (isHabitDone(habitId, addDays(weekStart, index))) count += 1;
  }
  return count;
}

// Bugün yapılması gereken alışkanlıkların kaçı yapıldı? (Dashboard kullanır.)
export function getHabitSummary() {
  const today = todayKey();
  const habits = habitStore.all();
  const doneCount = habits.filter((habit) => isHabitDone(habit.id, today)).length;
  return { done: doneCount, total: habits.length };
}

// ---------------- ALIŞKANLIK ÇİZİMİ ----------------

function createHabitRow(habit, today, weekStart) {
  const row = el("li", "habit");
  const weekCount = countWeekEntries(habit.id, weekStart);

  let hint = `Her gün · ${getDailyStreak(habit.id, today)} gün seri`;
  let isMet = isHabitDone(habit.id, today);
  if (habit.frequency === "weekly") {
    hint = `Haftada ${habit.weeklyTarget} gün · bu hafta ${weekCount}/${habit.weeklyTarget}`;
    isMet = weekCount >= habit.weeklyTarget;
  }
  if (isMet) row.classList.add("is-met");

  const info = el("div", "habit__info");
  info.append(el("p", "row__title", habit.title));
  const meta = el("div", "task__meta");
  meta.append(el("span", "task__meta-item", hint));
  const category = getCategoryById(habit.categoryId);
  if (category) meta.append(createCategoryMeta(category));
  info.append(meta);

  // Bu haftanın 7 günü: tıklanınca o gün işaretlenir / işareti kalkar.
  const days = el("div", "habit__days");
  for (let index = 0; index < 7; index++) {
    const dateKey = addDays(weekStart, index);
    const isDone = isHabitDone(habit.id, dateKey);
    const button = el("button", "day-dot", WEEKDAY_LETTERS[index]);
    button.type = "button";
    button.dataset.habitId = habit.id;
    button.dataset.date = dateKey;
    button.disabled = dateKey > today; // gelecek günler işaretlenemez
    if (isDone) button.classList.add("is-done");
    if (dateKey === today) button.classList.add("is-today");
    button.setAttribute("aria-pressed", String(isDone));
    button.setAttribute("aria-label", `${habit.title}, ${formatLongDate(dateKey)}: ${isDone ? "yapıldı" : "yapılmadı"}`);
    days.append(button);
  }

  const actions = el("div", "task__actions");
  actions.append(
    createIconButton("edit", `Düzenle: ${habit.title}`, { action: "edit", habitId: habit.id }),
    createIconButton("trash", `Sil: ${habit.title}`, { action: "delete", habitId: habit.id }),
  );

  row.append(info, days, actions);
  return row;
}

function renderHabits() {
  const list = byId("habitList");
  clear(list);
  const habits = habitStore.all();

  if (habits.length === 0) {
    list.append(createEmptyState("Henüz alışkanlık yok. \"Yeni alışkanlık\" ile ilkini ekle."));
    return;
  }
  const today = todayKey();
  const weekStart = startOfWeek(today);
  for (const habit of habits) {
    list.append(createHabitRow(habit, today, weekStart));
  }
}

// ---------------- HEDEF ÇİZİMİ ----------------

function getGoalStatusText(goal, today) {
  if (goal.completedAt !== null) return "Tamamlandı";
  if (goal.endDate === "") return "Süresiz";
  if (goal.endDate < today) return "Süresi doldu";
  if (goal.endDate === today) return "Son gün";
  return `${daysBetween(today, goal.endDate)} gün kaldı`;
}

function createGoalCard(goal, today) {
  const card = el("article", "card tile");
  const isDone = goal.completedAt !== null;
  const isExpired = !isDone && goal.endDate !== "" && goal.endDate < today;
  if (isDone) card.classList.add("is-done");

  const head = el("header", "card__head");
  const badge = el("span", isExpired ? "badge badge--danger" : "badge", getGoalStatusText(goal, today));
  head.append(el("h3", "card__title", goal.title), badge);

  const body = el("div", "tile__body");
  if (goal.description !== "") body.append(el("p", "card__hint", goal.description));

  const donePercent = percent(goal.currentValue, goal.targetValue);
  const bar = el("div", "bar");
  const fill = el("div", "bar__fill");
  fill.style.width = `${donePercent}%`;
  bar.append(fill);

  const valueText = goal.type === "simple"
    ? (isDone ? "Yapıldı" : "Henüz yapılmadı")
    : `${goal.currentValue} / ${goal.targetValue} ${goal.unit} · %${donePercent}`;
  body.append(bar, el("p", "goal-card__value", valueText));

  const meta = el("div", "task__meta");
  if (goal.startDate !== "" || goal.endDate !== "") {
    const startText = goal.startDate !== "" ? formatShortDate(goal.startDate) : "…";
    const endText = goal.endDate !== "" ? formatShortDate(goal.endDate) : "…";
    meta.append(el("span", "task__meta-item", `${startText} – ${endText}`));
  }
  const category = getCategoryById(goal.categoryId);
  if (category) meta.append(createCategoryMeta(category));
  body.append(meta);

  // Alt satır: ilerleme düğmeleri + düzenle / sil
  const foot = el("footer", "tile__foot");
  const progress = el("div", "goal-card__buttons");
  if (goal.type === "simple") {
    const toggle = el("button", "btn btn--ghost btn--sm", isDone ? "Geri al" : "Yapıldı işaretle");
    toggle.type = "button";
    toggle.dataset.action = "toggle";
    toggle.dataset.goalId = goal.id;
    progress.append(toggle);
  } else {
    const minus = el("button", "btn btn--ghost btn--sm", "− 1");
    minus.type = "button";
    minus.dataset.action = "decrease";
    minus.dataset.goalId = goal.id;
    minus.disabled = goal.currentValue <= 0;
    minus.setAttribute("aria-label", `${goal.title}: ilerlemeyi 1 azalt`);

    const plus = el("button", "btn btn--ghost btn--sm", "+ 1");
    plus.type = "button";
    plus.dataset.action = "increase";
    plus.dataset.goalId = goal.id;
    plus.setAttribute("aria-label", `${goal.title}: ilerlemeyi 1 artır`);
    progress.append(minus, plus);
  }

  const actions = el("div", "task__actions");
  actions.append(
    createIconButton("edit", `Düzenle: ${goal.title}`, { action: "edit", goalId: goal.id }),
    createIconButton("trash", `Sil: ${goal.title}`, { action: "delete", goalId: goal.id }),
  );
  foot.append(progress, actions);

  card.append(head, body, foot);
  return card;
}

function renderGoals() {
  const container = byId("goalCards");
  clear(container);
  const goals = goalStore.all();

  if (goals.length === 0) {
    const empty = el("div", "card empty");
    empty.append(icon("inbox"), el("p", "", "Henüz hedef yok. \"Yeni hedef\" ile ilkini ekle."));
    container.append(empty);
    return;
  }
  // Devam edenler önce, tamamlananlar sonda.
  const today = todayKey();
  const sorted = [...goals].sort((a, b) => Number(a.completedAt !== null) - Number(b.completedAt !== null));
  for (const goal of sorted) {
    container.append(createGoalCard(goal, today));
  }
}

export function renderGoalsPage() {
  const summary = getHabitSummary();
  const activeGoals = goalStore.all().filter((goal) => goal.completedAt === null).length;
  byId("goalsSummary").textContent =
    `Bugün ${summary.done} / ${summary.total} alışkanlık · ${activeGoals} devam eden hedef`;
  renderHabits();
  renderGoals();
}

// ---------------- FORMLAR ----------------

function categoryOptions() {
  return getCategories().map((category) => ({ value: category.id, label: category.name }));
}

// Hedef türüne göre sayısal alanları göster / gizle.
function updateGoalFields() {
  byId("goalNumericFields").hidden = byId("goalType").value === "simple";
}

function openGoalForm(goalId) {
  const goal = goalId ? goalStore.get(goalId) : null;
  editingGoalId = goal ? goal.id : null;

  fillSelect(byId("goalCategory"), categoryOptions(), "Kategorisiz");
  byId("goalDialogTitle").textContent = goal ? "Hedefi düzenle" : "Yeni hedef";
  byId("goalSaveBtn").textContent = goal ? "Kaydet" : "Ekle";
  byId("goalTitle").value = goal ? goal.title : "";
  byId("goalDescription").value = goal ? goal.description : "";
  byId("goalType").value = goal ? goal.type : "numeric";
  byId("goalTarget").value = goal ? goal.targetValue : "";
  byId("goalCurrent").value = goal ? goal.currentValue : 0;
  byId("goalUnit").value = goal ? goal.unit : "";
  byId("goalStart").value = goal ? goal.startDate : todayKey();
  byId("goalEnd").value = goal ? goal.endDate : "";
  byId("goalCategory").value = goal && goal.categoryId ? goal.categoryId : "";

  showGoalErrors({});
  updateGoalFields();
  byId("goalDialog").showModal();
  byId("goalTitle").focus();
}

function showGoalErrors(errors) {
  setFieldError("goalTitle", "goalTitleError", errors.title);
  setFieldError("goalTarget", "goalTargetError", errors.targetValue || errors.currentValue);
  setFieldError("goalEnd", "goalEndError", errors.endDate);
}

function handleGoalSubmit(event) {
  event.preventDefault();
  const input = {
    title: byId("goalTitle").value,
    description: byId("goalDescription").value,
    type: byId("goalType").value,
    targetValue: byId("goalTarget").value,
    currentValue: byId("goalCurrent").value,
    unit: byId("goalUnit").value,
    startDate: byId("goalStart").value,
    endDate: byId("goalEnd").value,
    categoryId: byId("goalCategory").value,
  };

  const errors = validateGoalInput(input);
  showGoalErrors(errors);
  if (Object.keys(errors).length > 0) return;

  if (editingGoalId) {
    goalStore.update(editingGoalId, input);
    showToast("Hedef güncellendi.");
  } else {
    goalStore.add(input);
    showToast("Hedef eklendi.");
  }
  byId("goalDialog").close();
  renderGoalsPage();
}

function updateHabitFields() {
  byId("habitWeeklyField").hidden = byId("habitFrequency").value !== "weekly";
}

function openHabitForm(habitId) {
  const habit = habitId ? habitStore.get(habitId) : null;
  editingHabitId = habit ? habit.id : null;

  fillSelect(byId("habitCategory"), categoryOptions(), "Kategorisiz");
  byId("habitDialogTitle").textContent = habit ? "Alışkanlığı düzenle" : "Yeni alışkanlık";
  byId("habitSaveBtn").textContent = habit ? "Kaydet" : "Ekle";
  byId("habitTitle").value = habit ? habit.title : "";
  byId("habitFrequency").value = habit ? habit.frequency : "daily";
  byId("habitWeekly").value = habit ? habit.weeklyTarget : 3;
  byId("habitCategory").value = habit && habit.categoryId ? habit.categoryId : "";

  setFieldError("habitTitle", "habitTitleError", undefined);
  setFieldError("habitWeekly", "habitWeeklyError", undefined);
  updateHabitFields();
  byId("habitDialog").showModal();
  byId("habitTitle").focus();
}

function handleHabitSubmit(event) {
  event.preventDefault();
  const input = {
    title: byId("habitTitle").value,
    frequency: byId("habitFrequency").value,
    weeklyTarget: byId("habitWeekly").value,
    categoryId: byId("habitCategory").value,
  };

  const errors = validateHabitInput(input);
  setFieldError("habitTitle", "habitTitleError", errors.title);
  setFieldError("habitWeekly", "habitWeeklyError", errors.weeklyTarget);
  if (Object.keys(errors).length > 0) return;

  if (editingHabitId) {
    habitStore.update(editingHabitId, input); // geçmiş kayıtlara dokunulmaz
    showToast("Alışkanlık güncellendi.");
  } else {
    habitStore.add(input);
    showToast("Alışkanlık eklendi.");
  }
  byId("habitDialog").close();
  renderGoalsPage();
}

// ---------------- OLAYLAR ----------------

function handleHabitClick(event) {
  const dayButton = event.target.closest(".day-dot");
  if (dayButton) {
    toggleHabitEntry(dayButton.dataset.habitId, dayButton.dataset.date);
    renderGoalsPage();
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const habit = habitStore.get(button.dataset.habitId);
  if (!habit) return;

  if (button.dataset.action === "edit") openHabitForm(habit.id);
  if (button.dataset.action === "delete") {
    askConfirm({
      title: "Alışkanlık silinsin mi?",
      text: `"${habit.title}" ve tüm işaretleme geçmişi silinecek.`,
      confirmLabel: "Sil",
      onConfirm: () => {
        deleteHabit(habit.id);
        renderGoalsPage();
        showToast("Alışkanlık silindi.");
      },
    });
  }
}

function handleGoalClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const goal = goalStore.get(button.dataset.goalId);
  if (!goal) return;
  const action = button.dataset.action;

  if (action === "increase") goalStore.update(goal.id, { currentValue: goal.currentValue + 1 });
  if (action === "decrease") goalStore.update(goal.id, { currentValue: Math.max(0, goal.currentValue - 1) });
  if (action === "toggle") goalStore.update(goal.id, { currentValue: goal.currentValue >= 1 ? 0 : 1 });
  if (action === "edit") {
    openGoalForm(goal.id);
    return;
  }
  if (action === "delete") {
    askConfirm({
      title: "Hedef silinsin mi?",
      text: `"${goal.title}" hedefi ve ilerlemesi silinecek.`,
      confirmLabel: "Sil",
      onConfirm: () => {
        goalStore.remove(goal.id);
        renderGoalsPage();
        showToast("Hedef silindi.");
      },
    });
    return;
  }

  renderGoalsPage();
  const updated = goalStore.get(goal.id);
  if (goal.completedAt === null && updated.completedAt !== null) showToast(`Tebrikler! "${goal.title}" hedefine ulaştın.`);
}

export function initGoals() {
  byId("newGoalBtn").addEventListener("click", () => openGoalForm(null));
  byId("newHabitBtn").addEventListener("click", () => openHabitForm(null));

  byId("goalForm").addEventListener("submit", handleGoalSubmit);
  byId("goalCancelBtn").addEventListener("click", () => byId("goalDialog").close());
  byId("goalType").addEventListener("change", updateGoalFields);

  byId("habitForm").addEventListener("submit", handleHabitSubmit);
  byId("habitCancelBtn").addEventListener("click", () => byId("habitDialog").close());
  byId("habitFrequency").addEventListener("change", updateHabitFields);

  byId("habitList").addEventListener("click", handleHabitClick);
  byId("goalCards").addEventListener("click", handleGoalClick);
}
