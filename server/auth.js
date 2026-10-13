// ==========================================================
// server/auth.js — Kayıt, giriş, çıkış ve "bu istek kimden geliyor?" denetimi
//
// KİMLİK DOĞRULAMA (authentication): "Sen kimsin?"  -> e-posta + parola
// YETKİLENDİRME (authorization):     "Buna iznin var mı?" -> ör. bu panonun üyesi misin?
//
// Parolalar asla düz metin saklanmaz. scrypt ile "özet"e (hash) çevrilir:
// özetten parolaya geri dönülemez; girişte yazılan parolanın özeti kayıtlıyla karşılaştırılır.
// Her kullanıcıya rastgele bir "tuz" (salt) eklenir ki aynı parola farklı özet üretsin.
// ==========================================================

import { Router } from "express";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { queryOne, run, batch } from "./db.js";
import { HttpError, cleanText, cleanEmail, isValidEmail } from "./helpers.js";
import { isMailEnabled, sendMail, getAppUrl, buildHtml, escapeHtml } from "./mail.js";

const COOKIE_NAME = "ps_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;       // 15 dakikada en fazla deneme
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_HOURS = 24;            // doğrulama bağlantısının geçerlilik süresi
const RESEND_WAIT_MS = 60 * 1000;   // yeniden gönderme için en az bekleme
const SEEN_UPDATE_MS = 60 * 60 * 1000; // "son görülme" en sık bu aralıkla yazılır

// ---------------- PAROLA ----------------

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  // timingSafeEqual: karşılaştırma süresinden bilgi sızmasını önler.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------------- OTURUM ----------------

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// Yeni oturum açar ve tarayıcıya çerez olarak gönderir.
async function startSession(response, userId) {
  const token = randomBytes(32).toString("hex"); // tahmin edilemez rastgele anahtar
  await run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    [hashToken(token), userId, Date.now() + SESSION_MS]);

  // HttpOnly: çerezi sayfadaki JavaScript okuyamaz (çalınmasını zorlaştırır).
  // SameSite=Lax: başka sitelerden gelen isteklerle birlikte gönderilmez.
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure"); // yalnızca HTTPS üzerinden
  response.setHeader("Set-Cookie", parts.join("; "));
  return token;
}

// Telefon uygulaması çerez kullanamaz; kendini tanıtırsa oturum anahtarını yanıtın içinde de veririz.
// Tarayıcıya vermiyoruz: orada anahtar yalnızca JavaScript'in okuyamadığı çerezde durmalı.
function withAppToken(request, payload, token) {
  if (request.headers["x-planstrator-client"] === "native") payload.token = token;
  return payload;
}

// Oturum anahtarını istekte arar. İki yerden gelebilir:
//   Telefon uygulaması:  "Authorization: Bearer <anahtar>" başlığı
//   Tarayıcı:            "Cookie" başlığındaki çerez
function readToken(request) {
  const authorization = request.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice("Bearer ".length);

  const header = request.headers.cookie || "";
  for (const part of header.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value;
  }
  return null;
}

async function findUserByToken(token) {
  if (!token) return null;
  const row = await queryOne(`
    SELECT users.id, users.email, users.name, users.email_verified, users.last_seen_at, sessions.expires_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `, [hashToken(token)]);

  if (!row || row.expires_at < Date.now()) return null;
  // "Son görülme" anını güncelle; her istekte yazmamak için en fazla saatte bir.
  if (Date.now() - (row.last_seen_at || 0) > SEEN_UPDATE_MS) {
    await run("UPDATE users SET last_seen_at = ? WHERE id = ?", [Date.now(), row.id]);
  }
  return toPublicUser(row);
}

// İstemciye gönderilecek kullanıcı bilgisi (parola özeti asla dahil değildir).
// E-posta servisi bağlı değilse doğrulama istenemez; herkes doğrulanmış sayılır.
function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: isVerified(row),
    isAdmin: isAdminUser(row),
  };
}

function isVerified(row) {
  return !isMailEnabled() || row.email_verified === 1;
}

// YÖNETİCİ: e-posta adresi ADMIN_EMAIL ortam değişkeninde yazan hesap(lar). Adres koda yazılmaz;
// sunucunun ayarlarına girilir (birden çok adres virgülle ayrılır). Ayar yoksa yönetici de yoktur.
// Adresin doğrulanmış olması şart: yoksa o adresle kayıt olabilen herkes yönetici olurdu.
function isAdminUser(row) {
  const admins = (process.env.ADMIN_EMAIL || "").toLowerCase().split(",").map((email) => email.trim());
  return admins.includes(row.email) && isVerified(row);
}

// ---------------- E-POSTA DOĞRULAMA ----------------

