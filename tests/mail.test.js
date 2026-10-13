// ==========================================================
// tests/mail.test.js — E-posta doğrulama ve davet maillerinin testleri
// Gerçek mail gönderilmez: MAIL_CAPTURE=1 iken mailler bir listeye yazılır ve
// testler o listeden okur (ör. doğrulama bağlantısını bulmak için).
// ==========================================================

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tempFolder = mkdtempSync(path.join(tmpdir(), "planstrator-mail-"));
process.env.TURSO_DATABASE_URL = pathToFileURL(path.join(tempFolder, "test.db")).href;
process.env.MAIL_CAPTURE = "1";
process.env.APP_URL = "https://ornek.test";

const { createApp } = await import("../server/server.js");
const { sentMessages } = await import("../server/mail.js");

let server = null;
let baseUrl = "";

before(async () => {
  await new Promise((resolve) => {
    server = createApp().listen(0, resolve);
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

function createClient() {
  let cookie = "";
  return async function request(method, url, body) {
    const response = await fetch(baseUrl + url, {
      method: method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "planstrator", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual", // yönlendirmeyi izleme; nereye gittiğine bakacağız
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const isJson = (response.headers.get("content-type") || "").includes("json");
    return { status: response.status, location: response.headers.get("location"), body: isJson ? await response.json() : null };
  };
}

// Bir adrese gönderilen son maildeki doğrulama bağlantısının yolunu bulur.
function findVerifyPath(email) {
  const mail = sentMessages.filter((message) => message.to === email && message.text.includes("/api/auth/verify")).pop();
  return mail.text.match(/https:\/\/ornek\.test(\/api\/auth\/verify\?token=[0-9a-f]+)/)[1];
}

const owner = createClient();
const friend = createClient();
let boardId = 0;

test("kayıt olunca doğrulama maili gider ve hesap doğrulanmamış başlar", async () => {
  const registered = await owner("POST", "/api/auth/register", { email: "sahip@example.com", name: "Sahip <b>", password: "gizli-parola-1" });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.emailVerified, false);

  const mail = sentMessages.find((message) => message.to === "sahip@example.com");
  assert.ok(mail.subject.includes("doğrula"));
  assert.ok(mail.text.includes("https://ornek.test/api/auth/verify?token=")); // adres istekten değil ayardan gelir
  assert.ok(mail.html.includes("Sahip &lt;b&gt;")); // ad HTML olarak çalışmaz
  assert.equal(mail.html.includes("<b>"), false);
});

test("doğrulanmamış hesap davet gönderemez", async () => {
  boardId = (await owner("POST", "/api/boards", { name: "Mail panosu" })).body.board.id;
  assert.equal((await owner("POST", `/api/boards/${boardId}/invites`, { email: "arkadas@example.com" })).status, 403);
});

test("geçersiz bağlantı reddedilir, geçerli bağlantı hesabı doğrular ve tek kullanımlıktır", async () => {
  const bad = await owner("GET", "/api/auth/verify?token=uydurma");
  assert.equal(bad.location, "/?verified=0#settings");

  const verifyPath = findVerifyPath("sahip@example.com");
  const good = await owner("GET", verifyPath);
  assert.equal(good.location, "/?verified=1#settings");
  assert.equal((await owner("GET", "/api/auth/me")).body.user.emailVerified, true);

  assert.equal((await owner("GET", verifyPath)).location, "/?verified=0#settings"); // ikinci kez çalışmaz
});

test("davet edilince arkadaşa mail gider; aynı davet ikinci kez mail göndermez", async () => {
  const before = sentMessages.length;
  assert.equal((await owner("POST", `/api/boards/${boardId}/invites`, { email: "arkadas@example.com" })).status, 201);
  assert.equal(sentMessages.length, before + 1);
  const mail = sentMessages[sentMessages.length - 1];
  assert.equal(mail.to, "arkadas@example.com");
  assert.ok(mail.subject.includes("Mail panosu"));

  await owner("POST", `/api/boards/${boardId}/invites`, { email: "arkadas@example.com" });
  assert.equal(sentMessages.length, before + 1);
});

test("davetli, adresini doğrulamadan daveti göremez ve kabul edemez", async () => {
  await friend("POST", "/api/auth/register", { email: "arkadas@example.com", name: "Arkadaş", password: "baska-parola-2" });
  assert.equal((await friend("GET", "/api/boards")).body.invites.length, 0);

  // Davetin kimliğini sahibin gördüğü listeden alıp doğrudan kabul etmeyi dene.
  const inviteId = (await owner("GET", `/api/boards/${boardId}`)).body.invites[0].id;
  assert.equal((await friend("POST", `/api/invites/${inviteId}/accept`)).status, 403);

  await friend("GET", findVerifyPath("arkadas@example.com"));
  const inbox = (await friend("GET", "/api/boards")).body;
  assert.equal(inbox.invites.length, 1);
  assert.equal((await friend("POST", `/api/invites/${inviteId}/accept`)).status, 200);
  assert.equal((await friend("GET", `/api/boards/${boardId}`)).body.members.length, 2);
});

test("yeniden gönderme: doğrulanmış hesap için reddedilir, sık istek sınırlanır", async () => {
  assert.equal((await owner("POST", "/api/auth/resend-verification")).status, 400);

  const fresh = createClient();
  await fresh("POST", "/api/auth/register", { email: "yeni@example.com", name: "Yeni", password: "ucuncu-parola-3" });
  const firstPath = findVerifyPath("yeni@example.com");
  assert.equal((await fresh("POST", "/api/auth/resend-verification")).status, 200);
  assert.equal((await fresh("POST", "/api/auth/resend-verification")).status, 429); // bir dakika dolmadan

  // Yeni bağlantı gönderilince eskisi geçersiz olur.
  assert.equal((await fresh("GET", firstPath)).location, "/?verified=0#settings");
  assert.equal((await fresh("GET", findVerifyPath("yeni@example.com"))).location, "/?verified=1#settings");
});
