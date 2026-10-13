// ==========================================================
// boards.js — Ortak panolar: arkadaşlarla paylaşılan Kanban panoları
//
// Buradaki veri bu cihazda değil SUNUCUDA durur; her işlem bir API isteğidir.
// Bu yüzden fonksiyonların çoğu async'tir ve hata olasılığı (bağlantı kopması,
// yetki yok...) try / catch ile ele alınır.
// Açık pano birkaç saniyede bir yeniden yüklenir; arkadaşının değişiklikleri böyle görünür.
// ==========================================================

import { STATUS_LABELS } from "../data.js";
import { api } from "../api.js";
import { getCurrentUser, getAccountStatus } from "./account.js";
import { IS_NATIVE_APP } from "../config.js";
import { createIconButton, createMetaItem, enableBoardDragDrop, askConfirm } from "../components.js";
import { todayKey, formatShortDate, el, icon, clear, byId, showToast, fillSelect } from "../utils.js";

const STATUSES = ["todo", "doing", "done"];
const POLL_INTERVAL = 8000; // açık pano kaç ms'de bir tazelensin

let boards = [];            // üyesi olduğum panolar
let invites = [];           // bana gelen davetler
let selectedBoardId = null;
let detail = null;          // seçili panonun ayrıntısı: { board, members, invites, tasks }
let editingTaskId = null;
let pollId = null;
let isDragging = false;

// ---------------- VERİ YÜKLEME ----------------

// Bir API çağrısını çalıştırır; hata olursa bildirim gösterir ve false döner.
async function attempt(work) {
  try {
    await work();
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  }
}

async function loadList() {
  const result = await api.listBoards();
  boards = result.boards;
  invites = result.invites;
  // Seçili pano artık listede yoksa (silindi ya da çıkarıldım) ilkini seç.
  if (!boards.some((board) => board.id === selectedBoardId)) {
    selectedBoardId = boards.length > 0 ? boards[0].id : null;
  }
}

async function loadDetail() {
  detail = selectedBoardId === null ? null : await api.getBoard(selectedBoardId);
}

// ---------------- ÇİZİM: GİRİŞ KAPISI, DAVETLER, PANO LİSTESİ ----------------

function renderGate() {
  const gate = byId("boardsGate");
  const accountStatus = getAccountStatus();
  gate.hidden = accountStatus === "user";
  byId("boardsContent").hidden = accountStatus !== "user";
  if (accountStatus === "user") return;

  clear(gate);
  gate.append(icon("columns"));
  if (accountStatus === "unverified") {
    const link = el("a", "btn btn--primary", "Hesabı aç");
    link.href = "#settings";
    link.dataset.openAccount = "";
    gate.append(
      el("p", "", "Ortak panoları kullanmak için önce e-posta adresini doğrulamalısın."),
      el("p", "card__hint", "Sana gönderdiğimiz maildeki bağlantıya tıkla; mail gelmediyse hesap penceresinden yeniden isteyebilirsin."),
      link,
    );
  } else if (accountStatus === "offline") {
    if (IS_NATIVE_APP) {
      gate.append(
        el("p", "", "Sunucuya ulaşılamadı."),
        el("p", "card__hint", "Ortak panolar internet bağlantısı ister. Bağlantını kontrol edip uygulamayı yeniden aç."),
      );
    } else {
      gate.append(
        el("p", "", "Ortak panolar için Planstrator sunucusu gerekir."),
        el("p", "card__hint", "Proje klasöründe \"npm start\" çalıştır ve uygulamayı http://localhost:5500 adresinden aç."),
      );
    }
  } else {
    const link = el("a", "btn btn--primary", "Giriş yap ya da hesap oluştur");
    link.href = "#settings";
    link.dataset.openAccount = "";
    gate.append(el("p", "", "Arkadaşlarınla ortak pano kullanmak için giriş yapmalısın."), link);
  }
}

