// ==========================================================
// account.js — Hesap: kayıt, giriş, çıkış ve bulut yedeği (Ayarlar sayfasındaki kart)
//
// Dört durum vardır:
//   "offline"    -> sunucu çalışmıyor (uygulama yalnızca dosya olarak açılmış)
//   "guest"      -> sunucu var ama giriş yapılmamış
//   "unverified" -> giriş yapılmış ama e-posta adresi henüz doğrulanmamış
//   "user"       -> giriş yapılmış ve e-posta doğrulanmış
// Uygulama hesap olmadan da tam çalışır; hesap yalnızca yedekleme ve ortak panolar içindir.
// ==========================================================

import { api } from "../api.js";
import { IS_NATIVE_APP } from "../config.js";
import { exportAll, importAll } from "../storage.js";
import { askConfirm } from "../components.js";
import { byId, showToast } from "../utils.js";

let status = "offline";  // "offline" | "guest" | "unverified" | "user"
let currentUser = null;  // { id, email, name, emailVerified, isAdmin }
let formMode = "login";  // "login" | "register"
let onChange = null;     // giriş durumu değişince app.js'e haber vermek için

export function getCurrentUser() {
  return currentUser;
}

export function getAccountStatus() {
  return status;
}

// Hesap penceresini açar. Sayfadaki data-open-account özellikli her eleman bunu tetikler.
export function openAccountDialog() {
  showAccountError("");
  const dialog = byId("accountDialog");
  if (!dialog.open) dialog.showModal();
}

// Ayarlar sayfasındaki tek satırlık özet
function getSummaryText() {
  if (status === "offline") return "Sunucuya bağlı değil. Uygulama hesapsız çalışıyor.";
  if (status === "guest") return "Giriş yapılmadı. Hesap açarsan verilerini yedekleyebilir ve ortak pano kullanabilirsin.";
  if (status === "unverified") return `${currentUser.name} · ${currentUser.email} · e-posta doğrulanmadı`;
  return `${currentUser.name} · ${currentUser.email}`;
}

// ---------------- ÇİZİM ----------------

function formatBackupTime(timestamp) {
  return new Date(timestamp).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function renderAccount() {
  byId("accountSummary").textContent = getSummaryText();
  byId("accountOffline").hidden = status !== "offline";
  if (status === "offline" && IS_NATIVE_APP) {
    byId("accountOfflineText").textContent =
      "Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip uygulamayı yeniden aç. İnternet olmadan da uygulamanın geri kalanı tam çalışır.";
  }
  byId("accountGuest").hidden = status !== "guest";
  const isSignedIn = status === "user" || status === "unverified";
  byId("accountUser").hidden = !isSignedIn;
  byId("accountVerify").hidden = status !== "unverified";

  if (status === "guest") {
    const isRegister = formMode === "register";
    byId("accountNameField").hidden = !isRegister;
    byId("accountSubmit").textContent = isRegister ? "Hesap oluştur" : "Giriş yap";
    byId("accountPassword").autocomplete = isRegister ? "new-password" : "current-password";
    const buttons = byId("accountModes").querySelectorAll("[data-form-mode]");
    for (const button of buttons) {
      const isActive = button.dataset.formMode === formMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  }
  if (isSignedIn) {
    byId("accountWho").textContent = `${currentUser.name} · ${currentUser.email}`;
  }
  if (status === "unverified") {
    byId("accountVerifyText").textContent =
      `${currentUser.email} adresine bir doğrulama bağlantısı gönderdik. Ortak panoları kullanmak için maildeki bağlantıya tıkla. Gelen kutusunda yoksa spam klasörüne bak.`;
  }
}

function showAccountError(message) {
  const errorElement = byId("accountError");
  errorElement.textContent = message || "";
  errorElement.hidden = !message;
}

function setUser(user) {
  currentUser = user;
  status = "guest";
  if (user) status = user.emailVerified ? "user" : "unverified";
  renderAccount();
  if (onChange) onChange();
}

// ---------------- OLAYLAR ----------------

async function handleSubmit(event) {
  event.preventDefault();
  showAccountError("");
  const input = {
    name: byId("accountName").value,
    email: byId("accountEmail").value,
    password: byId("accountPassword").value,
  };

  // try / catch: await ile beklenen istek hata verirse catch bloğu çalışır.
  try {
    const result = formMode === "register" ? await api.register(input) : await api.login(input);
    byId("accountPassword").value = ""; // parolayı sayfada tutma
    setUser(result.user);
    let message = `Hoş geldin, ${result.user.name}.`;
    if (formMode === "register") {
      message = result.user.emailVerified ? "Hesabın oluşturuldu." : "Hesabın oluşturuldu. E-postana doğrulama bağlantısı gönderdik.";
    }
    showToast(message);
    refreshBackupInfo();
  } catch (error) {
    showAccountError(error.message);
  }
}

async function handleLogout() {
  try {
    await api.logout();
    setUser(null);
    showToast("Çıkış yapıldı. Verilerin bu cihazda durmaya devam ediyor.");
  } catch (error) {
    showToast(error.message);
  }
}

// Bu cihazdaki tüm veriyi sunucuya gönderir.
async function handleBackup() {
  const button = byId("backupBtn");
  button.disabled = true; // çift tıklamayı önle
  try {
    const local = exportAll();
    const result = await api.saveBackup({ data: local.data, whiteboard: local.whiteboard });
    byId("backupInfo").textContent = `Son yedek: ${formatBackupTime(result.updatedAt)}`;
    showToast("Verilerin buluta yedeklendi.");
  } catch (error) {
    showToast(error.message);
  }
  button.disabled = false;
}

// Sunucudaki yedeği bu cihaza yükler (bu cihazdaki verinin yerine geçer).
async function handleRestore() {
  let backup = null;
  try {
    backup = await api.loadBackup();
  } catch (error) {
    showToast(error.message);
    return;
  }
  if (backup.data === null) {
    showToast("Bulutta henüz bir yedeğin yok.");
    return;
  }

  askConfirm({
    title: "Buluttaki yedek yüklensin mi?",
    text: `${formatBackupTime(backup.updatedAt)} tarihli yedek, bu cihazdaki verilerin yerine geçecek.`,
    confirmLabel: "Yükle",
    onConfirm: () => {
      if (importAll({ app: "planstrator", data: backup.data, whiteboard: backup.whiteboard })) {
        window.location.reload();
      } else {
        showToast("Yedek yüklenemedi.");
      }
    },
  });
}

async function handleResend() {
  const button = byId("resendVerifyBtn");
  button.disabled = true;
  try {
    await api.resendVerification();
    showToast("Doğrulama maili yeniden gönderildi.");
  } catch (error) {
    showToast(error.message);
  }
  button.disabled = false;
}

// ---------------- HESABI SİLME ----------------

function showDeleteError(message) {
  const errorElement = byId("deleteAccountError");
  errorElement.textContent = message || "";
  errorElement.hidden = !message;
}

function openDeleteDialog() {
  byId("deleteAccountPassword").value = "";
  showDeleteError("");
  byId("deleteAccountDialog").showModal();
}

async function handleDeleteAccount(event) {
  event.preventDefault();
  const passwordInput = byId("deleteAccountPassword");
  if (passwordInput.value === "") {
    showDeleteError("Parolanı yaz.");
    return;
  }

  const button = byId("deleteAccountSubmit");
  button.disabled = true; // çift tıklamayı önle
  try {
    await api.deleteAccount(passwordInput.value);
    byId("deleteAccountDialog").close();
    setUser(null);
    showToast("Hesabın silindi. Bu cihazdaki verilerin durmaya devam ediyor.");
  } catch (error) {
    showDeleteError(error.message);
  }
  passwordInput.value = ""; // parolayı sayfada tutma
  button.disabled = false;
}

// Maildeki bağlantı kullanıcıyı ?verified=1 (ya da 0) ile uygulamaya geri getirir.
function showVerificationResult() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("verified")) return;
  showToast(params.get("verified") === "1"
    ? "E-posta adresin doğrulandı. Teşekkürler!"
    : "Doğrulama bağlantısı geçersiz ya da süresi dolmuş. Hesap penceresinden yenisini isteyebilirsin.");
  // Adres çubuğundaki ?verified=... kısmını temizle (sayfa yenilenince mesaj tekrar çıkmasın).
  window.history.replaceState(null, "", window.location.pathname + window.location.hash);
}

