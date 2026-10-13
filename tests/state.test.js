// ==========================================================
// tests/state.test.js — Veri katmanının (state.js + storage.js) testleri
// Çalıştırmak için proje klasöründe:  npm test
// ==========================================================

import "./setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initState, getTasks, getTaskById, addTask, updateTask, toggleTask, moveTask, deleteTask,
  validateTaskInput, getCategories, addCategory, deleteCategory, validateCategoryInput,
  getTemplateById, copyTemplateItems, createInstanceFromTemplate, toggleInstanceItem, getInstances,
  goalStore, habitStore, isHabitDone, toggleHabitEntry, deleteHabit, validateSettingsInput,
} from "../js/state.js";
import { todayKey, addDays } from "../js/utils.js";

const STORAGE_KEY = "planstrator.data";

function readSaved() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY));
}

test("ilk açılışta örnek veriler yüklenir ve kaydedilir", () => {
  localStorage.clear();
  assert.equal(initState(), "empty");
  assert.ok(getTasks().length > 0);
  assert.ok(getCategories().some((category) => category.name === "Seyahat"));
  assert.equal(readSaved().tasks.length, getTasks().length);
});

test("kullanıcının verisi varken örnek verilerle üzerine yazılmaz", () => {
  const before = getTasks().length;
  addTask({ title: "Kalıcı görev" });
  assert.equal(initState(), "ok"); // uygulamayı yeniden açmış gibi
  assert.equal(getTasks().length, before + 1);
});

test("addTask eksik alanları varsayılanlarla doldurur", () => {
  const task = addTask({ title: "  Yeni görev  " });
  assert.equal(task.title, "Yeni görev"); // baştaki ve sondaki boşluk temizlenir
  assert.equal(task.priority, "normal");
  assert.equal(task.status, "todo");
  assert.equal(task.completed, false);
  assert.deepEqual(task.tags, []);
  assert.deepEqual(task.subtasks, []);
});

test("validateTaskInput boş başlığı ve geçersiz süreyi yakalar", () => {
  assert.ok(validateTaskInput({ title: "   ", dueDate: "", estimatedMinutes: "" }).title);
  assert.ok(validateTaskInput({ title: "Tamam", dueDate: "", estimatedMinutes: "-5" }).estimatedMinutes);
  assert.ok(validateTaskInput({ title: "Tamam", dueDate: "", estimatedMinutes: "", recurrence: "daily" }).dueDate);
  assert.deepEqual(validateTaskInput({ title: "Tamam", dueDate: "2026-10-13", estimatedMinutes: "30" }), {});
});

test("toggleTask durum ve tamamlanma tarihini birlikte günceller", () => {
  const task = addTask({ title: "İşaretlenecek" });

  const done = toggleTask(task.id);
  assert.equal(done.completed, true);
  assert.equal(done.status, "done");
  assert.equal(done.completedAt, todayKey());

  const reopened = toggleTask(task.id);
  assert.equal(reopened.completed, false);
  assert.equal(reopened.status, "todo");
  assert.equal(reopened.completedAt, null);
});

test("durumu 'done' yapmak görevi tamamlanmış sayar", () => {
  const task = addTask({ title: "Panodan taşınacak" });
  moveTask(task.id, "doing", null);
  assert.equal(getTaskById(task.id).status, "doing");
  assert.equal(getTaskById(task.id).completed, false);

  moveTask(task.id, "done", null);
  assert.equal(getTaskById(task.id).completed, true);
});

test("moveTask kartı istenen kartın önüne yerleştirir", () => {
  const first = addTask({ title: "Sıra A", status: "doing" });
  const second = addTask({ title: "Sıra B", status: "doing" });
  const third = addTask({ title: "Sıra C", status: "doing" });

  moveTask(third.id, "doing", first.id); // C'yi A'nın önüne al

  const order = (id) => getTaskById(id).order;
  assert.ok(order(third.id) < order(first.id));
  assert.ok(order(first.id) < order(second.id));
});

test("tekrarlanan görev tamamlanınca sıradaki kopyası oluşur", () => {
  const today = todayKey();
  const task = addTask({ title: "Günlük tekrar", dueDate: today, recurrence: "daily", subtasks: [{ text: "Adım", done: true }] });
  const countBefore = getTasks().length;

  toggleTask(task.id);

  assert.equal(getTasks().length, countBefore + 1);
  assert.equal(getTaskById(task.id).recurrence, "none"); // tamamlanan artık tekrarlanmaz
  const next = getTasks().find((item) => item.title === "Günlük tekrar" && !item.completed);
  assert.equal(next.dueDate, addDays(today, 1));
  assert.equal(next.recurrence, "daily");
  assert.equal(next.subtasks[0].done, false); // alt görevler işaretsiz gelir

  // Yeniden açıp tekrar tamamlamak ikinci bir kopya üretmemeli.
  toggleTask(task.id);
  toggleTask(task.id);
  assert.equal(getTasks().length, countBefore + 1);
});