function renderInvites() {
  const container = byId("boardInvites");
  clear(container);
  for (const invite of invites) {
    const card = el("article", "card invite");
    card.append(el("p", "invite__text", `${invite.invitedBy} seni "${invite.boardName}" panosuna davet etti.`));
    const actions = el("div", "invite__actions");
    const accept = el("button", "btn btn--primary btn--sm", "Kabul et");
    accept.type = "button";
    accept.dataset.action = "accept";
    accept.dataset.inviteId = invite.id;
    const decline = el("button", "btn btn--ghost btn--sm", "Reddet");
    decline.type = "button";
    decline.dataset.action = "decline";
    decline.dataset.inviteId = invite.id;
    actions.append(accept, decline);
    card.append(actions);
    container.append(card);
  }
}

function renderTiles() {
  const container = byId("boardTiles");
  clear(container);
  if (boards.length === 0) {
    const empty = el("div", "card empty");
    empty.append(icon("inbox"), el("p", "", "Henüz ortak panon yok. Yukarıdan bir pano oluştur ve arkadaşlarını davet et."));
    container.append(empty);
    return;
  }
  for (const board of boards) {
    const tile = el("button", "card board-tile");
    tile.type = "button";
    tile.dataset.boardId = board.id;
    if (board.id === selectedBoardId) tile.classList.add("is-active");
    tile.setAttribute("aria-pressed", String(board.id === selectedBoardId));
    tile.append(
      el("span", "card__title", board.name),
      el("span", "card__hint", `${board.memberCount} üye · ${board.openCount} açık görev${board.role === "owner" ? " · sahibi sensin" : ""}`),
    );
    container.append(tile);
  }
}

// ---------------- ÇİZİM: SEÇİLİ PANO ----------------

function createMemberChip(member, isOwner, myId) {
  const chip = el("span", "member");
  chip.append(el("span", "member__name", member.role === "owner" ? `${member.name} (sahip)` : member.name));
  chip.title = member.email;

  // Sahip başkalarını çıkarabilir; üye yalnızca kendisi ayrılabilir. Sahip çıkarılamaz.
  const canRemove = member.role !== "owner" && (isOwner || member.id === myId);
  if (canRemove) {
    const label = member.id === myId ? "Panodan ayrıl" : `${member.name} adlı üyeyi çıkar`;
    chip.append(createIconButton("close", label, { action: "remove-member", userId: member.id }));
  }
  return chip;
}

function createPeopleCard(isOwner, myId) {
  const card = el("article", "card");
  const head = el("header", "card__head");
  head.append(el("h3", "card__title", "Üyeler"), el("span", "card__hint", `${detail.members.length} kişi`));

  const members = el("div", "members");
  for (const member of detail.members) {
    members.append(createMemberChip(member, isOwner, myId));
  }
  card.append(head, members);

  if (isOwner) {
    // E-posta ile davet formu
    const form = el("form", "inline-add inline-add--wrap invite-form");
    form.dataset.form = "invite";
    form.noValidate = true;
    const input = el("input", "input");
    input.type = "email";
    input.name = "email";
    input.placeholder = "arkadas@ornek.com";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Davet edilecek e-posta adresi");
    const button = el("button", "btn btn--ghost", "Davet et");
    button.type = "submit";
    form.append(input, button);
    card.append(form);

    // Yanıt bekleyen davetler
    for (const invite of detail.invites) {
      const row = el("div", "row row--compact");
      const body = el("div", "row__body");
      body.append(el("p", "row__title", invite.email), el("p", "row__hint", "Davet gönderildi; kabul etmesi bekleniyor"));

      // mailto: kullanıcının kendi e-posta uygulamasını hazır bir mesajla açar.
      // Uygulama kendiliğinden e-posta GÖNDERMEZ; haber vermek kullanıcıya kalır.
      const mail = el("a", "link-btn", "E-posta ile haber ver");
      const subject = encodeURIComponent(`Planstrator: "${detail.board.name}" panosuna davet`);
      const message = encodeURIComponent(
        `Merhaba,\n\nSeni Planstrator'da "${detail.board.name}" panosuna davet ettim.\n` +
        `${window.location.origin} adresini aç, bu e-posta adresinle hesap oluştur; davet "Ortak Panolar" sayfasında görünecek.`,
      );
      mail.href = `mailto:${invite.email}?subject=${subject}&body=${message}`;

      row.append(body, mail, createIconButton("close", `Daveti geri al: ${invite.email}`, { action: "cancel-invite", inviteId: invite.id }));
      card.append(row);
    }
  }
  return card;
}

