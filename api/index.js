// ==========================================================
// api/index.js — Vercel giriş noktası
//
// Vercel sürekli çalışan bir sunucu barındırmaz; "sunucusuz fonksiyon" çalıştırır:
// /api ile başlayan her istek geldiğinde bu dosyadaki uygulamayı çağırır.
// Express uygulamamızı olduğu gibi dışa aktarmamız yeterli.
// (Arayüz dosyalarını Vercel kendisi sunar; bkz. vercel.json)
// ==========================================================

import { createApp } from "../server/server.js";

export default createApp();
