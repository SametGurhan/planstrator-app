// ==========================================================
// dashboard.js — Dashboard'un hesaplamaları ve ekrana çizimi
//
// İki bölüm var:
//   1) HESAPLAMA: veriden sayı/liste üreten fonksiyonlar (DOM'a dokunmaz)
//   2) ÇİZİM: bu sonuçları HTML elemanlarına dönüştüren fonksiyonlar
// Bu ayrım sayesinde hesaplamaları ayrı ayrı test etmek kolaylaşır.
// ==========================================================

import { PRIORITY_ORDER } from "../data.js";
import { getTasks, getCategories, getSessions, getSettings, isWorkSession, addTask, toggleTask, toggleSubtask } from "../state.js";
import { getTimerText } from "./pomodoro.js";
import { getHabitSummary } from "./goals.js";
import { getFirstName } from "./profile.js";
import { createTaskItem, createEmptyState, toggleTaskExpanded } from "../components.js";
import { openTaskForm } from "./tasks.js";
import { todayKey, addDays, formatMinutes, percent, el, icon, clear, byId, showToast } from "../utils.js";

// Arama kutusuna yazılan metin (app.js bunu setSearchText ile günceller).
let searchText = "";

// ---------------- 1) HESAPLAMA ----------------

function getTodayTasks(today) {
  return getTasks().filter((task) => task.dueDate === today);
}

// "YYYY-AA-GG" biçimindeki metinler alfabetik karşılaştırılınca tarih sırası da doğru çıkar.
// Tarihi olmayan görevler ("") gecikmiş sayılmaz.
function getOverdueTasks(today) {
  return getTasks().filter((task) => !task.completed && task.dueDate !== "" && task.dueDate < today);
}

function getUpcomingTasks(today) {
  const lastDay = addDays(today, 7);
  return getTasks().filter((task) => !task.completed && task.dueDate > today && task.dueDate <= lastDay);
}

function getFocusSessions(today) {
  return getSessions().filter((session) => session.type === "focus" && session.date === today);
}

// Bir dizideki sayısal alanı toplar: sumBy(sessions, "minutes")
function sumBy(list, fieldName) {
  let total = 0;
  for (const item of list) {
    total += item[fieldName];
  }
  return total;
}

// Her kategoride kaç açık görev olduğunu sayar, çoktan aza sıralar.
function getCategoryCounts() {
  const openTasks = getTasks().filter((task) => !task.completed);
  const counts = getCategories().map((category) => ({
    category: category,
    count: openTasks.filter((task) => task.categoryId === category.id).length,
  }));
  return counts.filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
}

function matchesSearch(task) {
  if (searchText === "") return true;
  return task.title.toLocaleLowerCase("tr").includes(searchText);
}

// Saati olanlar önce ve saat sırasına göre; saati olmayanlar önceliğe göre.
function sortForToday(list) {
  return [...list].sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });
}

