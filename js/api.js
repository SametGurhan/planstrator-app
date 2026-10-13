// ==========================================================
// api.js — Sunucuyla (backend) konuşan TEK dosya
//
// Frontend veritabanına doğrudan erişmez; HTTP istekleriyle sunucudaki API'ye başvurur.
// fetch bir Promise döndürür: yanıt hemen gelmez, "gelince haber veririm" der.
// async / await bu beklemeyi düz kod gibi yazmamızı sağlar:
//   const result = await api.me();   // yanıt gelene kadar bu satırda bekler
// await yalnızca async ile işaretlenmiş fonksiyonların içinde kullanılabilir.
//
// Oturum iki farklı yolla taşınır:
//   Tarayıcıda: sunucunun verdiği çerezle (JavaScript onu göremez; en güvenlisi budur).
//   Telefon uygulamasında: çerez başka bir siteye gönderilemediği için sunucu bir
//     "oturum anahtarı" verir; uygulama onu saklar ve her istekte başlıkta gönderir.
// ==========================================================

import { API_ORIGIN, IS_NATIVE_APP } from "./config.js";
import { readPreference, savePreference, removePreference } from "./storage.js";

const TOKEN_KEY = "planstrator.session";

// Sunucudan gelen hatalar için. status: HTTP kodu (0 = sunucuya hiç ulaşılamadı).
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = {
    "Content-Type": "application/json",
    "X-Requested-With": "planstrator", // sunucu, veri değiştiren isteklerde bu başlığı şart koşar
  };
  if (IS_NATIVE_APP) {
    headers["X-Planstrator-Client"] = "native"; // "ben telefon uygulamasıyım, oturum anahtarı ver"
    const token = readPreference(TOKEN_KEY, "");
    if (token !== "") headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_ORIGIN}/api${path}`, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Tarayıcıda oturum çerezini gönder; telefonda çerez kullanılmaz.
      credentials: IS_NATIVE_APP ? "omit" : "same-origin",
    });
  } catch (error) {
    throw new ApiError(0, "Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.");
  }

  // Yanıt JSON değilse (ör. sunucu yerine basit bir dosya sunucusu çalışıyorsa) payload null kalır.
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (payload === null) throw new ApiError(0, "Planstrator sunucusu çalışmıyor.");
  if (!response.ok) throw new ApiError(response.status, payload.error || "İstek başarısız oldu.");
  return payload;
}

// Giriş ve kayıt yanıtındaki oturum anahtarını saklar (yalnızca telefon uygulamasında gelir).
async function signIn(path, input) {
  const result = await request("POST", path, input);
  if (result.token) savePreference(TOKEN_KEY, result.token);
  return result;
}

async function signOut() {
  try {
    return await request("POST", "/auth/logout");
  } finally {
    // İstek başarısız olsa bile bu cihazdaki anahtarı sil.
    removePreference(TOKEN_KEY);
  }
}

// Sunucudaki her adres için bir fonksiyon.
export const api = {
  // Hesap
  me: () => request("GET", "/auth/me"),
  register: (input) => signIn("/auth/register", input),
  login: (input) => signIn("/auth/login", input),
  logout: signOut,
  resendVerification: () => request("POST", "/auth/resend-verification"),

  // Bulut yedeği
  loadBackup: () => request("GET", "/sync"),
  saveBackup: (backup) => request("PUT", "/sync", backup),
  stats: () => request("GET", "/stats"),

  // Ortak panolar
  listBoards: () => request("GET", "/boards"),
  createBoard: (name) => request("POST", "/boards", { name: name }),
  getBoard: (boardId) => request("GET", `/boards/${boardId}`),
  deleteBoard: (boardId) => request("DELETE", `/boards/${boardId}`),
  invite: (boardId, email) => request("POST", `/boards/${boardId}/invites`, { email: email }),
  cancelInvite: (boardId, inviteId) => request("DELETE", `/boards/${boardId}/invites/${inviteId}`),
  acceptInvite: (inviteId) => request("POST", `/invites/${inviteId}/accept`),
  declineInvite: (inviteId) => request("POST", `/invites/${inviteId}/decline`),
  removeMember: (boardId, userId) => request("DELETE", `/boards/${boardId}/members/${userId}`),
  addTask: (boardId, input) => request("POST", `/boards/${boardId}/tasks`, input),
  updateTask: (boardId, taskId, changes) => request("PATCH", `/boards/${boardId}/tasks/${taskId}`, changes),
  deleteTask: (boardId, taskId) => request("DELETE", `/boards/${boardId}/tasks/${taskId}`),
};