// Kullanıcıya, adresin gerçekten ona ait olduğunu kanıtlaması için tek kullanımlık bir bağlantı gönderir.
async function sendVerificationMail(request, user) {
  if (!isMailEnabled()) return false;

  const token = randomBytes(32).toString("hex");
  await run("DELETE FROM email_tokens WHERE user_id = ?", [user.id]); // eski bağlantılar geçersiz olsun
  await run("INSERT INTO email_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    [hashToken(token), user.id, Date.now() + VERIFY_HOURS * 60 * 60 * 1000]);

  const link = `${getAppUrl(request)}/api/auth/verify?token=${token}`;
  return sendMail({
    to: user.email,
    subject: "Planstrator: e-posta adresini doğrula",
    text: `Merhaba ${user.name},\n\nPlanstrator hesabını doğrulamak için bu bağlantıyı aç (${VERIFY_HOURS} saat geçerli):\n${link}\n\nBu hesabı sen açmadıysan bu maili yok sayabilirsin.`,
    html: buildHtml(
      `Merhaba ${escapeHtml(user.name)}`,
      [`Planstrator hesabın oluşturuldu. Ortak panoları kullanabilmek için e-posta adresini doğrulaman gerekiyor. Bağlantı ${VERIFY_HOURS} saat geçerlidir.`],
      { url: link, label: "E-postamı doğrula" },
    ),
  });
}

// ARA KATMAN (middleware): giriş gerektiren adreslerin önüne konur.
// Kullanıcıyı bulursa request.user'a yazar; bulamazsa isteği 401 ile keser.
export async function requireAuth(request, response, next) {
  const user = await findUserByToken(readToken(request));
  if (!user) throw new HttpError(401, "Bu işlem için giriş yapmalısın.");
  request.user = user;
  next();
}

// requireAuth'tan SONRA konur: giriş yapmış kullanıcı yönetici değilse isteği 403 ile keser.
// Menüdeki bağlantıyı gizlemek güvenlik değildir; asıl denetim burada, sunucuda yapılır.
export function requireAdmin(request, response, next) {
  if (!request.user.isAdmin) throw new HttpError(403, "Bu işlem için yetkin yok.");
  next();
}

// ---------------- GİRİŞ DENEMELERİNİ SINIRLAMA ----------------
// Parola tahmin saldırılarını yavaşlatır. Bellekte tutulur; sunucu yeniden başlayınca sıfırlanır.
const attempts = new Map(); // anahtar -> { count, firstAt }

function checkAttempts(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_LOGIN_ATTEMPTS) {
    throw new HttpError(429, "Çok fazla deneme yapıldı. Lütfen 15 dakika sonra tekrar dene.");
  }
}

// Bir kullanıcıyı ve ona bağlı her şeyi siler. Hem "hesabımı sil" hem yönetici paneli kullanır.
export async function deleteUserData(userId, email) {
  const ownBoards = "SELECT id FROM boards WHERE owner_id = ?";
  // Şemadaki ON DELETE CASCADE bunların çoğunu kendiliğinden siler; yine de tek tek yazıyoruz ki
  // neyin silindiği açıkça görülsün ve veritabanı ayarına bağlı kalmasın.
  // batch: ifadelerin ya hepsi uygulanır ya hiçbiri (yarım silinmiş hesap kalmaz).
  await batch([
    ["DELETE FROM sessions WHERE user_id = ?", [userId]],
    ["DELETE FROM email_tokens WHERE user_id = ?", [userId]],
    // Kişisel veriler (bulut yedeği)
    ["DELETE FROM categories WHERE user_id = ?", [userId]],
    ["DELETE FROM tasks WHERE user_id = ?", [userId]],
    ["DELETE FROM pomodoro_sessions WHERE user_id = ?", [userId]],
    ["DELETE FROM goals WHERE user_id = ?", [userId]],
    ["DELETE FROM checklist_templates WHERE user_id = ?", [userId]],
    ["DELETE FROM user_extras WHERE user_id = ?", [userId]],
    // Sahibi olduğu ortak panolar, içindekilerle birlikte
    [`DELETE FROM board_tasks WHERE board_id IN (${ownBoards})`, [userId]],
    [`DELETE FROM board_invites WHERE board_id IN (${ownBoards})`, [userId]],
    [`DELETE FROM board_members WHERE board_id IN (${ownBoards})`, [userId]],
    ["DELETE FROM boards WHERE owner_id = ?", [userId]],
    // Başkalarının panolarındaki izleri: üyelik ve davetler silinir,
    // eklediği görevler panoda kalır ama artık ona bağlı değildir.
    ["DELETE FROM board_members WHERE user_id = ?", [userId]],
    ["DELETE FROM board_invites WHERE invited_by = ? OR email = ?", [userId, email]],
    ["UPDATE board_tasks SET assignee_id = NULL WHERE assignee_id = ?", [userId]],
    ["UPDATE board_tasks SET created_by = NULL WHERE created_by = ?", [userId]],
    ["DELETE FROM users WHERE id = ?", [userId]],
  ]);
}

// ---------------- ADRESLER ----------------

export const authRouter = Router();

