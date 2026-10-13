// ==========================================================
// server/boards.js — Ortak panolar: üyeler, e-posta davetleri ve ortak görevler
//
// REST API kuralı: adres "ne" olduğunu, HTTP yöntemi "ne yapılacağını" söyler.
//   GET    /api/boards            panolarımı listele
//   POST   /api/boards            yeni pano oluştur
//   GET    /api/boards/5          5 numaralı panoyu getir
//   PATCH  /api/boards/5/tasks/9  9 numaralı görevi güncelle
//   DELETE /api/boards/5          panoyu sil
//
// Her adımda YETKİ denetlenir: kullanıcı yalnızca üyesi olduğu panoları görebilir.
// ==========================================================

import { Router } from "express";
import { query, queryOne, run, batch } from "./db.js";
import { requireAuth } from "./auth.js";
import { HttpError, cleanText, cleanDate, cleanEmail, isValidEmail, oneOf, toId } from "./helpers.js";
import { sendMail, getAppUrl, buildHtml, escapeHtml } from "./mail.js";

const STATUSES = ["todo", "doing", "done"];
const MAX_BOARDS_PER_USER = 50;
const MAX_TASKS_PER_BOARD = 1000;
const MAX_PENDING_INVITES = 20; // pano başına yanıt bekleyen davet (toplu mail gönderimini önler)

// ---------------- YETKİ ----------------

// Kullanıcı bu panonun üyesi mi? Değilse 404 veriyoruz (403 değil):
// üye olmayan biri panonun var olduğunu bile öğrenememeli.
async function requireMember(boardId, userId) {
  const member = await queryOne("SELECT role FROM board_members WHERE board_id = ? AND user_id = ?", [boardId, userId]);
  if (!member) throw new HttpError(404, "Pano bulunamadı.");
  return member.role;
}

async function requireOwner(boardId, userId) {
  if ((await requireMember(boardId, userId)) !== "owner") {
    throw new HttpError(403, "Bu işlemi yalnızca pano sahibi yapabilir.");
  }
}

// Davetler e-posta adresine göre eşleşir. Adres doğrulanmadan davet göstermek ya da kabul
// ettirmek, başkasının adresiyle hesap açan birinin onun davetlerine ulaşmasına yol açardı.
function requireVerified(user) {
  if (!user.emailVerified) throw new HttpError(403, "Bunun için önce e-posta adresini doğrulamalısın.");
}

// ---------------- OKUMA YARDIMCILARI ----------------

function getMembers(boardId) {
  return query(`
    SELECT users.id, users.name, users.email, board_members.role
    FROM board_members
    JOIN users ON users.id = board_members.user_id
    WHERE board_members.board_id = ?
    ORDER BY board_members.role DESC, users.name
  `, [boardId]);
}

function getTasks(boardId) {
  return query(`
    SELECT board_tasks.id, board_tasks.title, board_tasks.description, board_tasks.status,
           board_tasks.due_date AS dueDate, board_tasks.assignee_id AS assigneeId,
           users.name AS assigneeName
    FROM board_tasks
    LEFT JOIN users ON users.id = board_tasks.assignee_id
    WHERE board_tasks.board_id = ?
    ORDER BY board_tasks.sort_order, board_tasks.id
  `, [boardId]);
}

async function getBoardDetail(boardId, userId) {
  const role = await requireMember(boardId, userId);
  const board = await queryOne("SELECT id, name, owner_id AS ownerId FROM boards WHERE id = ?", [boardId]);
  const invites = await query("SELECT id, email FROM board_invites WHERE board_id = ? ORDER BY email", [boardId]);
  return {
    board: { ...board, role: role },
    members: await getMembers(boardId),
    invites: invites,
    tasks: await getTasks(boardId),
  };
}

// Bir sütundaki son sıranın bir fazlası (yeni görev sütunun sonuna eklenir).
async function nextSortOrder(boardId, status) {
  const row = await queryOne(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM board_tasks WHERE board_id = ? AND status = ?",
    [boardId, status],
  );
  return row.next;
}

// Atanacak kişi panonun üyesi olmalı.
async function cleanAssignee(boardId, value) {
  if (value === null || value === undefined || value === "") return null;
  const userId = Number(value);
  if (!Number.isInteger(userId)) throw new HttpError(400, "Görev yalnızca pano üyelerine atanabilir.");
  const member = await queryOne("SELECT 1 AS found FROM board_members WHERE board_id = ? AND user_id = ?", [boardId, userId]);
  if (!member) throw new HttpError(400, "Görev yalnızca pano üyelerine atanabilir.");
  return userId;
}