function sortByDate(list) {
  return [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "İyi geceler";
  if (hour < 12) return "Günaydın";
  if (hour < 18) return "İyi günler";
  return "İyi akşamlar";
}

// ---------------- 2) ÇİZİM ----------------

// Planlayıcı da kullandığı için dışa açık.
export function createStatCard(options) {
  const card = el("div", `stat stat--${options.tone}`);
  const iconBox = el("span", "stat__icon");
  iconBox.append(icon(options.iconName));

  const body = el("div", "stat__body");
  body.append(
    el("p", "stat__label", options.label),
    el("p", "stat__value", options.value),
    el("p", "stat__note", options.note),
  );

  card.append(iconBox, body);
  return card;
}

function renderTaskList(listId, list, mode, emptyMessage, today) {
  const container = byId(listId);
  if (!container) return;
  clear(container);

  const visible = list.filter(matchesSearch);
  if (visible.length === 0) {
    container.append(createEmptyState(searchText ? "Aramayla eşleşen görev yok." : emptyMessage));
    return;
  }
  for (const task of visible) {
    // openable: başlığa tıklanınca görev, Görevler sayfasındaki pencerede düzenlenir.
    container.append(createTaskItem(task, mode, today, { openable: true }));
  }
}

function createGoalRow(label, valueText, percentValue) {
  const row = el("li", "goal");
  const top = el("div", "goal__top");
  top.append(el("span", "goal__label", label), el("span", "goal__value", valueText));

  const bar = el("div", "bar");
  const fill = el("div", "bar__fill");
  fill.style.width = `${percentValue}%`;
  bar.append(fill);

  row.append(top, bar);
  return row;
}

function renderCategoryList() {
  const container = byId("categoryList");
  if (!container) return;
  clear(container);

  const counts = getCategoryCounts();
  if (counts.length === 0) {
    container.append(createEmptyState("Açık görev yok."));
    return;
  }

  const max = counts[0].count; // liste çoktan aza sıralı, ilki en büyük
  for (const entry of counts) {
    const row = el("li", "bar-item");
    const top = el("div", "bar-item__top");
    const dot = el("span", "dot");
    dot.style.setProperty("--cat", entry.category.color);
    top.append(dot, el("span", "bar-item__name", entry.category.name), el("span", "bar-item__count", String(entry.count)));

    const bar = el("div", "bar");
    const fill = el("div", "bar__fill");
    fill.style.width = `${percent(entry.count, max)}%`;
    fill.style.setProperty("--cat", entry.category.color);
    bar.append(fill);

    row.append(top, bar);
    container.append(row);
  }
}

// Dashboard'un tamamını güncel veriden yeniden çizer.
// Veri her değiştiğinde bu fonksiyonu çağırmak yeterli: "veri değişti -> yeniden çiz".
export function renderDashboard() {
  const today = todayKey();
  const settings = getSettings();
  const habitSummary = getHabitSummary();

  const todayTasks = getTodayTasks(today);
  const doneToday = todayTasks.filter((task) => task.completed);
  const overdue = sortByDate(getOverdueTasks(today));
  const upcoming = sortByDate(getUpcomingTasks(today));
  const focusSessions = getFocusSessions(today);
  // Odak süresine serbest çalışma da dahil; seans sayısına yalnızca Pomodoro odakları.
  const workSessions = getSessions().filter((session) => isWorkSession(session) && session.date === today);
  const focusMinutes = sumBy(workSessions, "minutes");
  const remaining = todayTasks.length - doneToday.length;

  // Başlık
  // Ad biliniyorsa selamlamaya ekle: "Günaydın, Samet 👋"
  const firstName = getFirstName();
  byId("dashTitle").textContent = firstName === "" ? `${getGreeting()} 👋` : `${getGreeting()}, ${firstName} 👋`;
  byId("dashSummary").textContent = remaining > 0
    ? `Bugün ${remaining} görevin kaldı, ${overdue.length} görev gecikmiş durumda.`
    : "Bugünün tüm görevleri tamamlandı. Harika iş!";

  // İstatistik kartları
  const statGrid = byId("statGrid");
  clear(statGrid);
  statGrid.append(
    createStatCard({ tone: "accent", iconName: "tasks", label: "Bugünkü görevler", value: String(todayTasks.length), note: `${remaining} tanesi bekliyor` }),
    createStatCard({ tone: "ok", iconName: "target", label: "Tamamlanan", value: `${doneToday.length} / ${todayTasks.length}`, note: `%${percent(doneToday.length, todayTasks.length)} tamamlandı` }),
    createStatCard({ tone: "danger", iconName: "alert", label: "Geciken", value: String(overdue.length), note: overdue.length > 0 ? "Öncelik ver" : "Geciken görev yok" }),
    createStatCard({ tone: "warn", iconName: "timer", label: "Odak süresi", value: formatMinutes(focusMinutes), note: `${focusSessions.length} Pomodoro seansı` }),
  );

  // Listeler
  byId("todayCount").textContent = `${doneToday.length} / ${todayTasks.length}`;
  byId("overdueCount").textContent = String(overdue.length);
  renderTaskList("todayList", sortForToday(todayTasks), "today", "Bugün için planlanmış görev yok.", today);
  renderTaskList("upcomingList", upcoming, "upcoming", "Önümüzdeki 7 günde görev yok.", today);
  renderTaskList("overdueList", overdue, "overdue", "Geciken görev yok. 🎉", today);

  // Günlük hedefler
  const taskPercent = percent(doneToday.length, todayTasks.length);
  const ring = byId("taskRing");
  ring.style.setProperty("--p", taskPercent);
  ring.setAttribute("aria-label", `Bugünkü görevlerin yüzde ${taskPercent} kadarı tamamlandı`);
  byId("taskRingValue").textContent = `%${taskPercent}`;

  const goalList = byId("goalList");
  clear(goalList);
  goalList.append(
    createGoalRow("Pomodoro", `${focusSessions.length} / ${settings.dailyPomodoroGoal}`, percent(focusSessions.length, settings.dailyPomodoroGoal)),
    createGoalRow("Odak süresi", `${formatMinutes(focusMinutes)} / ${formatMinutes(settings.dailyFocusGoalMinutes)}`, percent(focusMinutes, settings.dailyFocusGoalMinutes)),
    createGoalRow("Alışkanlıklar", `${habitSummary.done} / ${habitSummary.total}`, percent(habitSummary.done, habitSummary.total)),
  );

  // Zamanlayıcı çalışıyorsa pomodoro.js bu yazıyı her saniye kendisi günceller.
  byId("timerPreview").textContent = getTimerText();

  renderCategoryList();
}

// ---------------- OLAYLAR ----------------

function handleQuickAdd(event) {
  event.preventDefault(); // formun sayfayı yenilemesini engelle
  const input = byId("quickAddInput");
  const title = input.value.trim();

  if (title === "") {
    input.classList.add("is-invalid");
    showToast("Lütfen bir görev başlığı yaz.");
    input.focus();
    return;
  }
  input.classList.remove("is-invalid");

  // Yalnızca başlık ve tarih veriyoruz; diğer alanları state.js varsayılanlarla doldurur.
  addTask({ title: title, dueDate: todayKey() });
  input.value = "";
  renderDashboard();
  showToast("Görev bugüne eklendi.");
}

export function setSearchText(text) {
  searchText = text.trim().toLocaleLowerCase("tr");
  renderDashboard();
}

// Olay dinleyicilerini yalnızca BİR KEZ ekler (app.js açılışta çağırır).
export function initDashboard() {
  const view = byId("view-dashboard");

  // Olay delegasyonu: her checkbox'a ayrı dinleyici eklemek yerine
  // kapsayıcıya tek dinleyici ekliyoruz. Liste yeniden çizilse bile çalışmaya devam eder.
  view.addEventListener("change", (event) => {
    if (event.target.matches(".subtask__check")) {
      toggleSubtask(event.target.dataset.taskId, event.target.dataset.subtaskId);
      renderDashboard();
    } else if (event.target.matches(".task__check")) {
      toggleTask(event.target.dataset.taskId); // state.js değiştirir ve kaydeder
      renderDashboard();
    }
  });

  // Görev satırlarındaki düğmeler: alt görevleri aç / kapat, görevi pencerede aç.
  view.addEventListener("click", (event) => {
    const button = event.target.closest(".task [data-action]");
    if (!button) return;
    if (button.dataset.action === "subtasks") {
      toggleTaskExpanded(button.dataset.taskId);
      renderDashboard();
    }
    if (button.dataset.action === "open") openTaskForm(button.dataset.taskId);
  });

  byId("quickAddForm").addEventListener("submit", handleQuickAdd);
  renderDashboard();
}
