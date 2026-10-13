// ==========================================================
// tests/server.test.js — Sunucunun (API) uçtan uca testleri
// Gerçek bir sunucuyu geçici bir portta ve boş, geçici bir veritabanıyla açar,
// sonra tarayıcının yapacağı gibi istek gönderip yanıtları denetler.
// ==========================================================

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Veritabanı modülü yüklenmeden ÖNCE ayarlanmalı: gerçek veritabanı yerine
// geçici bir klasördeki boş bir dosyada çalış; testler bitince silinir.
const tempFolder = mkdtempSync(path.join(tmpdir(), "planstrator-test-"));
process.env.TURSO_DATABASE_URL = pathToFileURL(path.join(tempFolder, "test.db")).href;
const { createApp } = await import("../server/server.js");

let server = null;
let baseUrl = "";

before(async () => {
  await new Promise((resolve) => {
    server = createApp().listen(0, resolve); // 0: boş bir portu sistem seçsin
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
  try {
    rmSync(tempFolder, { recursive: true, force: true });
  } catch (error) {
    // Windows dosyayı hâlâ kilitli tutuyorsa geçici klasör sistemce temizlenir.
  }
});

// Her "kullanıcı" kendi çerezini taşıyan küçük bir istemcidir.
function createClient() {
  let cookie = "";
  return async function request(method, path, body, extraHeaders) {
    const response = await fetch(baseUrl + path, {
      method: method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "planstrator", Cookie: cookie, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
}

const ayse = createClient();
const mehmet = createClient();
const yabanci = createClient();

test("kayıt: geçersiz girdiler reddedilir", async () => {
  assert.equal((await ayse("POST", "/api/auth/register", { email: "gecersiz", name: "A", password: "12345678" })).status, 400);
  assert.equal((await ayse("POST", "/api/auth/register", { email: "ayse@example.com", name: "Ayşe", password: "kisa" })).status, 400);
});

test("kayıt, oturum ve çıkış", async () => {
  const registered = await ayse("POST", "/api/auth/register", { email: "Ayse@Example.com", name: "Ayşe", password: "gizli-parola-1" });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.email, "ayse@example.com"); // küçük harfe çevrildi
  assert.equal(registered.body.user.password_hash, undefined);   // parola özeti asla dönmez

  assert.equal((await ayse("GET", "/api/auth/me")).body.user.name, "Ayşe");

  // Aynı e-posta ile ikinci kayıt olmaz.
  assert.equal((await yabanci("POST", "/api/auth/register", { email: "ayse@example.com", name: "X", password: "baska-parola-1" })).status, 409);

  await ayse("POST", "/api/auth/logout");
  assert.equal((await ayse("GET", "/api/auth/me")).body.user, null);
});

test("giriş: yanlış parola reddedilir, doğrusu kabul edilir", async () => {
  assert.equal((await ayse("POST", "/api/auth/login", { email: "ayse@example.com", password: "yanlis-parola" })).status, 401);
  assert.equal((await ayse("POST", "/api/auth/login", { email: "ayse@example.com", password: "gizli-parola-1" })).status, 200);
});

test("giriş yapmadan korumalı adreslere erişilemez", async () => {
  assert.equal((await yabanci("GET", "/api/sync")).status, 401);
  assert.equal((await yabanci("GET", "/api/boards")).status, 401);
});

test("özel başlık olmadan veri değiştiren istek reddedilir (CSRF önlemi)", async () => {
  const response = await ayse("POST", "/api/boards", { name: "Sızma" }, { "X-Requested-With": "" });
  assert.equal(response.status, 403);
});

test("yedekleme: veri tablolara yazılır ve aynen geri okunur", async () => {
  assert.equal((await ayse("GET", "/api/sync")).body.data, null); // henüz yedek yok

  const data = {
    version: 5,
    categories: [{ id: "cat-1", name: "İş", color: "#2563eb", icon: "💼" }],
    tasks: [
      { id: "t1", title: "Rapor yaz", status: "done", completed: true, categoryId: "cat-1", dueDate: "2026-10-13", tags: ["iş"], subtasks: [{ id: "s1", text: "Taslak", done: true }], order: 1, createdAt: "2026-10-10", completedAt: "2026-10-13" },
      { id: "t2", title: "Kategorisiz görev", status: "todo", tags: [], subtasks: [], order: 2 },
      { id: "t3", title: "'); DROP TABLE tasks; --", status: "todo", order: 3 }, // SQL injection denemesi
    ],
    pomodoroSessions: [{ id: "p1", type: "focus", taskId: "t1", date: "2026-10-13", startedAt: 1000, endedAt: 2000, minutes: 25 }],
    goals: [{ id: "g1", title: "Hedef", type: "numeric", targetValue: 10, currentValue: 4, unit: "adım" }],
    checklistTemplates: [{ id: "tpl1", name: "Liste", items: [{ id: "i1", text: "Madde" }] }],
    notes: [{ id: "n1", title: "Not", content: "İçerik" }],
    settings: { accentTheme: "blue" },
  };
  const saved = await ayse("PUT", "/api/sync", { data: data, whiteboard: [{ tool: "pen", color: "#000000", size: 2, points: [1, 2] }] });
  assert.equal(saved.status, 200);

  const loaded = (await ayse("GET", "/api/sync")).body;
  assert.equal(loaded.data.tasks.length, 3);
  assert.equal(loaded.data.tasks[0].title, "Rapor yaz");
  assert.deepEqual(loaded.data.tasks[0].tags, ["iş"]);
  assert.equal(loaded.data.tasks[0].subtasks[0].text, "Taslak");
  assert.equal(loaded.data.tasks[2].title, "'); DROP TABLE tasks; --"); // zararsız bir metin olarak saklandı
  assert.equal(loaded.data.categories[0].icon, "💼");
  assert.equal(loaded.data.goals[0].currentValue, 4);
  assert.equal(loaded.data.notes[0].title, "Not");       // tablosu olmayan bölüm de korunur
  assert.equal(loaded.data.settings.accentTheme, "blue");
  assert.equal(loaded.whiteboard.length, 1);
});

test("istatistik: JOIN ve GROUP BY ile kategori özeti", async () => {
  const stats = (await ayse("GET", "/api/stats")).body;
  const work = stats.byCategory.find((row) => row.category === "İş");
  assert.equal(work.total, 1);
  assert.equal(work.done, 1);
  assert.equal(stats.byCategory.find((row) => row.category === "Kategorisiz").total, 2);
  assert.equal(stats.focusByDay[0].minutes, 25);
});

test("bir kullanıcı başkasının yedeğini göremez", async () => {
  await mehmet("POST", "/api/auth/register", { email: "mehmet@example.com", name: "Mehmet", password: "baska-parola-2" });
  assert.equal((await mehmet("GET", "/api/sync")).body.data, null);
});

let boardId = 0;
let taskId = 0;

test("pano: oluşturma ve üye olmayana kapalı olması", async () => {
  const created = await ayse("POST", "/api/boards", { name: "İzmir gezisi" });
  assert.equal(created.status, 201);
  boardId = created.body.board.id;
  assert.equal(created.body.board.role, "owner");

  assert.equal((await mehmet("GET", `/api/boards/${boardId}`)).status, 404);
  assert.equal((await mehmet("POST", `/api/boards/${boardId}/tasks`, { title: "İzinsiz" })).status, 404);
});

test("davet: e-posta ile davet, kabul ve üyelik", async () => {
  assert.equal((await ayse("POST", `/api/boards/${boardId}/invites`, { email: "gecersiz" })).status, 400);
  assert.equal((await ayse("POST", `/api/boards/${boardId}/invites`, { email: "ayse@example.com" })).status, 400); // kendini davet

  const invited = await ayse("POST", `/api/boards/${boardId}/invites`, { email: "Mehmet@Example.com" });
  assert.equal(invited.status, 201);
  assert.equal(invited.body.invites[0].email, "mehmet@example.com");

  const inbox = (await mehmet("GET", "/api/boards")).body;
  assert.equal(inbox.boards.length, 0);
  assert.equal(inbox.invites[0].boardName, "İzmir gezisi");
  assert.equal(inbox.invites[0].invitedBy, "Ayşe");

  // Davet yalnızca gönderildiği kişi tarafından kabul edilebilir.
  assert.equal((await ayse("POST", `/api/invites/${inbox.invites[0].id}/accept`)).status, 404);
  assert.equal((await mehmet("POST", `/api/invites/${inbox.invites[0].id}/accept`)).status, 200);

  const detail = (await mehmet("GET", `/api/boards/${boardId}`)).body;
  assert.equal(detail.members.length, 2);
  assert.equal(detail.board.role, "member");
  // Üye, sahibe özel işlemleri yapamaz.
  assert.equal((await mehmet("POST", `/api/boards/${boardId}/invites`, { email: "baska@example.com" })).status, 403);
  assert.equal((await mehmet("DELETE", `/api/boards/${boardId}`)).status, 403);
});

test("ortak görevler: ekleme, atama, taşıma ve sıralama", async () => {
  const members = (await ayse("GET", `/api/boards/${boardId}`)).body.members;
  const mehmetId = members.find((member) => member.email === "mehmet@example.com").id;

  await ayse("POST", `/api/boards/${boardId}/tasks`, { title: "Otel ayırt" });
  await mehmet("POST", `/api/boards/${boardId}/tasks`, { title: "Bilet al", assigneeId: mehmetId, dueDate: "2026-11-01" });
  const added = await ayse("POST", `/api/boards/${boardId}/tasks`, { title: "Plan yap" });
  assert.deepEqual(added.body.tasks.map((task) => task.title), ["Otel ayırt", "Bilet al", "Plan yap"]);
  assert.equal(added.body.tasks[1].assigneeName, "Mehmet");

  // "Plan yap"ı en başa al.
  const lastId = added.body.tasks[2].id;
  const firstId = added.body.tasks[0].id;
  const reordered = await mehmet("PATCH", `/api/boards/${boardId}/tasks/${lastId}`, { beforeTaskId: firstId });
  assert.deepEqual(reordered.body.tasks.map((task) => task.title), ["Plan yap", "Otel ayırt", "Bilet al"]);

  // Durum değişikliği (sütun taşıma)
  taskId = firstId;
  const moved = await ayse("PATCH", `/api/boards/${boardId}/tasks/${taskId}`, { status: "done" });
  assert.equal(moved.body.tasks.find((task) => task.id === taskId).status, "done");

  // Pano dışından birine atama yapılamaz; geçersiz durum yok sayılır.
  assert.equal((await ayse("PATCH", `/api/boards/${boardId}/tasks/${taskId}`, { assigneeId: 99999 })).status, 400);
  const weird = await ayse("PATCH", `/api/boards/${boardId}/tasks/${taskId}`, { status: "uydurma" });
  assert.equal(weird.body.tasks.find((task) => task.id === taskId).status, "done");
});

test("üyelikten çıkan kişi panoyu artık göremez; pano silinince her şey silinir", async () => {
  const members = (await ayse("GET", `/api/boards/${boardId}`)).body.members;
  const mehmetId = members.find((member) => member.email === "mehmet@example.com").id;

  assert.equal((await mehmet("DELETE", `/api/boards/${boardId}/members/${mehmetId}`)).status, 200); // kendisi ayrıldı
  assert.equal((await mehmet("GET", `/api/boards/${boardId}`)).status, 404);

  assert.equal((await ayse("DELETE", `/api/boards/${boardId}`)).status, 200);
  assert.equal((await ayse("GET", `/api/boards/${boardId}`)).status, 404);
  assert.equal((await ayse("GET", "/api/boards")).body.boards.length, 0);
});

test("telefon uygulaması: oturum anahtarı yalnızca uygulamaya verilir ve çerezsiz çalışır", async () => {
  // Tarayıcı gibi giriş: yanıtta anahtar OLMAMALI (anahtar yalnızca çerezde durur).
  const web = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "planstrator" },
    body: JSON.stringify({ email: "ayse@example.com", password: "gizli-parola-1" }),
  });
  assert.equal((await web.json()).token, undefined);

  // Uygulama gibi giriş: yanıtta anahtar gelir.
  const app = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "planstrator", "X-Planstrator-Client": "native" },
    body: JSON.stringify({ email: "ayse@example.com", password: "gizli-parola-1" }),
  });
  const token = (await app.json()).token;
  assert.equal(typeof token, "string");

  // Çerez göndermeden, yalnızca anahtarla kimlik doğrulanır.
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await me.json()).user.email, "ayse@example.com");

  // Çıkış yapınca anahtar geçersiz olur.
  await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { "X-Requested-With": "planstrator", Authorization: `Bearer ${token}` } });
  const after = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await after.json()).user, null);
});

