// ==========================================================
// admin.js — Yönetici paneli: kayıtlı kullanıcıların listesi ve kullanıcı silme
//
// Bu sayfa yalnızca yönetici hesabında menüde görünür. Ama asıl koruma burada değil,
// sunucudadır: yönetici olmayan biri adresi elle yazsa bile sunucu listeyi vermez (403).
// ==========================================================

import { api } from "../api.js";
import { askConfirm } from "../components.js";
import { getCurrentUser } from "./account.js";
import { byId, clear, el, icon, showToast } from "../utils.js";

function isAdmin() {
  const user = getCurrentUser();
  return user !== null && user.isAdmin === true;
}

function formatDateTime(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function showMessage(text) {
  byId("adminTableWrap").hidden = true;
  const message = byId("adminMessage");
  message.textContent = text;
  message.hidden = false;
}

// ---------------- ÇİZİM ----------------

function createUserRow(user) {
  const row = el("tr");

  const nameCell = el("td");
  nameCell.append(el("span", "admin-name", user.name)); // kullanıcının yazdığı metin: textContent ile
  if (user.isSelf) nameCell.append(el("span", "badge", "Sen"));
  row.append(nameCell);

  row.append(el("td", "", user.email));
  row.append(el("td", "", user.emailVerified ? "Evet" : "Hayır"));
  row.append(el("td", "", formatDateTime(user.createdAt)));
  row.append(el("td", "", formatDateTime(user.lastSeenAt)));
  row.append(el("td", "", String(user.boardCount)));
  row.append(el("td", "", user.hasBackup ? "Var" : "Yok"));

  const actionCell = el("td", "admin-actions");
  if (!user.isSelf) {
    const button = el("button", "icon-btn icon-btn--sm btn--danger-text");
    button.type = "button";
    button.dataset.deleteUser = String(user.id);
    button.dataset.userLabel = `${user.name} (${user.email})`;
    button.setAttribute("aria-label", `${user.name} kullanıcısını sil`);
    button.title = "Kullanıcıyı sil";
    button.append(icon("trash"));
    actionCell.append(button);
  }
  row.append(actionCell);
  return row;
}

export async function renderAdmin() {
  if (!isAdmin()) {
    byId("adminSummary").textContent = "";
    showMessage("Bu sayfa yalnızca yönetici hesabı içindir.");
    return;
  }

  let users = [];
  try {
    users = (await api.listUsers()).users;
  } catch (error) {
    showMessage(error.message);
    return;
  }

  const verifiedCount = users.filter((user) => user.emailVerified).length;
  byId("adminSummary").textContent = `${users.length} kayıtlı kullanıcı · ${verifiedCount} doğrulanmış`;

  const body = byId("adminRows");
  clear(body);
  for (const user of users) {
    body.append(createUserRow(user));
  }
  byId("adminMessage").hidden = true;
  byId("adminTableWrap").hidden = false;
}

// ---------------- OLAYLAR ----------------

async function deleteUser(userId) {
  try {
    await api.adminDeleteUser(userId);
    showToast("Kullanıcı silindi.");
  } catch (error) {
    showToast(error.message);
  }
  renderAdmin();
}

export function initAdmin() {
  byId("adminRefreshBtn").addEventListener("click", renderAdmin);

  // Olay delegasyonu: satırlar sonradan çizildiği için tıklamayı tablonun gövdesinde dinliyoruz.
  byId("adminRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-user]");
    if (!button) return;
    askConfirm({
      title: "Kullanıcı silinsin mi?",
      text: `${button.dataset.userLabel} hesabı, bulut yedeği ve sahibi olduğu ortak panolarla birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      confirmLabel: "Kullanıcıyı sil",
      onConfirm: () => deleteUser(Number(button.dataset.deleteUser)),
    });
  });
}
