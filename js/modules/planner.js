// ==========================================================
// planner.js — Planlayıcı: günlük, haftalık ve aylık takvim
//
// Zaman bloğu = tarihi, başlangıç saati ve tahmini süresi olan görev.
// Bitiş saati ayrıca saklanmaz; başlangıç + süre ile hesaplanır.
// ==========================================================

import { PRIORITY_ORDER } from "../data.js";
import { getTasks, getCategoryById, getSessions, isWorkSession, toggleTask } from "../state.js";
import { createTaskItem, createEmptyState } from "../components.js";
import { createStatCard } from "./dashboard.js";
import { openTaskForm } from "./tasks.js";
import {
  todayKey, addDays, parseDateKey, startOfWeek, startOfMonth, addMonths,
  formatLongDate, formatWeekday, formatMonthYear, formatDayMonth, formatMinutes,
  timeToMinutes, minutesToTime, percent, el, clear, byId,
} from "../utils.js";

const HOUR_HEIGHT = 48;       // günlük görünümde bir saatin piksel yüksekliği
const DEFAULT_BLOCK_MINUTES = 30; // süresi girilmemiş görev takvimde bu kadar yer kaplar
const MIN_BLOCK_MINUTES = 25;     // çok kısa bloklar okunabilsin diye en az bu kadar çizilir
const MONTH_CHIP_LIMIT = 3;
const WEEKDAY_NAMES = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

let viewMode = "day";          // "day" | "week" | "month"
let currentDate = todayKey();  // ekranda gösterilen gün (hafta/ay bu günü içeren aralıktır)
let timelineScrollTop = null;  // günlük görünüm yeniden çizilince kaydırma yeri korunsun

// ---------------- HESAPLAMA ----------------

function getTasksOn(dateKey) {
  return getTasks().filter((task) => task.dueDate === dateKey);
}

function isLate(task, today) {
  return !task.completed && task.dueDate !== "" && task.dueDate < today;
}

// Saatli görevler önce (saat sırasıyla), saatsizler sonra (önceliğe göre).
function compareByTime(a, b) {
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
  if (a.startTime) return -1;
  if (b.startTime) return 1;
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
}

// Ekrandaki aralığın ilk ve son günü.
function getRange() {
  if (viewMode === "week") {
    const start = startOfWeek(currentDate);
    return { start: start, end: addDays(start, 6) };
  }
  if (viewMode === "month") {
    const start = startOfMonth(currentDate);
    return { start: start, end: addDays(addMonths(start, 1), -1) }; // sonraki ayın ilk gününden bir önceki gün
  }
  return { start: currentDate, end: currentDate };
}

// Aynı saate denk gelen blokları yan yana "şeritlere" yerleştirir.
// Her blok, kendisinden önce biten ilk boş şeride konur; yoksa yeni şerit açılır.
// Birbirine değen bloklar bir "grup" oluşturur; şerit sayısı grup başına hesaplanır ki
// çakışmayan bloklar tam genişlikte kalsın.
function layoutBlocks(timedTasks) {
  const items = [];
  let laneEnds = [];  // şu anki gruptaki her şeridin bitiş dakikası
  let group = [];     // şu anki grubun blokları

  // Grubu kapatır: içindeki tüm bloklara grubun şerit sayısını yazar.
  function closeGroup() {
    for (const item of group) {
      item.laneCount = laneEnds.length;
    }
    laneEnds = [];
    group = [];
  }

  for (const task of timedTasks) {
    const start = timeToMinutes(task.startTime);
    const duration = Math.max(task.estimatedMinutes || DEFAULT_BLOCK_MINUTES, MIN_BLOCK_MINUTES);
    const end = Math.min(start + duration, 24 * 60);

    // Bu blok gruptaki her şey bittikten sonra başlıyorsa yeni grup başlar.
    const groupEnd = Math.max(0, ...laneEnds);
    if (group.length > 0 && start >= groupEnd) closeGroup();

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }

    const item = { task: task, start: start, end: end, lane: lane, laneCount: 1 };
    group.push(item);
    items.push(item);
  }
  closeGroup();
  return items;
}

// ---------------- ORTAK PARÇALAR ----------------

