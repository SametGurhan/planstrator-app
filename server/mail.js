// ==========================================================
// server/mail.js — E-posta gönderme
//
// Mailler bir e-posta hesabı üzerinden SMTP ile gönderilir (varsayılan: Gmail).
// Hesap bilgileri ORTAM DEĞİŞKENLERİNDEN okunur, koda yazılmaz:
//   SMTP_USER  -> gönderen adres (ör. planstrator.app@gmail.com)
//   SMTP_PASS  -> o hesabın "uygulama parolası" (normal Gmail parolası DEĞİL)
// Bu ikisi tanımlı değilse e-posta özelliği kapalıdır: uygulama mail göndermez ve
// e-posta doğrulaması istemez (bilgisayarında denerken hiçbir ayar gerekmesin diye).
// ==========================================================

import nodemailer from "nodemailer";

const user = process.env.SMTP_USER;
// Google uygulama parolasını "abcd efgh ijkl mnop" biçiminde gösterir; boşlukları atıyoruz.
const pass = (process.env.SMTP_PASS || "").replace(/\s/g, "");

// Testler gerçek mail göndermez: MAIL_CAPTURE=1 ise mailler bu listeye yazılır.
const captureOnly = process.env.MAIL_CAPTURE === "1";
export const sentMessages = [];

export function isMailEnabled() {
  return captureOnly || Boolean(user && pass);
}

let transporter = null; // bağlantı ilk ihtiyaçta kurulur

function getTransporter() {
  if (transporter === null) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true, // şifreli bağlantı
      auth: { user: user, pass: pass },
    });
  }
  return transporter;
}

// message: { to, subject, text, html }
// Gönderildiyse true döner. Hata olursa uygulamayı durdurmaz; günlüğe yazar ve false döner.
export async function sendMail(message) {
  if (captureOnly) {
    sentMessages.push(message);
    return true;
  }
  if (!isMailEnabled()) return false;

  try {
    await getTransporter().sendMail({
      from: `"Planstrator" <${user}>`,
      to: message.to,
      subject: message.subject,
      text: message.text, // düz metin sürümü (HTML göstermeyen programlar için)
      html: message.html,
    });
    return true;
  } catch (error) {
    console.error("E-posta gönderilemedi:", error.message);
    return false;
  }
}

// Kullanıcıdan gelen metni (ad, pano adı) HTML maile koymadan önce zararsız hale getirir.
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Maillerdeki bağlantıların başına gelecek site adresi.
// İstekteki "Host" başlığına güvenmiyoruz: saldırgan onu değiştirip kullanıcıya sahte bir
// siteye giden doğrulama bağlantısı gönderebilirdi. Adres sunucunun kendi ayarından gelir.
export function getAppUrl(request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  // Vercel bu değişkeni kendiliğinden tanımlar (ör. planstrator-app.vercel.app).
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  // Bilgisayarında çalışırken
  return `${request.protocol}://${request.get("host")}`;
}

// Tüm mailler için ortak, sade bir HTML çerçevesi.
export function buildHtml(title, paragraphs, button) {
  const body = paragraphs.map((text) => `<p style="margin:0 0 14px;line-height:1.5">${text}</p>`).join("");
  const action = button
    ? `<p style="margin:22px 0"><a href="${button.url}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:600;display:inline-block">${button.label}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#666d82">Düğme çalışmazsa bu adresi tarayıcına yapıştır:<br>${button.url}</p>`
    : "";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1b1e2b">
    <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>${body}${action}
    <p style="margin:24px 0 0;font-size:12px;color:#8a90a3">Bu maili Planstrator gönderdi. Bu işlemi sen yapmadıysan maili yok sayabilirsin.</p>
  </div>`;
}