// ---------------- ADRESLER ----------------

export const boardsRouter = Router();
boardsRouter.use(requireAuth);

// Panolarım (her pano için üye ve açık görev sayısıyla)
boardsRouter.get("/boards", async (request, response) => {
  const boards = await query(`
    SELECT boards.id, boards.name, board_members.role,
           (SELECT COUNT(*) FROM board_members AS m WHERE m.board_id = boards.id) AS memberCount,
           (SELECT COUNT(*) FROM board_tasks AS t WHERE t.board_id = boards.id AND t.status != 'done') AS openCount
    FROM board_members
    JOIN boards ON boards.id = board_members.board_id
    WHERE board_members.user_id = ?
    ORDER BY boards.name
  `, [request.user.id]);

  // Bana gelen, henüz yanıtlamadığım davetler (e-posta adresimle eşleşenler).
  // Adresim doğrulanmamışsa gösterilmez.
  const invites = !request.user.emailVerified ? [] : await query(`
    SELECT board_invites.id, boards.name AS boardName, users.name AS invitedBy
    FROM board_invites
    JOIN boards ON boards.id = board_invites.board_id
    JOIN users ON users.id = board_invites.invited_by
    WHERE board_invites.email = ?
    ORDER BY board_invites.created_at DESC
  `, [request.user.email]);

  response.json({ boards: boards, invites: invites });
});

// Yeni pano
boardsRouter.post("/boards", async (request, response) => {
  const name = cleanText(request.body.name, 60);
  if (name === "") throw new HttpError(400, "Pano adı boş olamaz.");

  const owned = await queryOne("SELECT COUNT(*) AS count FROM boards WHERE owner_id = ?", [request.user.id]);
  if (owned.count >= MAX_BOARDS_PER_USER) throw new HttpError(400, "En fazla 50 pano oluşturabilirsin.");

  // RETURNING id: eklenen satırın kimliğini aynı sorgunun sonucu olarak geri verir.
  const created = await queryOne("INSERT INTO boards (name, owner_id) VALUES (?, ?) RETURNING id", [name, request.user.id]);
  const boardId = Number(created.id);

  // Pano sahibinin üyeliği. Bu adım başarısız olursa sahipsiz pano kalmasın diye panoyu geri siliyoruz.
  try {
    await run("INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')", [boardId, request.user.id]);
  } catch (error) {
    await run("DELETE FROM boards WHERE id = ?", [boardId]);
    throw error;
  }
  response.status(201).json(await getBoardDetail(boardId, request.user.id));
});

// Pano ayrıntısı
boardsRouter.get("/boards/:boardId", async (request, response) => {
  response.json(await getBoardDetail(toId(request.params.boardId), request.user.id));
});

// Panoyu sil (yalnızca sahibi). Panoya bağlı her şey aynı işlemde silinir.
boardsRouter.delete("/boards/:boardId", async (request, response) => {
  const boardId = toId(request.params.boardId);
  await requireOwner(boardId, request.user.id);
  await batch([
    ["DELETE FROM board_tasks WHERE board_id = ?", [boardId]],
    ["DELETE FROM board_invites WHERE board_id = ?", [boardId]],
    ["DELETE FROM board_members WHERE board_id = ?", [boardId]],
    ["DELETE FROM boards WHERE id = ?", [boardId]],
  ]);
  response.json({ ok: true });
});

// ---- Davetler ----