// Hafta ve ay görünümündeki küçük görev etiketi. Tıklanınca görev formu açılır.
function createChip(task, today) {
  const chip = el("button", "cal-chip");
  chip.type = "button";
  chip.dataset.openTask = task.id;
  if (task.completed) chip.classList.add("is-done");
  if (isLate(task, today)) chip.classList.add("is-late");

  const category = getCategoryById(task.categoryId);
  if (category) chip.style.setProperty("--cat", category.color);

  if (task.startTime) chip.append(el("span", "cal-chip__time", task.startTime));
  chip.append(el("span", "cal-chip__title", task.title));
  return chip;
}

// Planlanan / gerçekleşen karşılaştırması (ekrandaki aralık için).
function renderStats(range) {
  const tasksInRange = getTasks().filter((task) => task.dueDate >= range.start && task.dueDate <= range.end);
  const doneCount = tasksInRange.filter((task) => task.completed).length;

  let plannedMinutes = 0;
  for (const task of tasksInRange) {
    plannedMinutes += task.estimatedMinutes;
  }

  let actualMinutes = 0;
  for (const session of getSessions()) {
    if (isWorkSession(session) && session.date >= range.start && session.date <= range.end) {
      actualMinutes += session.minutes;
    }
  }

  const container = byId("plannerStats");
  clear(container);
  container.append(
    createStatCard({ tone: "accent", iconName: "calendar", label: "Planlanan süre", value: formatMinutes(plannedMinutes), note: `${tasksInRange.length} görev` }),
    createStatCard({ tone: "warn", iconName: "timer", label: "Gerçekleşen çalışma", value: formatMinutes(actualMinutes), note: plannedMinutes > 0 ? `Planın %${percent(actualMinutes, plannedMinutes)} kadarı` : "Zamanlayıcı kayıtlarından" }),
    createStatCard({ tone: "ok", iconName: "target", label: "Tamamlanan", value: `${doneCount} / ${tasksInRange.length}`, note: `%${percent(doneCount, tasksInRange.length)} tamamlandı` }),
  );
}

// ---------------- GÜNLÜK GÖRÜNÜM ----------------

function createTimeline(dateKey, today) {
  const scroll = el("div", "timeline");
  scroll.id = "timelineScroll";
  const inner = el("div", "timeline__inner");
  inner.style.height = `${24 * HOUR_HEIGHT}px`;

  // Saat satırları: tıklanınca o saate yeni görev eklenir.
  for (let hour = 0; hour < 24; hour++) {
    const time = minutesToTime(hour * 60);
    const row = el("button", "timeline__hour");
    row.type = "button";
    row.dataset.hour = time;
    row.style.top = `${hour * HOUR_HEIGHT}px`;
    row.style.height = `${HOUR_HEIGHT}px`;
    row.setAttribute("aria-label", `${time} için görev ekle`);
    row.append(el("span", "timeline__label", time));
    inner.append(row);
  }

  // Görev blokları
  const timedTasks = getTasksOn(dateKey).filter((task) => task.startTime !== "").sort(compareByTime);
  for (const item of layoutBlocks(timedTasks)) {
    const block = el("button", "block");
    block.type = "button";
    block.dataset.openTask = item.task.id;
    if (item.task.completed) block.classList.add("is-done");
    if (isLate(item.task, today)) block.classList.add("is-late");

    // Konum: dakikayı piksele çeviriyoruz.  piksel = dakika / 60 * saat yüksekliği
    const height = ((item.end - item.start) / 60) * HOUR_HEIGHT - 2;
    block.style.top = `${(item.start / 60) * HOUR_HEIGHT}px`;
    block.style.height = `${height}px`;
    block.style.setProperty("--lane", item.lane);
    block.style.setProperty("--lanes", item.laneCount);
    if (height < 40) block.classList.add("is-short"); // iki satır sığmaz: başlık ve saat yan yana

    const category = getCategoryById(item.task.categoryId);
    if (category) block.style.setProperty("--cat", category.color);

    block.append(
      el("span", "block__title", item.task.title),
      el("span", "block__time", `${minutesToTime(item.start)} – ${minutesToTime(item.end % (24 * 60))}`),
    );
    inner.append(block);
  }

  // "Şu an" çizgisi (yalnızca bugüne bakarken)
  if (dateKey === today) {
    const now = new Date();
    const line = el("div", "timeline__now");
    line.style.top = `${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT}px`;
    inner.append(line);
  }

  scroll.append(inner);
  return scroll;
}