// Kayıt ol
authRouter.post("/register", async (request, response) => {
  const email = cleanEmail(request.body.email);
  const name = cleanText(request.body.name, 60);
  const password = typeof request.body.password === "string" ? request.body.password : "";

  if (!isValidEmail(email)) throw new HttpError(400, "Geçerli bir e-posta adresi yaz.");
  if (name === "") throw new HttpError(400, "Adını yaz.");
  if (password.length < 8 || password.length > 200) throw new HttpError(400, "Parola en az 8 karakter olmalı.");

  const existing = await queryOne("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) throw new HttpError(409, "Bu e-posta ile zaten bir hesap var.");

  const result = await run("INSERT INTO users (email, name, password_hash, last_seen_at) VALUES (?, ?, ?, ?)",
    [email, name, hashPassword(password), Date.now()]);

  const user = toPublicUser({ id: result.lastId, email: email, name: name, email_verified: 0 });
  const token = await startSession(response, user.id);
  await sendVerificationMail(request, user);
  response.status(201).json(withAppToken(request, { user: user }, token));
});

// Giriş yap
authRouter.post("/login", async (request, response) => {
  const email = cleanEmail(request.body.email);
  const password = typeof request.body.password === "string" ? request.body.password : "";
  checkAttempts(`${request.ip}|${email}`);

  const user = await queryOne("SELECT id, email, name, password_hash, email_verified FROM users WHERE email = ?", [email]);
  // Hangi bilginin yanlış olduğunu söylemiyoruz; saldırgan e-postanın kayıtlı olup olmadığını öğrenemesin.
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, "E-posta ya da parola hatalı.");
  }

  const token = await startSession(response, user.id);
  await run("UPDATE users SET last_seen_at = ? WHERE id = ?", [Date.now(), user.id]);
  response.json(withAppToken(request, { user: toPublicUser(user) }, token));
});

// Çıkış yap
authRouter.post("/logout", async (request, response) => {
  const token = readToken(request);
  if (token) await run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  response.json({ ok: true });
});

// Giriş yapmış kullanıcı kim? (Giriş yoksa user: null döner; hata değildir.)
authRouter.get("/me", async (request, response) => {
  response.json({ user: await findUserByToken(readToken(request)) });
});

// Maildeki bağlantıya tıklanınca açılan adres. Tarayıcıdan doğrudan açıldığı için GET'tir.
authRouter.get("/verify", async (request, response) => {
  const token = typeof request.query.token === "string" ? request.query.token : "";
  const row = token === ""
    ? undefined
    : await queryOne("SELECT user_id, expires_at FROM email_tokens WHERE token_hash = ?", [hashToken(token)]);

  if (!row || row.expires_at < Date.now()) {
    response.redirect("/?verified=0#settings"); // geçersiz ya da süresi dolmuş bağlantı
    return;
  }
  await batch([
    ["UPDATE users SET email_verified = 1 WHERE id = ?", [row.user_id]],
    ["DELETE FROM email_tokens WHERE user_id = ?", [row.user_id]], // bağlantı tek kullanımlık
  ]);
  response.redirect("/?verified=1#settings");
});

// Doğrulama mailini yeniden gönder (giriş yapmış, henüz doğrulanmamış kullanıcı için).
const lastResend = new Map(); // kullanıcı id -> son gönderim anı
authRouter.post("/resend-verification", requireAuth, async (request, response) => {
  if (request.user.emailVerified) throw new HttpError(400, "E-posta adresin zaten doğrulanmış.");

  const last = lastResend.get(request.user.id) || 0;
  if (Date.now() - last < RESEND_WAIT_MS) throw new HttpError(429, "Lütfen bir dakika bekleyip tekrar dene.");
  lastResend.set(request.user.id, Date.now());

  const sent = await sendVerificationMail(request, request.user);
  if (!sent) throw new HttpError(502, "E-posta gönderilemedi. Daha sonra tekrar dene.");
  response.json({ ok: true });
});

// Hesabı ve ona bağlı her şeyi kalıcı olarak siler. Geri alınamadığı için parola yeniden istenir:
// açık unutulmuş bir oturumu ele geçiren biri hesabı silemesin.
authRouter.delete("/account", requireAuth, async (request, response) => {
  const password = typeof request.body.password === "string" ? request.body.password : "";
  checkAttempts(`${request.ip}|delete|${request.user.id}`);

  const row = await queryOne("SELECT password_hash FROM users WHERE id = ?", [request.user.id]);
  if (!row || !verifyPassword(password, row.password_hash)) throw new HttpError(403, "Parola hatalı.");

  await deleteUserData(request.user.id, request.user.email);

  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  response.json({ ok: true });
});

// Süresi dolmuş oturumları temizler (sunucu açılırken bir kez çağrılır).
export async function deleteExpiredSessions() {
  await run("DELETE FROM sessions WHERE expires_at < ?", [Date.now()]);
  await run("DELETE FROM email_tokens WHERE expires_at < ?", [Date.now()]);
}
