// ==========================================================
// server/admin.js — Yönetici paneli: kullanıcı listesi ve kullanıcı silme
//
// Buradaki her adres iki denetimden geçer: requireAuth (giriş yapılmış mı?) ve
// requireAdmin (bu hesap yönetici mi?). Yönetici, ADMIN_EMAIL ortam değişkenindeki adrestir.
// Parola özetleri ve kullanıcıların kişisel içerikleri (görevler, notlar) buradan ASLA dönmez.
// ==========================================================

import { Router } from "express";
import { query, queryOne } from "./db.js";
import { requireAuth, requireAdmin, deleteUserData } from "./auth.js";
import { HttpError, toId } from "./helpers.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

// created_at veritabanında "2026-10-13 09:30:00" (UTC) metni olarak durur; zaman damgasına çeviriyoruz.
function toTimestamp(sqlDate) {
  return Date.parse(`${sqlDate.replace(" ", "T")}Z`);
}

// Tüm kullanıcılar, en yeni kayıt en üstte.
adminRouter.get("/users", async (request, response) => {
  const rows = await query(`
    SELECT users.id, users.name, users.email, users.email_verified, users.created_at, users.last_seen_at,
      (SELECT COUNT(*) FROM boards WHERE boards.owner_id = users.id) AS board_count,
      (SELECT COUNT(*) FROM user_extras WHERE user_extras.user_id = users.id) AS backup_count
    FROM users
    ORDER BY users.id DESC
  `);

  response.json({
    users: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: row.email_verified === 1,
      createdAt: toTimestamp(row.created_at),
      lastSeenAt: row.last_seen_at, // bu özellik eklenmeden önce kaydolup hiç dönmeyenlerde null
      boardCount: row.board_count,
      hasBackup: row.backup_count > 0,
      isSelf: row.id === request.user.id,
    })),
  });
});

// Bir kullanıcıyı, ona bağlı her şeyle birlikte siler.
adminRouter.delete("/users/:userId", async (request, response) => {
  const userId = toId(request.params.userId);
  // Yönetici kendini buradan silemez; yoksa paneli kullanacak kimse kalmaz.
  if (userId === request.user.id) throw new HttpError(400, "Kendi hesabını buradan silemezsin. Hesap penceresini kullan.");

  const user = await queryOne("SELECT id, email FROM users WHERE id = ?", [userId]);
  if (!user) throw new HttpError(404, "Kullanıcı bulunamadı.");

  await deleteUserData(user.id, user.email);
  response.json({ ok: true });
});