test("kategori silinince görevler silinmez, taşınır", () => {
  const source = addCategory({ name: "Geçici kategori", color: "#123456", icon: "" });
  const target = addCategory({ name: "Hedef kategori", color: "#654321", icon: "" });
  const task = addTask({ title: "Kategorili görev", categoryId: source.id });

  deleteCategory(source.id, target.id);

  assert.equal(getTaskById(task.id).categoryId, target.id);
  assert.equal(getCategories().some((category) => category.id === source.id), false);
});

test("aynı adda ikinci kategori eklenemez (büyük/küçük harf fark etmez)", () => {
  assert.ok(validateCategoryInput({ name: "seyahat" }, null).name);
  assert.deepEqual(validateCategoryInput({ name: "Yepyeni" }, null), {});
});

test("şablondan üretilen liste şablondan bağımsızdır", () => {
  const template = getTemplateById("tpl-shopping");
  const itemCount = template.items.length;

  const copy = copyTemplateItems("tpl-shopping");
  copy[0].text = "Değiştirildi";
  copy.pop();
  assert.equal(getTemplateById("tpl-shopping").items.length, itemCount);
  assert.notEqual(getTemplateById("tpl-shopping").items[0].text, "Değiştirildi");

  const instance = createInstanceFromTemplate("tpl-shopping", { name: "", date: todayKey() });
  toggleInstanceItem(instance.id, instance.items[0].id);
  const saved = getInstances().find((item) => item.id === instance.id);
  assert.equal(saved.items[0].done, true);
  assert.notEqual(saved.items[0].id, template.items[0].id); // kopyanın kimlikleri yeni
});

test("alışkanlık kaydı açılıp kapatılır; alışkanlık silinince kayıtları da gider", () => {
  const habit = habitStore.add({ title: "Test alışkanlığı", frequency: "daily" });
  const today = todayKey();

  toggleHabitEntry(habit.id, today);
  assert.equal(isHabitDone(habit.id, today), true);
  toggleHabitEntry(habit.id, today);
  assert.equal(isHabitDone(habit.id, today), false);

  toggleHabitEntry(habit.id, today);
  deleteHabit(habit.id);
  assert.equal(isHabitDone(habit.id, today), false);
  assert.equal(readSaved().habitEntries.some((entry) => entry.habitId === habit.id), false);
});

test("hedefe ulaşılınca tamamlanma tarihi yazılır, geri düşünce silinir", () => {
  const goal = goalStore.add({ title: "Üç kitap", type: "numeric", targetValue: 3, currentValue: 2 });
  assert.equal(goal.completedAt, null);
  assert.equal(goalStore.update(goal.id, { currentValue: 3 }).completedAt, todayKey());
  assert.equal(goalStore.update(goal.id, { currentValue: 1 }).completedAt, null);
});

test("ayar doğrulaması aralık dışı değerleri reddeder", () => {
  assert.equal(validateSettingsInput({ focusMinutes: "25" }).length, 0);
  assert.equal(validateSettingsInput({ focusMinutes: "0" }).length, 1);
  assert.equal(validateSettingsInput({ focusMinutes: "abc" }).length, 1);
});

test("silinen görev listeden çıkar", () => {
  const task = addTask({ title: "Silinecek" });
  deleteTask(task.id);
  assert.equal(getTaskById(task.id), undefined);
});

test("bozuk kayıt uygulamayı çökertmez; yedeği alınır", () => {
  localStorage.setItem(STORAGE_KEY, "{bozuk veri");
  assert.equal(initState(), "corrupt");
  assert.equal(localStorage.getItem("planstrator.data.backup"), "{bozuk veri");
  assert.ok(getTasks().length > 0); // örnek verilerle açıldı
});

test("eski sürüm (1) veri kaybolmadan en yeni sürüme taşınır", () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    tasks: [{ id: "eski-1", title: "Eski sürüm görevi", completed: true }],
  }));

  assert.equal(initState(), "ok");
  const task = getTaskById("eski-1");
  assert.equal(task.title, "Eski sürüm görevi");
  assert.equal(task.status, "done"); // yeni alanlar eski bilgiden türetildi
  assert.ok(getCategories().length > 0);
  assert.ok(getCategories().some((category) => category.id === "cat-travel"));

  updateTask("eski-1", { title: "Güncellendi" }); // bir değişiklik kaydı tetikler
  assert.equal(readSaved().version, 6);
});