function createTaskCard(task, today) {
  const card = el("li", "kcard");
  card.draggable = true;
  card.dataset.taskId = task.id;
  const isLate = task.status !== "done" && task.dueDate !== "" && task.dueDate < today;
  if (isLate) card.classList.add("is-late");
  if (task.status === "done") card.classList.add("is-done");

  const title = el("button", "kcard__title", task.title);
  title.type = "button";
  title.dataset.action = "edit-task";
  title.dataset.taskId = task.id;

  const meta = el("div", "task__meta");
  if (task.assigneeName) meta.append(el("span", "tag", task.assigneeName));
  if (task.dueDate !== "") {
    meta.append(createMetaItem(isLate ? "alert" : "calendar", task.dueDate === today ? "Bugün" : formatShortDate(task.dueDate), isLate ? "task__meta-item--danger" : ""));
  }

  const foot = el("div", "kcard__foot");
  const moves = el("div", "kcard__moves");
  const index = STATUSES.indexOf(task.status);
  if (index > 0) {
    moves.append(createIconButton("chevron", `"${STATUS_LABELS[STATUSES[index - 1]]}" sütununa taşı`, { action: "move-task", taskId: task.id, moveTo: STATUSES[index - 1] }));
  }
  if (index < STATUSES.length - 1) {
    moves.append(createIconButton("next", `"${STATUS_LABELS[STATUSES[index + 1]]}" sütununa taşı`, { action: "move-task", taskId: task.id, moveTo: STATUSES[index + 1] }));
  }
  foot.append(el("span", "card__hint", ""), moves);

  card.append(title, meta, foot);
  return card;
}

function createColumn(status, today) {
  const tasks = detail.tasks.filter((task) => task.status === status);
  const column = el("section", "kanban__col");
  column.dataset.status = status;

  const head = el("header", "kanban__head");
  const titleBox = el("div", "kanban__title");
  titleBox.append(el("h3", "card__title", STATUS_LABELS[status]), el("span", "badge", String(tasks.length)));
  head.append(titleBox);

  const list = el("ul", "kanban__list");
  for (const task of tasks) {
    list.append(createTaskCard(task, today));
  }
  if (tasks.length === 0) list.append(el("li", "kanban__empty", "Buraya görev sürükle"));

  // Sütunun altındaki hızlı ekleme formu
  const form = el("form", "inline-add");
  form.dataset.form = "task";
  form.dataset.status = status;
  form.noValidate = true;
  const input = el("input", "input");
  input.type = "text";
  input.name = "title";
  input.maxLength = 120;
  input.placeholder = "Görev ekle…";
  input.setAttribute("aria-label", `"${STATUS_LABELS[status]}" sütununa görev ekle`);
  const button = el("button", "btn btn--ghost", "Ekle");
  button.type = "submit";
  form.append(input, button);

  column.append(head, list, form);
  return column;
}

function renderDetail() {
  const container = byId("boardDetail");
  // Kullanıcı bir kutuya yazıyorsa yeniden çizme: yazdığı metin ve odak kaybolmasın.
  const active = document.activeElement;
  if (active && container.contains(active) && active.tagName === "INPUT" && active.value !== "") return;

  clear(container);
  if (!detail) return;

  // Üstteki pano kartındaki sayılar da güncel kalsın (görev eklenince, üye değişince).
  const tile = boards.find((board) => board.id === detail.board.id);
  if (tile) {
    tile.openCount = detail.tasks.filter((task) => task.status !== "done").length;
    tile.memberCount = detail.members.length;
    renderTiles();
  }

  const user = getCurrentUser();
  const isOwner = detail.board.role === "owner";

  const head = el("div", "board-head");
  head.append(el("h2", "section-title", detail.board.name));
  if (isOwner) {
    const remove = el("button", "btn btn--ghost btn--sm btn--danger-text", "Panoyu sil");
    remove.type = "button";
    remove.dataset.action = "delete-board";
    head.append(remove);
  }

  const kanban = el("div", "kanban");
  kanban.id = "sharedKanban";
  const today = todayKey();
  for (const status of STATUSES) {
    kanban.append(createColumn(status, today));
  }

  container.append(head, createPeopleCard(isOwner, user.id), kanban);

  // Sürükle-bırak: bırakılınca sunucuya bildir.
  enableBoardDragDrop(
    kanban,
    (taskId, status, beforeTaskId) => {
      const changes = { status: status };
      if (beforeTaskId !== null) changes.beforeTaskId = Number(beforeTaskId);
      else changes.beforeTaskId = 0; // 0: hiçbir görevle eşleşmez -> sütunun sonu
      updateTask(Number(taskId), changes);
    },
    () => { isDragging = false; },
    () => { isDragging = true; },
  );
}

