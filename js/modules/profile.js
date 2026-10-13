// ==========================================================
// profile.js — Kişiselleştirme: kullanıcının adı, üst köşedeki simge, ilk açılış karşılaması
//
// Ad iki yerden gelebilir:
//   1) Hesap açılmışsa hesaptaki ad (sunucudan)
//   2) Yoksa bu cihazdaki ayarlara yazılan ad (Ayarlar → Profil)
// İkisi de yoksa uygulama adsız çalışır; selamlama "Günaydın" olarak kalır.
// ==========================================================

import { getSettings, updateSettings } from "../state.js";
import { getCurrentUser } from "./account.js";
import { icon, byId, clear, showToast } from "../utils.js";

let onChange = null; // ad değişince app.js'e haber vermek için

export function getDisplayName() {
  const user = getCurrentUser();
  if (user) return user.name;
  return getSettings().displayName;
}

// Selamlamada kullanmak için yalnızca ilk ad: "Samet Gürhan" -> "Samet"
export function getFirstName() {
  const first = getDisplayName().trim().split(" ")[0];
  if (first === "") return "";
  // Küçük harfle yazılmış olsa da baş harfi büyüt: "samet" -> "Samet"
  const letters = Array.from(first);
  return letters[0].toLocaleUpperCase("tr") + letters.slice(1).join("");
}

// Sağ üstteki yuvarlak simge: ad varsa baş harfi, yoksa genel bir kişi simgesi.
export function renderProfile() {
  const avatar = byId("avatarLink");
  const name = getDisplayName().trim();
  clear(avatar);

  if (name === "") {
    avatar.append(icon("user"));
    avatar.setAttribute("aria-label", "Hesabı aç");
  } else {
    // Array.from: emoji gibi birden çok parçadan oluşan harfleri bölmeden ilk karakteri alır.
    avatar.textContent = Array.from(name)[0].toLocaleUpperCase("tr");
    avatar.setAttribute("aria-label", `${name}: hesabı aç`);
  }

  // Ayarlar'daki ad kutusu: hesap varsa ad hesaptan gelir, kutu kilitlenir.
  const input = byId("profileName");
  const user = getCurrentUser();
  input.value = user ? user.name : getSettings().displayName;
  input.disabled = user !== null;
  byId("profileHint").textContent = user
    ? "Adın hesabından geliyor."
    : "Bu ad yalnızca bu cihazda saklanır ve selamlamada kullanılır.";
}

function saveName(value) {
  updateSettings({ displayName: value });
  renderProfile();
  if (onChange) onChange();
}

// options.isFirstRun: uygulama bu cihazda ilk kez mi açılıyor?
export function initProfile(options) {
  onChange = options.onChange;

  byId("profileName").addEventListener("change", (event) => {
    saveName(event.target.value);
    showToast("Adın kaydedildi.");
  });

  // İlk açılış karşılaması: adını sor (yazmak zorunlu değil).
  byId("welcomeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveName(byId("welcomeName").value);
    byId("welcomeDialog").close();
  });
  byId("welcomeSkip").addEventListener("click", () => byId("welcomeDialog").close());

  renderProfile();
  if (options.isFirstRun) byId("welcomeDialog").showModal();
}
