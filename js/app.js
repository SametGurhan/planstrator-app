// ==========================================================
// app.js — Uygulamanın giriş noktası
// Görevi: tema, menü ve sayfa geçişlerini yönetmek, modülleri başlatmak.
// ==========================================================

import { initState } from "./state.js";
import { initConfirmDialog } from "./components.js";
import { initDashboard, renderDashboard, setSearchText } from "./modules/dashboard.js";
import { initTasks, renderTasks, setTaskSearchText } from "./modules/tasks.js";
import { initCategories, renderCategories } from "./modules/categories.js";
import { initPlanner, renderPlanner } from "./modules/planner.js";
import { initKanban, renderKanban, setKanbanSearchText } from "./modules/kanban.js";
import { initGoals, renderGoalsPage } from "./modules/goals.js";
import { initNotes, renderNotes, setNotesSearchText } from "./modules/notes.js";
import { initTravel, renderTravel } from "./modules/travel.js";
import { initPomodoro, renderPomodoro, setPageTitle } from "./modules/pomodoro.js";
import { initChecklists, renderChecklists } from "./modules/checklists.js";
import { initWhiteboard, renderWhiteboard } from "./modules/whiteboard.js";
import { initSettings, renderSettings } from "./modules/settings.js";
import { initAccount, getCurrentUser } from "./modules/account.js";
import { initProfile, renderProfile } from "./modules/profile.js";
import { initBoards, renderBoards } from "./modules/boards.js";
import { initAdmin, renderAdmin } from "./modules/admin.js";
import { initBackground } from "./modules/background.js";
import { initTheme } from "./theme.js";
import { readPreference, savePreference } from "./storage.js";
import { byId, clear, el, todayKey, formatLongDate, formatWeekday, showToast } from "./utils.js";

// Hazır sayfalar. Anahtar = adres çubuğundaki #isim = HTML'deki view-<isim> bölümü.
// render: sayfa her açıldığında çağrılır, böylece ekran hep güncel veriyi gösterir.
const REAL_VIEWS = {
  dashboard: { title: "Dashboard", render: renderDashboard },
  tasks: { title: "Görevler", render: renderTasks },
  pomodoro: { title: "Pomodoro", render: renderPomodoro },
  kanban: { title: "Pano", render: renderKanban },
  boards: { title: "Ortak Panolar", render: renderBoards },
  planner: { title: "Planlayıcı", render: renderPlanner },
  checklists: { title: "Kontrol Listeleri", render: renderChecklists },
  goals: { title: "Hedefler", render: renderGoalsPage },
  notes: { title: "Notlar", render: renderNotes },
  travel: { title: "Seyahat", render: renderTravel },
  whiteboard: { title: "Beyaz Tahta", render: renderWhiteboard },
  categories: { title: "Kategoriler", render: renderCategories },
  settings: { title: "Ayarlar", render: renderSettings },
  admin: { title: "Yönetim", render: renderAdmin },
};

// Henüz yapılmamış sayfaların bilgileri. Şu an hepsi hazır olduğu için boş;
// yeni bir sayfa planlarken buraya { title, icon, stage, text, items } ekleyebilirsin.
const PLACEHOLDER_VIEWS = {
};

const MOBILE_QUERY = window.matchMedia("(max-width: 860px)");

const app = byId("app");
const backdrop = byId("backdrop");
const menuBtn = byId("menuBtn");
const collapseBtn = byId("collapseBtn");       // menünün altındaki düğme
const collapseTopBtn = byId("collapseTopBtn"); // logonun yanındaki simge düğme

// ---------- Menü ----------
function setDrawerOpen(isOpen) {
  app.classList.toggle("is-drawer-open", isOpen);
  backdrop.hidden = !isOpen;
  menuBtn.setAttribute("aria-expanded", String(isOpen));
}

function setCollapsed(isCollapsed) {
  app.classList.toggle("is-collapsed", isCollapsed);
  const label = isCollapsed ? "Menüyü genişlet" : "Menüyü daralt";
  // İki düğme de aynı durumu göstersin.
  for (const button of [collapseBtn, collapseTopBtn]) {
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.setAttribute("aria-label", label);
  }
  collapseTopBtn.title = label;
}

// Menüyü daraltır ya da genişletir ve tercihi kaydeder.
function toggleCollapsed() {
  const next = !app.classList.contains("is-collapsed");
  setCollapsed(next);
  savePreference("planstrator.sidebarCollapsed", String(next));
}

function initSidebar() {
  setCollapsed(readPreference("planstrator.sidebarCollapsed", "false") === "true");

  collapseBtn.addEventListener("click", toggleCollapsed);
  collapseTopBtn.addEventListener("click", toggleCollapsed);

  menuBtn.addEventListener("click", () => setDrawerOpen(true));
  backdrop.addEventListener("click", () => setDrawerOpen(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setDrawerOpen(false);
  });

  // Ekran büyüyünce açık kalmış mobil menüyü kapat.
  MOBILE_QUERY.addEventListener("change", () => setDrawerOpen(false));
}