function renderAll() {
  renderGate();
  if (getAccountStatus() !== "user") return;
  renderInvites();
  renderTiles();
  renderDetail();
}

// Sayfa her açıldığında app.js çağırır.
export async function renderBoards() {
  renderGate();
  if (getAccountStatus() !== "user") {
    stopPolling();
    return;
  }
  const ok = await attempt(async () => {
    await loadList();
    await loadDetail();
  });
  if (ok) renderAll();
  startPolling();
}

// ---------------- OTOMATİK TAZELEME ----------------

function stopPolling() {
  if (pollId === null) return;
  clearInterval(pollId);
  pollId = null;
}

function startPolling() {
  if (pollId !== null) return; // zaten çalışıyor
  pollId = setInterval(async () => {
    // Sayfadan çıkıldıysa ya da çıkış yapıldıysa dur.
    if (byId("view-boards").hidden || getAccountStatus() !== "user") {
      stopPolling();
      return;
    }
    // Sekme arka plandaysa, sürükleme sürüyorsa ya da bir pencere açıksa bu turu atla.
    if (document.hidden || isDragging || document.querySelector("dialog[open]")) return;
    try {
      await loadList();
      await loadDetail();
      renderAll();
    } catch (error) {
      // Geçici bağlantı sorunu: sessizce bir sonraki turu bekle.
    }
  }, POLL_INTERVAL);
}

// ---------------- İŞLEMLER ----------------

async function updateTask(taskId, changes) {
  await attempt(async () => {
    const result = await api.updateTask(selectedBoardId, taskId, changes);
    detail.tasks = result.tasks;
  });
  renderDetail();
}

function openTaskDialog(taskId) {
  const task = detail.tasks.find((item) => item.id === taskId);
  if (!task) return;
  editingTaskId = taskId;

  fillSelect(byId("sharedTaskAssignee"), detail.members.map((member) => ({ value: String(member.id), label: member.name })), "Kimseye atanmadı");
  byId("sharedTaskTitle").value = task.title;
  byId("sharedTaskDescription").value = task.description;
  byId("sharedTaskDue").value = task.dueDate;
  byId("sharedTaskAssignee").value = task.assigneeId === null ? "" : String(task.assigneeId);
  byId("sharedTaskDialog").showModal();
  byId("sharedTaskTitle").focus();
}

async function handleTaskDialogSubmit(event) {
  event.preventDefault();
  const title = byId("sharedTaskTitle").value.trim();
  if (title === "") {
    showToast("Görev başlığı boş olamaz.");
    return;
  }
  byId("sharedTaskDialog").close();
  await updateTask(editingTaskId, {
    title: title,
    description: byId("sharedTaskDescription").value,
    dueDate: byId("sharedTaskDue").value,
    assigneeId: byId("sharedTaskAssignee").value,
  });
}

async function handleTaskDelete() {
  byId("sharedTaskDialog").close();
  await attempt(async () => {
    const result = await api.deleteTask(selectedBoardId, editingTaskId);
    detail.tasks = result.tasks;
  });
  renderDetail();
}

