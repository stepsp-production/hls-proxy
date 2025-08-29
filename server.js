// server.js
// -------------------------------
// HLS transparent proxy + playlist rewriter
// -------------------------------

import express from "express";
import fetch from "node-fetch";
import path from "path";

// غيّر هذا لو اختلف مسار الـ Worker عندك
const UPSTREAM_BASE = "https://races-player.it-f2c.workers.dev";

const app = express();

// CORS عام لكل الردود
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Range"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// أداة مساعدة: يحدّد النوع من الامتداد
function guessContentType(urlPath) {
  const ext = path.extname(urlPath).toLowerCase();
  if (ext === ".m3u8") return "application/vnd.apple.mpegurl";
  if (ext === ".mpd") return "application/dash+xml";
  if (ext === ".ts") return "video/mp2t";
  if (ext === ".m4s") return "video/iso.segment";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".aac") return "audio/aac";
  return "application/octet-stream";
}

// يعيد كتابة أسطر الـ m3u8 لتشير إلى هذا السيرفر بدل المصدر الأصلي
function rewriteM3U8(baseUpstreamUrl, bodyText) {
  const base = new URL(baseUpstreamUrl);
  const lines = bodyText.split(/\r?\n/).map((ln) => {
    // أسطر الميتاداتا تبقى كما هي
    if (!ln || ln.startsWith("#")) return ln;

    // حوّل المسارات النسبية إلى مطلقة على المصدر، ثم أعد كتابتها للبروكسي
    // 1) اصنع URL مطلق نحو الـ Upstream
    let targetAbs;
    try {
      targetAbs = new URL(ln, base).toString();
    } catch {
      return ln; // لو السطر مش URL
    }

    // 2) حوّله لمسار على بروكسي Render بنفس الهيكل بعد /hls/
    // مثال:
    //   upstream: https://races-player.../hls/live2/segment11902.ts
    //   proxy  : https://<render>/hls/live2/segment11902.ts
    const u = new URL(targetAbs);
    // نبحث عن أول ظهور لمسار /hls/ ونأخذ ما بعده
    const idx = u.pathname.indexOf("/hls/");
    if (idx === -1) return ln;

    const proxyPath = u.pathname.slice(idx); // يبدأ بـ /hls/...
    const rebuilt = `${PROXY_ORIGIN}${proxyPath}${u.search || ""}`;
    return rebuilt;
  });

  return lines.join("\n");
}

// نحتاج أصل السيرفر (لإعادة كتابة الـ m3u8). سنولّده ديناميكياً من الطلب.
function getProxyOrigin(req) {
  // على Render يكون عندك X-Forwarded-Proto/Host
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

// المسارات الأساسية للبروكسي: أي شيء تحت /hls/* يذهب إلى الـ Upstream بنفس المسار
app.get("/hls/*", async (req, res) => {
  try {
    const upstreamUrl = new URL(req.originalUrl.replace(/^\/+/, "/"), UPSTREAM_BASE).toString();

    // مرّر الـ Range إن وجد (مهم للقطع)
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    const upstreamResp = await fetch(upstreamUrl, { headers });

    // لو 404/502 وغيره، أعده كما هو
    if (!upstreamResp.ok && upstreamResp.status !== 206) {
      res.status(upstreamResp.status);
      upstreamResp.headers.forEach((v, k) => res.setHeader(k, v));
      // إحفظ CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(await upstreamResp.text());
    }

    const ct = guessContentType(upstreamUrl);
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");

    // تلميح cache مناسب
    if (ct.includes("mpegurl") || ct.includes("dash+xml")) {
      // قوائم: لا نخزن
      res.setHeader("Cache-Control", "no-store");
    } else {
      // القطع: اسمح بتخزين قصير
      res.setHeader("Cache-Control", "public, max-age=30, immutable");
    }

    // دعم 206 إن كان الرد جزئي
    if (upstreamResp.status === 206) {
      res.status(206);
      const cr = upstreamResp.headers.get("Content-Range");
      if (cr) res.setHeader("Content-Range", cr);
      const len = upstreamResp.headers.get("Content-Length");
      if (len) res.setHeader("Content-Length", len);
      res.setHeader("Accept-Ranges", "bytes");
    }

    // لو m3u8: أعد الكتابة
    if (ct === "application/vnd.apple.mpegurl") {
      const text = await upstreamResp.text();
      // أصل البروكسي الحالي
      global.PROXY_ORIGIN = getProxyOrigin(req);
      const rewritten = rewriteM3U8(upstreamUrl, text);
      return res.send(rewritten);
    }

    // غير ذلك: مرّر الستريم كما هو (مفيد للـ .ts/.m4s)
    return upstreamResp.body.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(502).send("Bad Gateway (proxy error)");
  }
});

// صفحة لاعب بسيطة اختيارية (لتجربة سريعاً) — افتح /player?src=/hls/live/playlist.m3u8
app.get("/player", (req, res) => {
  const src = req.query.src || "/hls/live/playlist.m3u8";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HLS Test Player</title>
<style>body{margin:0;background:#000;display:grid;place-items:center;height:100vh}video{width:90vw;max-width:1100px;height:auto;background:#000}</style>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
</head><body>
<video id="v" controls playsinline muted></video>
<script>
const src = ${JSON.stringify(src)};
const v = document.getElementById('v');
if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(src);
  hls.attachMedia(v);
  hls.on(Hls.Events.MANIFEST_PARSED, ()=> v.play().catch(()=>{}));
} else if (v.canPlayType('application/vnd.apple.mpegurl')) {
  v.src = src; v.play().catch(()=>{});
} else {
  document.body.innerHTML = '<p style="color:#fff">HLS not supported</p>';
}
</script>
</body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(html);
});

// صحّة الخدمة
app.get("/", (req, res) => {
  res.type("text/plain").send("HLS proxy is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});