// E-posta ile davet et (yalnızca sahibi)
boardsRouter.post("/boards/:boardId/invites", async (request, response) => {
  const boardId = toId(request.params.boardId);
  await requireOwner(boardId, request.user.id);
  requireVerified(request.user);

  const email = cleanEmail(request.body.email);
  if (!isValidEmail(email)) throw new HttpError(400, "Geçerli bir e-posta adresi yaz.");
  if (email === request.user.email) throw new HttpError(400, "Kendini davet edemezsin.");

  const pending = await queryOne("SELECT COUNT(*) AS count FROM board_invites WHERE board_id = ?", [boardId]);
  if (pending.count >= MAX_PENDING_INVITES) throw new HttpError(400, "Bu panoda yanıt bekleyen çok fazla davet var.");

  const alreadyMember = await queryOne(`
    SELECT 1 AS found FROM board_members
    JOIN users ON users.id = board_members.user_id
    WHERE board_members.board_id = ? AND users.email = ?
  `, [boardId, email]);
  if (alreadyMember) throw new HttpError(409, "Bu kişi zaten panonun üyesi.");

  // INSERT OR IGNORE: aynı davet zaten varsa (UNIQUE kuralı) hata vermeden atlar.
  const inserted = await run("INSERT OR IGNORE INTO board_invites (board_id, email, invited_by) VALUES (?, ?, ?)",
    [boardId, email, request.user.id]);

  // Yeni bir davetse arkadaşa haber maili gönder (e-posta servisi bağlı değilse sessizce atlanır).
  if (inserted.changes > 0) {
    const board = await queryOne("SELECT name FROM boards WHERE id = ?", [boardId]);
    const appUrl = getAppUrl(request);
    await sendMail({
      to: email,
      subject: `Planstrator: "${board.name}" panosuna davet edildin`,
      text: `${request.user.name} seni Planstrator'da "${board.name}" panosuna davet etti.\n\n${appUrl} adresini aç, bu e-posta adresiyle giriş yap ya da hesap oluştur; davet "Ortak Panolar" sayfasında görünecek.`,
      html: buildHtml(
        "Bir panoya davet edildin",
        [
          `<strong>${escapeHtml(request.user.name)}</strong> seni Planstrator'da <strong>${escapeHtml(board.name)}</strong> panosuna davet etti.`,
          "Bu e-posta adresiyle giriş yap ya da hesap oluştur; davet \"Ortak Panolar\" sayfasında görünecek.",
        ],
        { url: `${appUrl}/#boards`, label: "Planstrator'ı aç" },
      ),
    });
  }
  response.status(201).json(await getBoardDetail(boardId, request.user.id));
});

// Gönderilmiş daveti geri al (yalnızca sahibi)
boardsRouter.delete("/boards/:boardId/invites/:inviteId", async (request, response) => {
  const boardId = toId(request.params.boardId);
  await requireOwner(boardId, request.user.id);
  await run("DELETE FROM board_invites WHERE id = ? AND board_id = ?", [toId(request.params.inviteId), boardId]);
  response.json(await getBoardDetail(boardId, request.user.id));
});

// Bana gelen daveti bul. Davet yalnızca gönderildiği e-posta adresinin sahibi tarafından yanıtlanabilir.
async function findMyInvite(inviteId, email) {
  const invite = await queryOne("SELECT id, board_id AS boardId FROM board_invites WHERE id = ? AND email = ?", [inviteId, email]);
  if (!invite) throw new HttpError(404, "Davet bulunamadı.");
  return invite;
}

boardsRouter.post("/invites/:inviteId/accept", async (request, response) => {
  requireVerified(request.user);
  const invite = await findMyInvite(toId(request.params.inviteId), request.user.email);
  // Üyeliği ekle ve daveti sil: ikisi birlikte.
  await batch([
    ["INSERT OR IGNORE INTO board_members (board_id, user_id, role) VALUES (?, ?, 'member')", [invite.boardId, request.user.id]],
    ["DELETE FROM board_invites WHERE id = ?", [invite.id]],
  ]);
  response.json({ boardId: invite.boardId });
});

boardsRouter.post("/invites/:inviteId/decline", async (request, response) => {
  const invite = await findMyInvite(toId(request.params.inviteId), request.user.email);
  await run("DELETE FROM board_invites WHERE id = ?", [invite.id]);
  response.json({ ok: true });
});

// ---- Üyeler ----

// Üyeyi çıkar: sahip başkasını çıkarabilir, üye yalnızca kendisi ayrılabilir.
boardsRouter.delete("/boards/:boardId/members/:userId", async (request, response) => {
  const boardId = toId(request.params.boardId);
  const targetId = toId(request.params.userId);
  const role = await requireMember(boardId, request.user.id);

  const board = await queryOne("SELECT owner_id AS ownerId FROM boards WHERE id = ?", [boardId]);
  if (targetId === board.ownerId) throw new HttpError(400, "Pano sahibi panodan çıkarılamaz; panoyu silebilirsin.");
  if (role !== "owner" && targetId !== request.user.id) throw new HttpError(403, "Başka bir üyeyi çıkaramazsın.");

  await batch([
    // Ayrılan üyenin üstlendiği görevler sahipsiz kalır (silinmez).
    ["UPDATE board_tasks SET assignee_id = NULL WHERE board_id = ? AND assignee_id = ?", [boardId, targetId]],
    ["DELETE FROM board_members WHERE board_id = ? AND user_id = ?", [boardId, targetId]],
  ]);
  response.json({ ok: true });
});