// Ayrıntı bölümündeki formlar: davet ve hızlı görev ekleme
async function handleDetailSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.dataset.form === "invite") {
    const email = form.elements.email.value.trim();
    if (email === "") return;
    const ok = await attempt(async () => {
      detail = await api.invite(selectedBoardId, email);
    });
    if (ok) {
      form.elements.email.value = "";
      showToast("Davet oluşturuldu. Arkadaşın bu e-posta ile giriş yapınca daveti görecek.");
    }
    renderDetail();
  }

  if (form.dataset.form === "task") {
    const title = form.elements.title.value.trim();
    if (title === "") return;
    const status = form.dataset.status;
    form.elements.title.value = ""; // renderDetail yazı varken çizmeyi atlar; önce temizle
    await attempt(async () => {
      const result = await api.addTask(selectedBoardId, { title: title, status: status });
      detail.tasks = result.tasks;
    });
    renderDetail();
    // Art arda ekleyebilmek için aynı sütunun kutusuna geri odaklan.
    const sameForm = byId("boardDetail").querySelector(`form[data-form="task"][data-status="${status}"]`);
    if (sameForm) sameForm.elements.title.focus();
  }
}

async function handleDetailClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || !detail) return;
  const action = button.dataset.action;

  if (action === "edit-task") openTaskDialog(Number(button.dataset.taskId));
  if (action === "move-task") updateTask(Number(button.dataset.taskId), { status: button.dataset.moveTo, beforeTaskId: 0 });

  if (action === "cancel-invite") {
    await attempt(async () => {
      detail = await api.cancelInvite(selectedBoardId, Number(button.dataset.inviteId));
    });
    renderDetail();
  }

  if (action === "remove-member") {
    const userId = Number(button.dataset.userId);
    const isMe = userId === getCurrentUser().id;
    askConfirm({
      title: isMe ? "Panodan ayrılmak istiyor musun?" : "Üye çıkarılsın mı?",
      text: isMe ? "Bu panoyu artık göremeyeceksin." : "Bu kişi panoyu artık göremeyecek.",
      confirmLabel: isMe ? "Ayrıl" : "Çıkar",
      onConfirm: async () => {
        await attempt(() => api.removeMember(selectedBoardId, userId));
        renderBoards();
      },
    });
  }

  if (action === "delete-board") {
    askConfirm({
      title: "Pano silinsin mi?",
      text: `"${detail.board.name}" panosu tüm görevleriyle birlikte, bütün üyeler için silinecek.`,
      confirmLabel: "Panoyu sil",
      onConfirm: async () => {
        await attempt(() => api.deleteBoard(selectedBoardId));
        selectedBoardId = null;
        renderBoards();
      },
    });
  }
}

export function initBoards() {
  byId("newBoardForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = byId("newBoardName");
    const name = input.value.trim();
    if (name === "") {
      // Sessizce hiçbir şey yapmamak "düğme çalışmıyor" izlenimi verir; ne gerektiğini söyle.
      showToast("Önce panoya bir ad yaz.");
      input.focus();
      return;
    }
    const ok = await attempt(async () => {
      detail = await api.createBoard(name);
      selectedBoardId = detail.board.id;
    });
    if (ok) {
      input.value = "";
      showToast("Pano oluşturuldu.");
      renderBoards();
    }
  });

  byId("boardInvites").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const inviteId = Number(button.dataset.inviteId);
    await attempt(async () => {
      if (button.dataset.action === "accept") {
        const result = await api.acceptInvite(inviteId);
        selectedBoardId = result.boardId; // kabul edilen pano hemen açılsın
        showToast("Panoya katıldın.");
      } else {
        await api.declineInvite(inviteId);
      }
    });
    renderBoards();
  });

  byId("boardTiles").addEventListener("click", (event) => {
    const tile = event.target.closest("[data-board-id]");
    if (!tile) return;
    selectedBoardId = Number(tile.dataset.boardId);
    renderBoards();
  });

  const detailElement = byId("boardDetail");
  detailElement.addEventListener("submit", handleDetailSubmit);
  detailElement.addEventListener("click", handleDetailClick);

  byId("sharedTaskForm").addEventListener("submit", handleTaskDialogSubmit);
  byId("sharedTaskCancel").addEventListener("click", () => byId("sharedTaskDialog").close());
  byId("sharedTaskDelete").addEventListener("click", handleTaskDelete);
}
