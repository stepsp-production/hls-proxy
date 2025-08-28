// server.js
import express from "express";
import fetch, { Headers } from "node-fetch";
import https from "https";

const app = express();

// أصل الـHLS (سيرفرك عبر الـIP). لا تغيّر https لأن الأصل لا يعمل إلا https.
const ORIGIN = process.env.ORIGIN || "https://46.152.153.249";

// وكيل HTTPS يسمح بشهادة غير موثّقة upstream (لأن الشهادة لا تطابق الـIP)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ===== CORS & helpers =====
function addCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range, Referer, User-Agent");
  res.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type");
  res.set("Timing-Allow-Origin", "*");
}

app.options("*", (req, res) => { addCors(res); return res.status(204).end(); });

// ===== Proxy for HLS paths =====
app.get("/hls/*", async (req, res) => {
  addCors(res);

  // نفس المسار على الأصل
  const upstreamUrl = ORIGIN + req.originalUrl; // مثال: https://46.152.153.249/hls/live2/playlist.m3u8

  try {
    // نبني هيدرات الطلب للأصل
    const reqHeaders = new Headers();
    if (req.headers["range"])      reqHeaders.set("Range", req.headers["range"]);
    if (req.headers["user-agent"]) reqHeaders.set("User-Agent", req.headers["user-agent"]);
    else                           reqHeaders.set("User-Agent", "VLC/3.0.18 LibVLC/3.0.18 (like Mozilla)");
    reqHeaders.set("Accept-Encoding", ""); // منع الضغط لتسهيل إعادة الكتابة
    reqHeaders.set("Referer", ORIGIN);
    reqHeaders.set("Origin", ORIGIN);

    const up = await fetch(upstreamUrl, {
      method: "GET",
      headers: reqHeaders,
      agent: httpsAgent,            // تجاوز تحقق TLS في upstream
      redirect: "follow",
    });

    if (!up.ok) {
      const txt = await up.text().catch(()=> "");
      res.status(up.status);
      res.type("text/plain");
      return res.send(`Upstream returned ${up.status}\nURL: ${upstreamUrl}\n${txt}`);
    }

    // تمييز نوع الطلب حسب الامتداد
    const p = req.path.toLowerCase();
    const isM3U8 = p.endsWith(".m3u8");
    const isTS   = p.endsWith(".ts") || p.endsWith(".m4s") || p.endsWith(".mp4") || p.endsWith(".aac") || p.endsWith(".m4a") || p.endsWith(".m4v");

    // سياسة كاش مناسبة
    res.set("Cache-Control",
      isM3U8 ? "public, max-age=3, must-revalidate"
             : (isTS ? "public, max-age=60, immutable" : "no-store")
    );

    // نوع المحتوى + الحماية من sniff
    if (isM3U8) {
      res.type("application/vnd.apple.mpegurl; charset=utf-8");
      res.set("Content-Disposition", 'inline; filename="playlist.m3u8"');
      res.set("X-Content-Type-Options", "nosniff");

      // إعادة كتابة محتوى m3u8
      const text = await up.text();

      // عنوان ذاتي مطلق (https://your-app.onrender.com)
      const scheme = (req.headers["x-forwarded-proto"] || req.protocol || "https");
      const host   = (req.headers["x-forwarded-host"]  || req.get("host"));
      const selfBase = `${scheme}://${host}`;

      // دليل القائمة الحالي (/hls/live2/)
      const baseDir = req.originalUrl.substring(0, req.originalUrl.lastIndexOf("/") + 1);

      // 1) استبدال أي روابط مطلقة نحو IP إلى دوميننا
      // 2) تحويل الروابط النسبية إلى مطلقة عبر وسيطنا
      let rewritten = text.replaceAll("https://46.152.153.249", selfBase);
      rewritten = rewritten.split("\n").map(line => {
        const t = line.trim();
        if (!t || t.startsWith("#")) return line;
        if (/^https?:\/\//i.test(t)) return line; // مطلق
        // نسبي → مطلق عبر وسيطنا
        return `${selfBase}${baseDir}${t}`;
      }).join("\n");

      return res.send(rewritten);
    }

    // أنواع الفيديو/الصوت المقطعية
    if (isTS) {
      if (p.endsWith(".ts"))  res.type("video/mp2t");
      else if (p.endsWith(".mp4")) res.type("video/mp4");
      else if (p.endsWith(".aac")) res.type("audio/aac");
      res.set("X-Content-Type-Options", "nosniff");

      res.status(up.status);
      return up.body.pipe(res);
    }

    // أي شيء آخر – مرّره كما هو
    res.type(up.headers.get("content-type") || "application/octet-stream");
    res.status(up.status);
    return up.body.pipe(res);

  } catch (e) {
    res.status(502).type("text/plain").send(`Upstream fetch failed: ${e?.message || e}\nTried: ${upstreamUrl}`);
  }
});

app.get("/player", (req, res) => {
  const q = req.query.src || "/hls/live/playlist.m3u8";
  const host = req.get("host");
  const absSrc = q.startsWith("http") ? q : `https://${host}${q}`;

  // ✅ CSP تسمح بالـinline + worker + blob، وكل الاتصالات self
  res.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "media-src 'self' blob: data:",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "base-uri 'self'"
  ].join("; "));

  res.type("html").send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HLS Player</title>
<style>
  body{margin:0;background:#000;color:#fff;font-family:system-ui}
  .wrap{padding:16px;max-width:960px;margin:auto}
  video{width:100%;background:#000;border-radius:8px}
</style>
</head>
<body>
  <div class="wrap">
    <h3>قناة اختبار</h3>
    <video id="v" controls playsinline></video>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <script>
    const SRC = ${JSON.stringify(absSrc)};
    const v = document.getElementById('v');
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = SRC; v.play().catch(()=>{});
    } else if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker:true, lowLatencyMode:true });
      hls.loadSource(SRC);
      hls.attachMedia(v);
      v.play().catch(()=>{});
    } else {
      document.body.insertAdjacentHTML('beforeend','<p>متصفحك لا يدعم HLS</p>');
    }
  </script>
</body>
</html>`);
});

// صحة
app.get("/", (req, res) => {
  addCors(res);
  res.type("text/plain").send("HLS Proxy is running. Use /hls/... or /player?src=/hls/... paths.");
});

// استماع
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`HLS proxy running on :${PORT}`));

