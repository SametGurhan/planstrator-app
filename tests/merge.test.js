// ==========================================================
// tests/merge.test.js — Eşitlemedeki birleştirme kurallarının (merge.js) testleri
// ==========================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { findChanges, hasChanges, mergeData, takeRemote } from "../js/merge.js";

const task = (id, title, completed = false) => ({ id: id, title: title, completed: completed });

test("değişiklik bulma: değişen, eklenen ve silinen kayıtların id'leri not edilir", () => {
  const before = { version: 6, tasks: [task("a", "A"), task("b", "B"), task("c", "C")], settings: { accentTheme: "blue" } };
  const after = { version: 6, tasks: [task("a", "A"), task("b", "B", true), task("d", "D")], settings: { accentTheme: "blue" } };
  const changes = findChanges(before, after, {});
  assert.deepEqual(changes.tasks.sort(), ["b", "c", "d"]);
  assert.equal(changes.settings, undefined); // ayarlar değişmedi
  assert.equal(hasChanges(changes), true);
  assert.equal(hasChanges({}), false);

  // Sonraki değişiklik öncekilere eklenir.
  const more = findChanges(after, { ...after, settings: { accentTheme: "green" } }, changes);
  assert.equal(more.settings, true);
  assert.deepEqual(more.tasks.sort(), ["b", "c", "d"]);
});

test("birleştirme: iki cihazda farklı kayıtlar değişince ikisi de korunur", () => {
  // Telefon "a"yı tamamladı ve sunucuya gönderdi; bilgisayar o arada yalnızca "b"yi tamamladı.
  const remote = { tasks: [task("a", "A", true), task("b", "B")] };
  const local = { tasks: [task("a", "A"), task("b", "B", true)] };
  const merged = mergeData(local, remote, { tasks: ["b"] });
  assert.equal(merged.tasks.find((item) => item.id === "a").completed, true);  // telefonunki ezilmedi
  assert.equal(merged.tasks.find((item) => item.id === "b").completed, true);  // bilgisayarınki de kaldı
});

test("birleştirme: silmeler iki yönde de geçerli, eklenenlerin hepsi kalır", () => {
  // Bu cihazda "x" silindi ve "pc" eklendi; sunucuda "y" silindi ve "tel" eklendi.
  const local = { notes: [task("y", "Y"), task("pc", "PC")] };
  const remote = { notes: [task("x", "X"), task("tel", "Tel")] };
  const ids = mergeData(local, remote, { notes: ["x", "pc"] }).notes.map((item) => item.id);
  assert.deepEqual(ids, ["tel", "pc"]);
});

test("birleştirme: bu cihazda dokunulmayan bölüm sunucudan, değişen bölüm buradan gelir", () => {
  const local = { tasks: [], settings: { accentTheme: "green" }, trips: [] };
  const remote = { tasks: [task("t", "T")], settings: { accentTheme: "blue" }, trips: [task("g", "Gezi")] };
  const merged = mergeData(local, remote, { settings: true });
  assert.equal(merged.settings.accentTheme, "green");
  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.trips.length, 1);
});

test("ilk bağlantıda (neyin değiştiği bilinmiyor) hiçbir kayıt kaybolmaz", () => {
  const local = { tasks: [task("ortak", "Bende"), task("pc", "PC")] };
  const remote = { tasks: [task("ortak", "Sunucuda"), task("tel", "Tel")] };
  const merged = mergeData(local, remote, null);
  assert.deepEqual(merged.tasks.map((item) => item.id), ["ortak", "tel", "pc"]);
  assert.equal(merged.tasks[0].title, "Bende");
});

test("çalışan Pomodoro sayacı başka cihazdan gelen veriyle durmaz", () => {
  const local = { tasks: [], timer: { status: "running", endsAt: 123 } };
  const remote = { tasks: [task("x", "Telefondan")], timer: null };
  assert.equal(takeRemote(local, remote).timer.status, "running");
  assert.equal(mergeData(local, remote, { tasks: [] }).timer.status, "running");
});