function createListCard(title, hint, tasks, mode, emptyMessage, today) {
  const card = el("article", "card");
  const head = el("header", "card__head");
  head.append(el("h2", "card__title", title), el("span", "card__hint", hint));

  const list = el("ul", "task-list");
  if (tasks.length === 0) {
    list.append(createEmptyState(emptyMessage));
  } else {
    for (const task of tasks) {
      list.append(createTaskItem(task, mode, today));
    }
  }
  card.append(head, list);
  return card;
}

function renderDay(body, today) {
  const grid = el("div", "dash-grid");
  const left = el("div", "dash-col");
  const right = el("div", "dash-col");

  const timelineCard = el("article", "card");
  const head = el("header", "card__head");
  head.append(el("h2", "card__title", "Zaman blokları"), el("span", "card__hint", "Boş bir saate tıkla, görev ekle"));
  timelineCard.append(head, createTimeline(currentDate, today));
  left.append(timelineCard);

  const untimed = getTasksOn(currentDate).filter((task) => task.startTime === "").sort(compareByTime);
  right.append(createListCard("Saatsiz görevler", `${untimed.length} görev`, untimed, "today", "Bu gün için saatsiz görev yok.", today));

  // Bugüne bakarken geciken görevleri de göster ki yeniden planlanabilsin.
  if (currentDate === today) {
    const late = getTasks().filter((task) => isLate(task, today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (late.length > 0) {
      const card = createListCard("Geciken görevler", `${late.length} görev`, late, "overdue", "", today);
      card.classList.add("card--danger");
      right.append(card);
    }
  }

  grid.append(left, right);
  body.append(grid);

  // Kaydırma yeri: ilk açılışta sabah 07:00, sonrasında kullanıcının bıraktığı yer.
  const scroll = byId("timelineScroll");
  scroll.scrollTop = timelineScrollTop === null ? 7 * HOUR_HEIGHT : timelineScrollTop;
}

// ---------------- HAFTALIK GÖRÜNÜM ----------------

function renderWeek(body, today) {
  const card = el("article", "card");
  const grid = el("div", "week");
  const weekStart = startOfWeek(currentDate);

  for (let index = 0; index < 7; index++) {
    const dateKey = addDays(weekStart, index);
    const column = el("div", "week__col");
    if (dateKey === today) column.classList.add("is-today");

    // Başlığa tıklamak o günün günlük görünümünü açar.
    const headButton = el("button", "week__head");
    headButton.type = "button";
    headButton.dataset.date = dateKey;
    headButton.setAttribute("aria-label", `${formatLongDate(dateKey)} gününü aç`);
    headButton.append(
      el("span", "week__name", WEEKDAY_NAMES[index]),
      el("span", "week__num", String(parseDateKey(dateKey).getDate())),
    );
    column.append(headButton);

    const tasks = getTasksOn(dateKey).sort(compareByTime);
    if (tasks.length === 0) {
      column.append(el("p", "week__empty", "—"));
    }
    for (const task of tasks) {
      column.append(createChip(task, today));
    }
    grid.append(column);
  }

  card.append(grid);
  body.append(card);
}

// ---------------- AYLIK GÖRÜNÜM ----------------

function renderMonth(body, today) {
  const card = el("article", "card");
  const grid = el("div", "month");

  for (const name of WEEKDAY_NAMES) {
    grid.append(el("div", "month__weekday", name));
  }

  const monthStart = startOfMonth(currentDate);
  const monthNumber = parseDateKey(monthStart).getMonth();
  const nextMonthStart = addMonths(monthStart, 1);

  // Izgara pazartesiyle başlar: ayın ilk gününü içeren haftanın pazartesisinden başlıyoruz.
  // Ayın son gününü içeren hafta bitene kadar hafta hafta ilerliyoruz.
  let dateKey = startOfWeek(monthStart);
  while (dateKey < nextMonthStart) {
    for (let index = 0; index < 7; index++) {
      const cell = el("div", "month__cell");
      const isOtherMonth = parseDateKey(dateKey).getMonth() !== monthNumber;
      if (isOtherMonth) cell.classList.add("is-other");
      if (dateKey === today) cell.classList.add("is-today");

      const tasks = getTasksOn(dateKey).sort(compareByTime);

      const dayButton = el("button", "month__day", String(parseDateKey(dateKey).getDate()));
      dayButton.type = "button";
      dayButton.dataset.date = dateKey;
      dayButton.setAttribute("aria-label", `${formatLongDate(dateKey)}, ${tasks.length} görev`);
      cell.append(dayButton);

      // Dar ekranda etiketler yerine yalnızca sayı görünür (CSS ile).
      if (tasks.length > 0) cell.append(el("span", "month__count", String(tasks.length)));

      for (const task of tasks.slice(0, MONTH_CHIP_LIMIT)) {
        cell.append(createChip(task, today));
      }
      if (tasks.length > MONTH_CHIP_LIMIT) {
        const more = el("button", "month__more", `+${tasks.length - MONTH_CHIP_LIMIT} daha`);
        more.type = "button";
        more.dataset.date = dateKey;
        cell.append(more);
      }

      grid.append(cell);
      dateKey = addDays(dateKey, 1);
    }
  }

  card.append(grid);
  body.append(card);
}

// ---------------- ANA ÇİZİM ----------------

function getTitle(range) {
  if (viewMode === "day") return `${formatLongDate(currentDate)}, ${formatWeekday(currentDate)}`;
  if (viewMode === "week") return `${formatDayMonth(range.start)} – ${formatDayMonth(range.end)}`;
  return formatMonthYear(currentDate);
}

export function renderPlanner() {
  const today = todayKey();
  const range = getRange();

  byId("plannerRange").textContent = getTitle(range);

  const buttons = byId("plannerViews").querySelectorAll("[data-view-mode]");
  for (const button of buttons) {
    const isActive = button.dataset.viewMode === viewMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  renderStats(range);

  // Yeniden çizmeden önce günlük görünümün kaydırma yerini hatırla.
  const oldScroll = document.getElementById("timelineScroll");
  if (oldScroll) timelineScrollTop = oldScroll.scrollTop;

  const body = byId("plannerBody");
  clear(body);
  if (viewMode === "day") renderDay(body, today);
  if (viewMode === "week") renderWeek(body, today);
  if (viewMode === "month") renderMonth(body, today);
}

// ---------------- OLAYLAR ----------------

// Önceki / sonraki: görünüme göre 1 gün, 1 hafta ya da 1 ay kaydır.
function shiftDate(direction) {
  if (viewMode === "day") currentDate = addDays(currentDate, direction);
  if (viewMode === "week") currentDate = addDays(currentDate, direction * 7);
  if (viewMode === "month") currentDate = addMonths(currentDate, direction);
  timelineScrollTop = null;
  renderPlanner();
}

function handleBodyClick(event) {
  // 1) Bir görev etiketine / bloğuna tıklandı: düzenleme formunu aç.
  const taskButton = event.target.closest("[data-open-task]");
  if (taskButton) {
    openTaskForm(taskButton.dataset.openTask);
    return;
  }
  // 2) Bir güne tıklandı (hafta başlığı ya da ay hücresi): o günün günlük görünümüne geç.
  const dateButton = event.target.closest("[data-date]");
  if (dateButton) {
    currentDate = dateButton.dataset.date;
    viewMode = "day";
    timelineScrollTop = null;
    renderPlanner();
    return;
  }
  // 3) Günlük görünümde boş bir saate tıklandı: o gün ve saat dolu gelen yeni görev formu.
  const hourButton = event.target.closest("[data-hour]");
  if (hourButton) {
    openTaskForm(null, { dueDate: currentDate, startTime: hourButton.dataset.hour });
  }
}

export function initPlanner() {
  byId("plannerPrev").addEventListener("click", () => shiftDate(-1));
  byId("plannerNext").addEventListener("click", () => shiftDate(1));
  byId("plannerToday").addEventListener("click", () => {
    currentDate = todayKey();
    timelineScrollTop = null;
    renderPlanner();
  });
  byId("plannerNewBtn").addEventListener("click", () => openTaskForm(null, { dueDate: currentDate }));

  byId("plannerViews").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-mode]");
    if (!button) return;
    viewMode = button.dataset.viewMode;
    renderPlanner();
  });

  const body = byId("plannerBody");
  body.addEventListener("click", handleBodyClick);
  body.addEventListener("change", (event) => {
    if (event.target.matches(".task__check")) {
      toggleTask(event.target.dataset.taskId);
      renderPlanner();
    }
  });
}