// ---------- Sayfa geçişleri ----------
// Adres çubuğundaki #dashboard, #tasks gibi "hash" değerini kullanıyoruz.
// Böylece sayfa yenilense bile aynı ekranda kalırız ve geri tuşu çalışır.
function getCurrentViewName() {
  const name = window.location.hash.replace("#", "");
  if (name in REAL_VIEWS || name in PLACEHOLDER_VIEWS) return name;
  return "dashboard"; // tanımadığımız bir adres gelirse
}

function fillPlaceholder(info) {
  byId("phTitle").textContent = info.title;
  byId("phText").textContent = info.text;
  byId("phStage").textContent = `${info.stage}'de geliyor`;
  byId("phIcon").setAttribute("href", `#i-${info.icon}`);

  const list = byId("phList");
  clear(list);
  for (const text of info.items) {
    list.append(el("li", "", `• ${text}`));
  }
}

function showView(viewName) {
  const isReal = viewName in REAL_VIEWS;

  // Hazır sayfalardan yalnızca seçileni göster.
  for (const name in REAL_VIEWS) {
    byId(`view-${name}`).hidden = name !== viewName;
  }
  byId("view-placeholder").hidden = isReal;

  if (isReal) {
    REAL_VIEWS[viewName].render();
  } else {
    fillPlaceholder(PLACEHOLDER_VIEWS[viewName]);
  }

  // Menüde aktif bağlantıyı işaretle.
  const links = document.querySelectorAll(".nav__link");
  for (const link of links) {
    const isActive = link.dataset.view === viewName;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  const title = isReal ? REAL_VIEWS[viewName].title : PLACEHOLDER_VIEWS[viewName].title;
  // Sekme başlığını pomodoro.js yazar; zamanlayıcı çalışıyorsa kalan süreyi de gösterir.
  setPageTitle(`${title} · Planstrator`);
  setDrawerOpen(false);
}

function initRouter() {
  window.addEventListener("hashchange", () => showView(getCurrentViewName()));
  showView(getCurrentViewName());
}

// Açık olan sayfayı güncel veriyle yeniden çizer.
// skipView: haberi veren sayfa kendini zaten çizdiyse onu atlamak için.
function refreshCurrentView(skipView) {
  const viewName = getCurrentViewName();
  if (viewName in REAL_VIEWS && viewName !== skipView) REAL_VIEWS[viewName].render();
}

// ---------- Üst çubuk ----------
function initTopbar() {
  const today = todayKey();
  byId("topbarWeekday").textContent = formatWeekday(today);
  byId("topbarDate").textContent = formatLongDate(today);

  byId("searchInput").addEventListener("input", (event) => {
    // Arama dashboard'u, Görevler sayfasını, Pano'yu ve Notlar'ı filtreler.
    setSearchText(event.target.value);
    setTaskSearchText(event.target.value);
    setKanbanSearchText(event.target.value);
    setNotesSearchText(event.target.value);
  });
}

// ---------- Çevrimdışı çalışma ----------
// Service worker'ı kaydeder (bkz. sw.js). Yalnızca http(s) üzerinde çalışır.
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // Telefon uygulamasında (Capacitor) dosyalar zaten paketin içinde; service worker gerekmez.
  if (window.Capacitor) return;
  navigator.serviceWorker.register("sw.js").catch((error) => {
    console.warn("Service worker kaydedilemedi:", error);
  });
}

// ---------- Başlat ----------
function init() {
  // Önce veri yüklenmeli; sayfalar çizilirken veriye ihtiyaç duyar.
  const loadStatus = initState();

  initBackground();
  initTheme({ onChange: () => refreshCurrentView("") });
  initSidebar();
  initTopbar();
  initConfirmDialog();
  initDashboard();
  initTasks({ onTasksChanged: () => refreshCurrentView("tasks") });
  initPlanner();
  initKanban();
  initGoals();
  initNotes();
  initTravel();
  initChecklists();
  initCategories();
  initWhiteboard();
  initSettings();
  initBoards();
  initAdmin();
  // Hesap durumu sunucudan sorulur (yanıtı beklemeden devam ederiz); giriş / çıkışta
  // açık sayfa tazelenir, böylece Ortak Panolar doğru hali gösterir.
  initAccount({
    onChange: () => {
      renderProfile(); // giriş yapılınca üstteki simge ve selamlama hesaptaki adı kullansın
      // Yönetim bağlantısı yalnızca yönetici hesabında görünür.
      byId("adminNavItem").hidden = !(getCurrentUser() && getCurrentUser().isAdmin);
      refreshCurrentView("");
    },
  });
  // Bu cihazda ilk açılışsa karşılama penceresi adını sorar.
  initProfile({ isFirstRun: loadStatus === "empty", onChange: () => refreshCurrentView("") });
  // Oturum bitince açık olan sayfayı tazele (ör. dashboard'daki sayılar güncellensin).
  initPomodoro({ onSessionComplete: () => refreshCurrentView("pomodoro") });
  initRouter();

  registerServiceWorker();

  if (loadStatus === "corrupt") {
    showToast("Kayıtlı veri okunamadı; yedeği alındı ve uygulama sıfırdan başlatıldı.");
  }
  if (loadStatus === "unavailable") {
    showToast("Tarayıcı depolaması kapalı; değişiklikler kaydedilmeyecek.");
  }
}

init();
