// ==========================================================
// server/sync.js — Kişisel verinin buluta yedeklenmesi ve geri yüklenmesi
//
// Frontend tüm verisini tek bir nesne olarak gönderir. Sunucu bunu ayrıştırır:
//   görevler, kategoriler, Pomodoro oturumları, hedefler, şablonlar -> kendi tablolarına
//   geri kalan her şey (ayarlar, notlar, seyahatler, çizim...)      -> user_extras (JSON)
// Geri yüklerken tablolardan okuyup aynı nesneyi yeniden kurar.
// ==========================================================

import { Router } from "express";
import { query, queryOne, batch } from "./db.js";
import { requireAuth } from "./auth.js";
import { HttpError, cleanText, cleanNumber, cleanDate, oneOf, asArray } from "./helpers.js";

const MAX_ROWS = 5000;            // bir tabloya tek seferde yazılacak en fazla satır
const MAX_EXTRAS_LENGTH = 4_000_000; // karakter (yaklaşık 4 MB)

// Kendi tablosu olan bölümler; geri kalanlar "extras" olarak saklanır.
const TABLE_KEYS = ["tasks", "categories", "pomodoroSessions", "goals", "checklistTemplates"];

// Geçerli kayıt: nesne olmalı ve metin bir id'si bulunmalı.
function validRecords(list) {
  return asArray(list)
    .filter((item) => item !== null && typeof item === "object" && typeof item.id === "string" && item.id !== "")
    .slice(0, MAX_ROWS);
}

function nullableText(value, maxLength) {
  const text = cleanText(value, maxLength);
  return text === "" ? null : text;
}

function toJson(value) {
  return JSON.stringify(asArray(value)).slice(0, 100_000);
}

function fromJson(text) {
  try {
    return asArray(JSON.parse(text));
  } catch (error) {
    return [];
  }
}

// ---------------- KAYDETME ----------------

// Eklenecek satırların SQL metinleri. ? işaretlerinin yerine değerler ayrıca verilir.
const INSERT_CATEGORY = "INSERT OR REPLACE INTO categories (user_id, id, name, color, icon) VALUES (?, ?, ?, ?, ?)";
const INSERT_TASK = `
  INSERT OR REPLACE INTO tasks (user_id, id, title, description, status, priority, category_id, due_date, start_time,
    estimated_minutes, spent_minutes, recurrence, sort_order, tags, subtasks, created_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const INSERT_SESSION = `
  INSERT OR REPLACE INTO pomodoro_sessions (user_id, id, type, task_id, date, started_at, ended_at, minutes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const INSERT_GOAL = `
  INSERT OR REPLACE INTO goals (user_id, id, title, description, type, target_value, current_value, unit,
    start_date, end_date, category_id, created_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const INSERT_TEMPLATE = `
  INSERT OR REPLACE INTO checklist_templates (user_id, id, name, description, category_id, tags, items)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

async function saveUserData(userId, data, whiteboard) {
  // Tablolara girmeyen her şey tek bir JSON metni olur.
  const extras = { whiteboard: asArray(whiteboard) };
  for (const key in data) {
    if (!TABLE_KEYS.includes(key)) extras[key] = data[key];
  }
  const extrasText = JSON.stringify(extras);
  if (extrasText.length > MAX_EXTRAS_LENGTH) throw new HttpError(413, "Veri çok büyük; yedeklenemedi.");

  const updatedAt = Date.now();

  // Tüm sorguları bir listede topluyoruz: [sql, değerler]. Hepsi TEK işlemde çalışır;
  // yarıda hata olursa hiçbiri uygulanmaz ve eski yedek aynen kalır.
  const statements = [];

  for (const table of ["categories", "tasks", "pomodoro_sessions", "goals", "checklist_templates"]) {
    // Tablo adı kullanıcıdan gelmiyor, yukarıdaki sabit listeden geliyor; bu yüzden güvenli.
    statements.push([`DELETE FROM ${table} WHERE user_id = ?`, [userId]]);
  }

  for (const item of validRecords(data.categories)) {
    statements.push([INSERT_CATEGORY, [userId, item.id, cleanText(item.name, 40), cleanText(item.color, 9), cleanText(item.icon, 16)]]);
  }
  for (const item of validRecords(data.tasks)) {
    statements.push([INSERT_TASK, [
      userId, item.id, cleanText(item.title, 120), cleanText(item.description, 1000),
      oneOf(item.status, ["todo", "doing", "done"], item.completed === true ? "done" : "todo"),
      oneOf(item.priority, ["low", "normal", "high", "urgent"], "normal"),
      nullableText(item.categoryId, 64), cleanDate(item.dueDate), cleanText(item.startTime, 5),
      Math.round(cleanNumber(item.estimatedMinutes, 0)), Math.round(cleanNumber(item.spentMinutes, 0)),
      oneOf(item.recurrence, ["none", "daily", "weekdays", "weekly", "monthly"], "none"),
      cleanNumber(item.order, 0), toJson(item.tags), toJson(item.subtasks),
      cleanDate(item.createdAt), cleanDate(item.completedAt) || null,
    ]]);
  }
  for (const item of validRecords(data.pomodoroSessions)) {
    statements.push([INSERT_SESSION, [
      userId, item.id, oneOf(item.type, ["focus", "shortBreak", "longBreak", "custom"], "focus"),
      nullableText(item.taskId, 64), cleanDate(item.date),
      Math.round(cleanNumber(item.startedAt, 0)), Math.round(cleanNumber(item.endedAt, 0)),
      Math.round(cleanNumber(item.minutes, 0)),
    ]]);
  }
  for (const item of validRecords(data.goals)) {
    statements.push([INSERT_GOAL, [
      userId, item.id, cleanText(item.title, 120), cleanText(item.description, 300),
      oneOf(item.type, ["numeric", "simple"], "numeric"),
      cleanNumber(item.targetValue, 1), cleanNumber(item.currentValue, 0), cleanText(item.unit, 20),
      cleanDate(item.startDate), cleanDate(item.endDate), nullableText(item.categoryId, 64),
      cleanDate(item.createdAt), cleanDate(item.completedAt) || null,
    ]]);
  }
  for (const item of validRecords(data.checklistTemplates)) {
    statements.push([INSERT_TEMPLATE, [
      userId, item.id, cleanText(item.name, 40), cleanText(item.description, 200),
      nullableText(item.categoryId, 64), toJson(item.tags), toJson(item.items),
    ]]);
  }

  statements.push(["INSERT OR REPLACE INTO user_extras (user_id, data, updated_at) VALUES (?, ?, ?)", [userId, extrasText, updatedAt]]);

  await batch(statements);
  return updatedAt;
}

// ---------------- OKUMA ----------------

async function loadUserData(userId) {
  const extrasRow = await queryOne("SELECT data, updated_at FROM user_extras WHERE user_id = ?", [userId]);
  if (!extrasRow) return null; // bu kullanıcının henüz yedeği yok

  let extras = {};
  try {
    extras = JSON.parse(extrasRow.data);
  } catch (error) {
    extras = {};
  }
  const whiteboard = asArray(extras.whiteboard);
  delete extras.whiteboard;

  // Veritabanı sütun adları (snake_case) frontend alan adlarına (camelCase) çevrilir.
  const taskRows = await query("SELECT * FROM tasks WHERE user_id = ? ORDER BY sort_order", [userId]);
  const tasks = taskRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    completed: row.status === "done",
    priority: row.priority,
    categoryId: row.category_id,
    dueDate: row.due_date,
    startTime: row.start_time,
    estimatedMinutes: row.estimated_minutes,
    spentMinutes: row.spent_minutes,
    recurrence: row.recurrence,
    order: row.sort_order,
    tags: fromJson(row.tags),
    subtasks: fromJson(row.subtasks),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));

  const categoryRows = await query("SELECT id, name, color, icon FROM categories WHERE user_id = ?", [userId]);
  const categories = categoryRows
    .map((row) => ({ id: row.id, name: row.name, color: row.color, icon: row.icon }));

  const sessionRows = await query("SELECT * FROM pomodoro_sessions WHERE user_id = ? ORDER BY ended_at", [userId]);
  const pomodoroSessions = sessionRows.map((row) => ({
    id: row.id,
    type: row.type,
    taskId: row.task_id,
    date: row.date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    minutes: row.minutes,
  }));

  const goalRows = await query("SELECT * FROM goals WHERE user_id = ?", [userId]);
  const goals = goalRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    targetValue: row.target_value,
    currentValue: row.current_value,
    unit: row.unit,
    startDate: row.start_date,
    endDate: row.end_date,
    categoryId: row.category_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));

  const templateRows = await query("SELECT * FROM checklist_templates WHERE user_id = ?", [userId]);
  const checklistTemplates = templateRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    categoryId: row.category_id,
    tags: fromJson(row.tags),
    items: fromJson(row.items),
  }));

  return {
    updatedAt: extrasRow.updated_at,
    whiteboard: whiteboard,
    data: { ...extras, tasks, categories, pomodoroSessions, goals, checklistTemplates },
  };
}

