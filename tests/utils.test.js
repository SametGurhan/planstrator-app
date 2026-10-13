// ==========================================================
// tests/utils.test.js — Yardımcı fonksiyonların testleri
// Çalıştırmak için proje klasöründe:  npm test
//
// Her test üç adımdır: bir girdi hazırla, fonksiyonu çağır, sonucu beklenenle karşılaştır.
// assert.equal(gerçek, beklenen) eşit değilse testi başarısız sayar.
// ==========================================================

import "./setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toDateKey, parseDateKey, isDateKey, addDays, daysBetween, startOfWeek, startOfMonth, addMonths,
  getNextRecurrence, timeToMinutes, minutesToTime, formatMinutes, percent, parseTags,
} from "../js/utils.js";

test("tarih metne ve geri çevrilince aynı kalır (gün kayması yok)", () => {
  const date = new Date(2026, 0, 5, 23, 59); // 5 Ocak 2026, gece yarısına bir dakika kala
  assert.equal(toDateKey(date), "2026-01-05");
  assert.equal(toDateKey(parseDateKey("2026-01-05")), "2026-01-05");
});

test("isDateKey yalnızca YYYY-AA-GG biçimini kabul eder", () => {
  assert.equal(isDateKey("2026-10-13"), true);
  assert.equal(isDateKey("13.10.2026"), false);
  assert.equal(isDateKey(""), false);
  assert.equal(isDateKey(null), false);
});

test("addDays ay ve yıl sınırlarını doğru geçer", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28"); // 2026 artık yıl değil
  assert.equal(addDays("2028-03-01", -1), "2028-02-29"); // 2028 artık yıl
});

test("daysBetween iki tarih arasındaki gün sayısını verir", () => {
  assert.equal(daysBetween("2026-10-10", "2026-10-13"), 3);
  assert.equal(daysBetween("2026-10-13", "2026-10-10"), -3);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2); // yaz saati geçişi haftası
});

test("startOfWeek haftayı pazartesiden başlatır", () => {
  assert.equal(startOfWeek("2026-10-13"), "2026-10-12"); // salı -> pazartesi
  assert.equal(startOfWeek("2026-10-12"), "2026-10-12"); // pazartesi kendisi
  assert.equal(startOfWeek("2026-10-18"), "2026-10-12"); // pazar önceki pazartesiye gider
});

test("startOfMonth ve addMonths", () => {
  assert.equal(startOfMonth("2026-10-13"), "2026-10-01");
  assert.equal(addMonths("2026-10-13", 1), "2026-11-01");
  assert.equal(addMonths("2026-12-20", 1), "2027-01-01");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-01");
});

test("tekrar: her gün ve her hafta", () => {
  assert.equal(getNextRecurrence("2026-10-13", "daily", "2026-10-13"), "2026-10-14");
  assert.equal(getNextRecurrence("2026-10-13", "weekly", "2026-10-13"), "2026-10-20");
});

test("tekrar: hafta içi kuralı hafta sonunu atlar", () => {
  // 16 Ekim 2026 cuma -> sıradaki pazartesi 19 Ekim
  assert.equal(getNextRecurrence("2026-10-16", "weekdays", "2026-10-16"), "2026-10-19");
});

test("tekrar: her ay kuralı kısa ayda ayın son gününe düşer", () => {
  assert.equal(getNextRecurrence("2026-01-31", "monthly", "2026-01-31"), "2026-02-28");
  assert.equal(getNextRecurrence("2026-10-13", "monthly", "2026-10-13"), "2026-11-13");
});

test("tekrar: çok gecikmiş görevde geçmiş tekrarlar atlanır", () => {
  // Görev 1 Ekim'deydi, bugün 13 Ekim: sıradaki tekrar bugünden önce olamaz.
  assert.equal(getNextRecurrence("2026-10-01", "daily", "2026-10-13"), "2026-10-13");
  assert.equal(getNextRecurrence("2026-09-01", "weekly", "2026-10-13"), "2026-10-13");
});

test("saat ile dakika arasında dönüşüm", () => {
  assert.equal(timeToMinutes("09:30"), 570);
  assert.equal(minutesToTime(570), "09:30");
  assert.equal(minutesToTime(0), "00:00");
});

test("formatMinutes süreyi okunur yazar", () => {
  assert.equal(formatMinutes(25), "25 dk");
  assert.equal(formatMinutes(60), "1 sa");
  assert.equal(formatMinutes(95), "1 sa 35 dk");
});

test("percent sıfıra bölmez ve 100'ü geçmez", () => {
  assert.equal(percent(1, 4), 25);
  assert.equal(percent(3, 0), 0);
  assert.equal(percent(9, 4), 100);
});

test("parseTags temizler, küçültür ve tekrarları atar", () => {
  assert.deepEqual(parseTags("JavaScript, #ödev,  ödev, "), ["javascript", "ödev"]);
  assert.deepEqual(parseTags(""), []);
});
