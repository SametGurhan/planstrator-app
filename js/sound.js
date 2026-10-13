// ==========================================================
// sound.js — Bildirim sesleri
// Ses dosyası kullanmıyoruz; tarayıcının ses üreticisi (Web Audio) ile notaları kendimiz çalıyoruz.
//
// ÖNEMLİ: Tarayıcılar, kullanıcı sayfaya hiç tıklamadan ses çalınmasını engeller.
// Bu yüzden ses sistemini (AudioContext) ilk tıklamada "açıyoruz" ve hep aynısını kullanıyoruz.
// ==========================================================

// Her ses bir nota listesidir.
//   frequency: notanın frekansı (Hz) — büyüdükçe ses incelir
//   start:     kaçıncı saniyede başlayacağı
//   duration:  kaç saniye süreceği
//   wave:      dalga biçimi — "sine" yumuşak, "square" keskin, "triangle" ikisinin arası
const SOUNDS = {
  chime: [
    { frequency: 880, start: 0, duration: 0.7, wave: "sine" },
    { frequency: 1175, start: 0.18, duration: 0.7, wave: "sine" },
    { frequency: 1568, start: 0.36, duration: 1.1, wave: "sine" },
  ],
  beep: [
    { frequency: 1000, start: 0, duration: 0.15, wave: "square" },
    { frequency: 1000, start: 0.25, duration: 0.15, wave: "square" },
    { frequency: 1000, start: 0.5, duration: 0.15, wave: "square" },
  ],
  melody: [
    { frequency: 523, start: 0, duration: 0.22, wave: "triangle" },
    { frequency: 659, start: 0.2, duration: 0.22, wave: "triangle" },
    { frequency: 784, start: 0.4, duration: 0.22, wave: "triangle" },
    { frequency: 1047, start: 0.6, duration: 0.6, wave: "triangle" },
  ],
  alarm: [
    { frequency: 880, start: 0, duration: 0.18, wave: "square" },
    { frequency: 660, start: 0.2, duration: 0.18, wave: "square" },
    { frequency: 880, start: 0.4, duration: 0.18, wave: "square" },
    { frequency: 660, start: 0.6, duration: 0.18, wave: "square" },
    { frequency: 880, start: 0.8, duration: 0.18, wave: "square" },
    { frequency: 660, start: 1.0, duration: 0.3, wave: "square" },
  ],
};

let audioContext = null; // tek bir ses sistemi; ilk ihtiyaçta oluşturulur

function getAudioContext() {
  if (audioContext === null) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null; // tarayıcı desteklemiyor
    audioContext = new AudioContextClass();
  }
  // Tarayıcı ses sistemini beklemeye almışsa uyandır.
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

// Kullanıcı sayfaya tıkladığında çağrılır; ses sistemini önceden hazırlar.
export function unlockAudio() {
  try {
    getAudioContext();
  } catch (error) {
    console.warn("Ses sistemi açılamadı:", error);
  }
}

// name: "chime" | "beep" | "melody" | "alarm"     volumePercent: 0-100
export function playSound(name, volumePercent) {
  try {
    const audio = getAudioContext();
    if (!audio) return;

    const notes = SOUNDS[name] || SOUNDS.chime;
    // Kare dalga kulağa daha yüksek gelir; biraz kısıyoruz.
    const peak = Math.max(0, Math.min(100, volumePercent)) / 100;
    if (peak === 0) return;
    const startTime = audio.currentTime + 0.05;

    for (const note of notes) {
      const oscillator = audio.createOscillator(); // sesi üreten parça
      const gain = audio.createGain();             // ses seviyesini ayarlayan parça
      const noteStart = startTime + note.start;
      const noteEnd = noteStart + note.duration;
      const level = note.wave === "square" ? peak * 0.35 : peak * 0.8;

      oscillator.type = note.wave;
      oscillator.frequency.value = note.frequency;

      // Sesi aniden açıp kapatmak "çıt" sesi yapar; hızlıca yükseltip yumuşakça söndürüyoruz.
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(level, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      oscillator.connect(gain);
      gain.connect(audio.destination); // hoparlöre bağla
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.05);
    }
  } catch (error) {
    console.warn("Ses çalınamadı:", error);
  }
}
