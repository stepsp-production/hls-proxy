import express from "express";
import fetch, { Headers } from "node-fetch";
import https from "https";

const app = express();

// أصل HLS (سيرفرك). أبقه https لأنك قلت VLC لا يعمل إلا https:
const ORIGIN = process.env.ORIGIN || "https://46.152.153.249";

// وكيل HTTPS يسمح بشهادة غير موثوقة upstream (حل مشكلتك مع الـIP)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// CORS headers
function addCors(res) {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Origin, Accept, Content-Type, Referer, User-Agent",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type",
    "Timing-Allow-Origin": "*",
  });
}

app.options("*", (req, res) => { addCors(res); res.status(204).end(); });

// وسيط لمسارات HLS فقط (أماناً)
app.get("/hls/*", async (req, res) => {
  addCors(res);

  // عنوان upstream المطلوب (يحافظ على نفس /hls/...):
  const upstreamUrl = ORIGIN + req.originalUrl; // مثال: https://46.152.153.249/hls/live/playlist.m3u8

  try {
    // لا نسمح بالضغط كي نقدر نعيد كتابة m3u8 إذا لزم
    const reqHeaders = new Headers();
    if (req.headers["range"]) reqHeaders.set("Range", req.headers["range"]);
    if (req.headers["user-agent"]) reqHeaders.set("User-Agent", req.headers["user-agent"]);
    reqHeaders.set("Accept-Encoding", "");

    const up = await fetch(upstreamUrl, {
      method: "GET",
      headers: reqHeaders,
      agent: httpsAgent, // هنا نتجاوز تحقق الشهادة
      redirect: "follow",
    });

    // حالة بسيطة: إن فشل upstream، أبلغ المستخدم
    if (!up.ok) {
      const text = await up.text().catch(() => "");
      return res.status(up.status).type("text/plain").send(
        `Upstream returned ${up.status}\nURL: ${upstreamUrl}\n${text}`
      );
    }

    // تحديد النوع
    const p = req.path.toLowerCase();
    const isM3U8 = p.endsWith(".m3u8");
    const isTS   = p.endsWith(".ts") || p.endsWith(".m4s") || p.endsWith(".mp4") || p.endsWith(".aac") || p.endsWith(".m4a") || p.endsWith(".m4v");

    // كاش مناسب
    res.set("Cache-Control",
      isM3U8 ? "public, max-age=3, must-revalidate" :
      (isTS ? "public, max-age=60, immutable" : "no-store")
    );

    // Content-Type
    if (isM3U8) res.type("application/vnd.apple.mpegurl; charset=utf-8");
    else if (p.endsWith(".ts")) res.type("video/mp2t");
    else if (p.endsWith(".mp4")) res.type("video/mp4");
    else if (p.endsWith(".aac")) res.type("audio/aac");

    if (isM3U8) {
      // إعادة الكتابة:
      // 1) أي روابط مطلقة نحو الـIP تتحول إلى وسيطك (https://your-app/..)
      // 2) الروابط النسبية تُحوّل إلى مطلقة عبر وسيطك
      const text = await up.text();

      const scheme = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.headers["x-forwarded-host"] || req.get("host");
      const selfBase = `${scheme}://${host}`;

      // مسار الدليل الحالي للقائمة
      const baseDir = req.originalUrl.substring(0, req.originalUrl.lastIndexOf("/") + 1);

      // استبدال مطلق للـIP بالدومين (إن وُجد)
      let rewritten = text.replaceAll("https://46.152.153.249", selfBase);

      // تحويل الأسطر غير التعليقات (الروابط النسبية) إلى مطلقة عبر الوسيط
      rewritten = rewritten.split("\n").map(line => {
        const t = line.trim();
        if (!t || t.startsWith("#")) return line;
        if (/^https?:\/\//i.test(t)) return line; // صار مطلقًا بالفعل
        // نسبي -> مطلق عبر وسيطك
        return `${selfBase}${baseDir}${t}`;
      }).join("\n");

      return res.send(rewritten);
    }

    // لغير m3u8 (القطع)، مرّر الستريم كما هو
    res.status(up.status);
    up.body.pipe(res);
  } catch (e) {
    res.status(502).type("text/plain").send(`Upstream fetch failed: ${e?.message || e}\nTried: ${upstreamUrl}`);
  }
});

// صحّة الخدمة
app.get("/", (req, res) => {
  res.type("text/plain").send("HLS Proxy is running. Use /hls/... paths.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HLS proxy running on :${PORT}`));
