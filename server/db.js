// ==========================================================
// server/db.js — Veritabanı bağlantısı
//
// Veritabanı SQLite'tır ve iki yerde durabilir; kodun geri kalanı farkı bilmez:
//   - Bilgisayarında:  server/data/planstrator.db dosyası (hiçbir ayar gerekmez)
//   - İnternette:      Turso (barındırılan SQLite). Adres ve anahtar ORTAM DEĞİŞKENLERİNDEN
//                      okunur: TURSO_DATABASE_URL ve TURSO_AUTH_TOKEN
// Bu bilgiler asla koda ya da depoya yazılmaz; sunucunun ayarlarına girilir.
//
// Veritabanı başka bir bilgisayarda olabildiği için her sorgu zaman alır ve
// Promise döndürür; bu yüzden tüm sorgular "await" ile beklenir.
//
// ÖNEMLİ KURAL — parametreli sorgu:
//   YANLIŞ: query("SELECT * FROM users WHERE email = '" + email + "'")
//   DOĞRU:  query("SELECT * FROM users WHERE email = ?", [email])
// Değeri sorgu metnine yapıştırmak "SQL injection" açığına yol açar: kullanıcı
// e-posta yerine SQL kodu yazıp veritabanını okuyabilir ya da silebilir.
// ? işaretiyle verilen değerler asla kod olarak çalıştırılmaz.
// ==========================================================

import { createClient } from "@libsql/client";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Adres verilmemişse yerel dosyayı kullan.
let databaseUrl = process.env.TURSO_DATABASE_URL;
if (!databaseUrl) {
  const dataFolder = path.join(here, "data");
  mkdirSync(dataFolder, { recursive: true });
  databaseUrl = pathToFileURL(path.join(dataFolder, "planstrator.db")).href;
}

const client = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN, // yerel dosyada gerekmez
});

// Tabloları oluşturur (zaten varsa dokunmaz: CREATE TABLE IF NOT EXISTS).
// Yalnızca bir kez çalışır; sonraki çağrılar aynı Promise'i bekler.
// MIGRATION: Zaten var olan bir tabloya sonradan eklenen sütunlar.
// CREATE TABLE IF NOT EXISTS mevcut tabloyu değiştirmez; yeni sütun ALTER TABLE ile eklenir.
// Sütun zaten varsa veritabanı "duplicate column" hatası verir; onu yok sayıyoruz.
const MIGRATIONS = [
  "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
];

async function setUpTables() {
  // Yabancı anahtar kuralları Turso'da açıktır, yerel SQLite dosyasında ise varsayılan olarak
  // kapalıdır. Yerelde de açıyoruz ki bilgisayarında çalışan şey yayında da aynı davransın.
  await client.execute("PRAGMA foreign_keys = ON");
  await client.executeMultiple(readFileSync(path.join(here, "schema.sql"), "utf8"));
  for (const statement of MIGRATIONS) {
    try {
      await client.execute(statement);
    } catch (error) {
      if (!/duplicate column/i.test(String(error.message))) throw error;
    }
  }
}

let ready = null;
export function prepareDatabase() {
  if (ready === null) ready = setUpTables();
  return ready;
}

// Sonuç satırlarını düz nesnelere çevirir: { id: 1, name: "Ayşe" }
function toObjects(result) {
  return result.rows.map((row) => {
    const record = {};
    result.columns.forEach((column, index) => {
      record[column] = row[index];
    });
    return record;
  });
}

function toSummary(result) {
  return {
    lastId: Number(result.lastInsertRowid || 0), // INSERT ile eklenen satırın kimliği
    changes: result.rowsAffected,                // etkilenen satır sayısı
  };
}

// SELECT: tüm satırları dizi olarak döndürür.
export async function query(sql, args = []) {
  await prepareDatabase();
  return toObjects(await client.execute({ sql: sql, args: args }));
}

// SELECT: yalnızca ilk satırı döndürür (yoksa undefined).
export async function queryOne(sql, args = []) {
  const rows = await query(sql, args);
  return rows[0];
}

// INSERT / UPDATE / DELETE
export async function run(sql, args = []) {
  await prepareDatabase();
  return toSummary(await client.execute({ sql: sql, args: args }));
}

// TRANSACTION (işlem): birden çok sorguyu "ya hepsi ya hiçbiri" olarak çalıştırır.
// Ortada bir hata olursa hiçbiri uygulanmaz; veri yarım kalmaz.
// statements: [[sql, args], [sql, args], ...]
export async function batch(statements) {
  await prepareDatabase();
  const results = await client.batch(
    statements.map(([sql, args = []]) => ({ sql: sql, args: args })),
    "write",
  );
  return results.map(toSummary);
}