async function refreshBackupInfo() {
  if (currentUser === null) return;
  try {
    const backup = await api.loadBackup();
    byId("backupInfo").textContent = backup.updatedAt
      ? `Son yedek: ${formatBackupTime(backup.updatedAt)}`
      : "Henüz buluta yedek alınmadı.";
  } catch (error) {
    byId("backupInfo").textContent = "";
  }
}

// options.onChange: giriş durumu değişince çağrılır.
export async function initAccount(options) {
  onChange = options.onChange;

  // Sayfanın herhangi bir yerindeki "hesabı aç" düğmeleri (olay delegasyonu).
  document.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-open-account]");
    if (!opener) return;
    event.preventDefault(); // bağlantıysa sayfa değiştirmesin, pencere açılsın
    openAccountDialog();
  });
  byId("accountDialogClose").addEventListener("click", () => byId("accountDialog").close());
  // Pencere içindeki bir bağlantıyla başka sayfaya gidilirse pencereyi kapat.
  window.addEventListener("hashchange", () => {
    if (byId("accountDialog").open) byId("accountDialog").close();
  });

  byId("accountForm").addEventListener("submit", handleSubmit);
  byId("logoutBtn").addEventListener("click", handleLogout);
  byId("backupBtn").addEventListener("click", handleBackup);
  byId("restoreBtn").addEventListener("click", handleRestore);
  byId("resendVerifyBtn").addEventListener("click", handleResend);
  byId("deleteAccountBtn").addEventListener("click", openDeleteDialog);
  byId("deleteAccountForm").addEventListener("submit", handleDeleteAccount);
  byId("deleteAccountCancel").addEventListener("click", () => byId("deleteAccountDialog").close());
  byId("accountModes").addEventListener("click", (event) => {
    const button = event.target.closest("[data-form-mode]");
    if (!button) return;
    formMode = button.dataset.formMode;
    showAccountError("");
    renderAccount();
  });

  renderAccount(); // önce "sunucu yok" hali; yanıt gelince güncellenir
  showVerificationResult();

  // Sunucu var mı, giriş yapılmış mı? Yanıt gelmezse uygulama hesapsız çalışmaya devam eder.
  try {
    const result = await api.me();
    setUser(result.user);
    refreshBackupInfo();
  } catch (error) {
    status = "offline";
    renderAccount();
  }
}