test("CORS: yalnızca telefon uygulamasının kaynağına izin verilir, çerez izni verilmez", async () => {
  const allowed = await fetch(`${baseUrl}/api/auth/me`, { method: "OPTIONS", headers: { Origin: "https://localhost", "Access-Control-Request-Method": "POST" } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://localhost");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), null);

  const other = await fetch(`${baseUrl}/api/auth/me`, { headers: { Origin: "https://kotu-site.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});

test("sunucu klasörü ve veritabanı dışarıdan indirilemez", async () => {
  assert.equal((await fetch(`${baseUrl}/server/schema.sql`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/server/data/planstrator.db`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/package.json`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/js/app.js`)).status, 200);
});

test("hesap silme: parola ister, hesabı ve ona bağlı her şeyi siler", async () => {
  const zeynep = createClient();
  const komsu = createClient();
  const register = (client, email, name) =>
    client("POST", "/api/auth/register", { email: email, name: name, password: "silinecek-parola-1" });

  const zeynepId = (await register(zeynep, "zeynep@example.com", "Zeynep")).body.user.id;
  await register(komsu, "komsu@example.com", "Komşu");

  // Zeynep'in bir yedeği, kendi panosu ve Komşu'nun panosunda bir görevi olsun.
  await zeynep("PUT", "/api/sync", { data: { tasks: [{ id: "t1", title: "Yedekteki görev" }] }, whiteboard: null });
  await zeynep("POST", "/api/boards", { name: "Zeynep'in panosu" });
  const komsuBoard = (await komsu("POST", "/api/boards", { name: "Komşunun panosu" })).body;
  const boardId = komsuBoard.board ? komsuBoard.board.id : komsuBoard.id;
  const invite = await komsu("POST", `/api/boards/${boardId}/invites`, { email: "zeynep@example.com" });
  assert.equal(invite.status, 201);
  const invites = (await zeynep("GET", "/api/boards")).body.invites;
  await zeynep("POST", `/api/invites/${invites[0].id}/accept`);
  await zeynep("POST", `/api/boards/${boardId}/tasks`, { title: "Zeynep'in eklediği görev" });

  // Giriş yapmadan ya da yanlış parolayla silinemez.
  assert.equal((await yabanci("DELETE", "/api/auth/account", { password: "silinecek-parola-1" })).status, 401);
  assert.equal((await zeynep("DELETE", "/api/auth/account", { password: "yanlis-parola" })).status, 403);
  assert.equal((await zeynep("GET", "/api/auth/me")).body.user.email, "zeynep@example.com");

  assert.equal((await zeynep("DELETE", "/api/auth/account", { password: "silinecek-parola-1" })).status, 200);

  // Oturum kapandı ve aynı bilgilerle artık giriş yapılamıyor.
  assert.equal((await zeynep("GET", "/api/auth/me")).body.user, null);
  assert.equal((await zeynep("POST", "/api/auth/login", { email: "zeynep@example.com", password: "silinecek-parola-1" })).status, 401);

  // Veritabanında hiçbir izi kalmadı.
  const { query } = await import("../server/db.js");
  for (const table of ["sessions", "tasks", "user_extras", "board_members"]) {
    assert.equal((await query(`SELECT 1 FROM ${table} WHERE user_id = ?`, [zeynepId])).length, 0, table);
  }
  assert.equal((await query("SELECT 1 FROM boards WHERE owner_id = ?", [zeynepId])).length, 0);

  // Komşu'nun panosu duruyor; Zeynep'in görevi kaldı ama artık ona bağlı değil.
  const board = (await komsu("GET", `/api/boards/${boardId}`)).body;
  assert.equal(board.tasks.length, 1);
  assert.equal(board.members.some((member) => member.email === "zeynep@example.com"), false);
  assert.equal((await query("SELECT created_by FROM board_tasks WHERE board_id = ?", [boardId]))[0].created_by, null);
});

test("gizlilik politikası sayfası giriş yapmadan açılır", async () => {
  const response = await fetch(`${baseUrl}/privacy.html`);
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes("hesap-silme"));
});

test("yönetici paneli: yalnızca ADMIN_EMAIL hesabı kullanıcıları görebilir ve silebilir", async () => {
  process.env.ADMIN_EMAIL = "yonetici@example.com";
  const yonetici = createClient();
  const siradan = createClient();
  const adminUser = (await yonetici("POST", "/api/auth/register", { email: "yonetici@example.com", name: "Yönetici", password: "yonetici-parola-1" })).body.user;
  const normalUser = (await siradan("POST", "/api/auth/register", { email: "siradan@example.com", name: "Sıradan", password: "siradan-parola-1" })).body.user;
  assert.equal(adminUser.isAdmin, true);
  assert.equal(normalUser.isAdmin, false);

  // Giriş yapmamış ya da yönetici olmayan biri listeyi alamaz, kimseyi silemez.
  assert.equal((await yabanci("GET", "/api/admin/users")).status, 401);
  assert.equal((await siradan("GET", "/api/admin/users")).status, 403);
  assert.equal((await siradan("DELETE", `/api/admin/users/${adminUser.id}`)).status, 403);

  const list = await yonetici("GET", "/api/admin/users");
  assert.equal(list.status, 200);
  const row = list.body.users.find((user) => user.email === "siradan@example.com");
  assert.equal(row.name, "Sıradan");
  assert.ok(row.createdAt > 0 && row.lastSeenAt > 0);
  assert.equal(JSON.stringify(list.body).includes("password"), false); // parola özeti asla dönmez

  // Yönetici kendini buradan silemez; olmayan kullanıcı 404 verir.
  assert.equal((await yonetici("DELETE", `/api/admin/users/${adminUser.id}`)).status, 400);
  assert.equal((await yonetici("DELETE", "/api/admin/users/999999")).status, 404);

  assert.equal((await yonetici("DELETE", `/api/admin/users/${normalUser.id}`)).status, 200);
  assert.equal((await siradan("GET", "/api/auth/me")).body.user, null); // oturumu da kapandı
  assert.equal((await yonetici("GET", "/api/admin/users")).body.users.some((user) => user.id === normalUser.id), false);

  // Ayar kaldırılınca aynı hesap artık yönetici değildir.
  delete process.env.ADMIN_EMAIL;
  assert.equal((await yonetici("GET", "/api/admin/users")).status, 403);
});