// ---- Ortak görevler ----

boardsRouter.post("/boards/:boardId/tasks", async (request, response) => {
  const boardId = toId(request.params.boardId);
  await requireMember(boardId, request.user.id);

  const title = cleanText(request.body.title, 120);
  if (title === "") throw new HttpError(400, "Görev başlığı boş olamaz.");
  const count = await queryOne("SELECT COUNT(*) AS count FROM board_tasks WHERE board_id = ?", [boardId]);
  if (count.count >= MAX_TASKS_PER_BOARD) throw new HttpError(400, "Bu pano görev sınırına ulaştı.");

  const status = oneOf(request.body.status, STATUSES, "todo");
  await run(`
    INSERT INTO board_tasks (board_id, title, description, status, due_date, assignee_id, sort_order, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    boardId, title, cleanText(request.body.description, 1000), status, cleanDate(request.body.dueDate),
    await cleanAssignee(boardId, request.body.assigneeId), await nextSortOrder(boardId, status), request.user.id,
  ]);
  response.status(201).json({ tasks: await getTasks(boardId) });
});

// Görevi güncelle. Yalnızca gönderilen alanlar değişir.
// beforeTaskId gönderilirse görev, o görevin önüne yerleştirilir (sürükle-bırak sıralaması).
boardsRouter.patch("/boards/:boardId/tasks/:taskId", async (request, response) => {
  const boardId = toId(request.params.boardId);
  const taskId = toId(request.params.taskId);
  await requireMember(boardId, request.user.id);

  // board_id koşulu önemli: başka bir panonun görevi bu adresle değiştirilemesin.
  const task = await queryOne("SELECT * FROM board_tasks WHERE id = ? AND board_id = ?", [taskId, boardId]);
  if (!task) throw new HttpError(404, "Görev bulunamadı.");

  const body = request.body;
  const title = "title" in body ? cleanText(body.title, 120) : task.title;
  if (title === "") throw new HttpError(400, "Görev başlığı boş olamaz.");
  const description = "description" in body ? cleanText(body.description, 1000) : task.description;
  const dueDate = "dueDate" in body ? cleanDate(body.dueDate) : task.due_date;
  const assigneeId = "assigneeId" in body ? await cleanAssignee(boardId, body.assigneeId) : task.assignee_id;
  const status = "status" in body ? oneOf(body.status, STATUSES, task.status) : task.status;

  const statements = [];
  let sortOrder = task.sort_order;
  const isMoving = status !== task.status || "beforeTaskId" in body;

  if (isMoving) {
    // Hedef sütunun (bu görev hariç) sıralı kimlik listesi
    const rows = await query(
      "SELECT id FROM board_tasks WHERE board_id = ? AND status = ? AND id != ? ORDER BY sort_order, id",
      [boardId, status, taskId],
    );
    const columnIds = rows.map((row) => row.id);

    let position = columnIds.indexOf(Number(body.beforeTaskId));
    if (position === -1) position = columnIds.length; // bulunamadıysa sona
    columnIds.splice(position, 0, taskId);

    // Sütundaki herkese yeni sıra numarası ver.
    columnIds.forEach((id, index) => {
      statements.push(["UPDATE board_tasks SET sort_order = ? WHERE id = ? AND board_id = ?", [index, id, boardId]]);
    });
    sortOrder = position;
  }

  statements.push([`
    UPDATE board_tasks
    SET title = ?, description = ?, due_date = ?, assignee_id = ?, status = ?, sort_order = ?, updated_at = datetime('now')
    WHERE id = ? AND board_id = ?
  `, [title, description, dueDate, assigneeId, status, sortOrder, taskId, boardId]]);

  await batch(statements); // sıralama ve güncelleme tek işlemde
  response.json({ tasks: await getTasks(boardId) });
});

boardsRouter.delete("/boards/:boardId/tasks/:taskId", async (request, response) => {
  const boardId = toId(request.params.boardId);
  await requireMember(boardId, request.user.id);
  await run("DELETE FROM board_tasks WHERE id = ? AND board_id = ?", [toId(request.params.taskId), boardId]);
  response.json({ tasks: await getTasks(boardId) });
});