// ---------------- ADRESLER ----------------

export const syncRouter = Router();
syncRouter.use(requireAuth); // buradaki tüm adresler giriş gerektirir

// Yedeği getir
syncRouter.get("/sync", async (request, response) => {
  const saved = await loadUserData(request.user.id);
  response.json(saved || { updatedAt: null, data: null, whiteboard: [] });
});

// Yedeği kaydet
syncRouter.put("/sync", async (request, response) => {
  const data = request.body.data;
  if (data === null || typeof data !== "object" || !Array.isArray(data.tasks)) {
    throw new HttpError(400, "Gönderilen veri geçerli değil.");
  }
  const updatedAt = await saveUserData(request.user.id, data, request.body.whiteboard);
  response.json({ updatedAt: updatedAt });
});

// Özet istatistikler: SQL'in JOIN ve GROUP BY gücünü gösterir.
syncRouter.get("/stats", async (request, response) => {
  // LEFT JOIN: görevi kategorisiyle eşleştirir; kategorisi olmayan görevler de sonuçta kalır.
  // GROUP BY: satırları kategoriye göre gruplar; COUNT ve SUM her grup için ayrı hesaplanır.
  const byCategory = await query(`
    SELECT COALESCE(categories.name, 'Kategorisiz') AS category,
           COUNT(*) AS total,
           SUM(CASE WHEN tasks.status = 'done' THEN 1 ELSE 0 END) AS done
    FROM tasks
    LEFT JOIN categories
      ON categories.user_id = tasks.user_id AND categories.id = tasks.category_id
    WHERE tasks.user_id = ?
    GROUP BY category
    ORDER BY total DESC
  `, [request.user.id]);

  const focusByDay = await query(`
    SELECT date, SUM(minutes) AS minutes, COUNT(*) AS sessions
    FROM pomodoro_sessions
    WHERE user_id = ? AND type IN ('focus', 'custom')
    GROUP BY date
    ORDER BY date DESC
    LIMIT 7
  `, [request.user.id]);

  response.json({ byCategory: byCategory, focusByDay: focusByDay });
});
