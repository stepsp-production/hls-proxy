// server.js — CommonJS على Node 18+ (يوفّر fetch بشكل مدمج)

const express = require("express");
const morgan = require("morgan");
const compression = require("compression");
const cors = require("cors");
const path = require("path");

const app = express();

// إعدادات عامة
const PORT = process.env.PORT || 3000;

// المنبع الأصلي (Cloudflare Worker عندك) — يمكن تغييره من متغيرات البيئة في Render
const ORIGIN_BASE =
  process.env.ORIGIN_BASE || "https://races-player.it-f2c.workers.dev";

// ميدلويرات
app.use(morgan("tiny"));
app.use(compression());
app.use(cors());

// خدمة ملفات static من مجلد public
// تأكد أن لديك public/player.html و public/app.js
app.use(express.static(path.join(__dirname, "public")));

// فحص الصحة
app.get("/healthz", (_req, res) => res.send("ok"));

// أداة مساعدة: نسخ بعض الترويسات المفيدة من المنبع إلى الاستجابة
function copyHeaders(upRes, res) {
  const ct = upRes.headers.get("content-type");
  const cc = upRes.headers.get("cache-control");
  if (ct) res.setHeader("content-type", ct);
  if (cc) res.setHeader("cache-control", cc);
  // السماح بالكروس (لو احتجت خارج الدومين)
  res.setHeader("access-control-allow-origin", "*");
}

// أداة مساعدة: إعادة كتابة روابط .m3u8 لتبقى عبر البروكسي
function rewriteM3U8(bodyText, restPath) {
  // restPath مثال: "hls/live2/playlist.m3u8" -> base = "hls/live2/"
  const lastSlash = restPath.lastIndexOf("/");
  const base = lastSlash >= 0 ? restPath.slice(0, lastSlash + 1) : "";

  const lines = bodyText.split(/\r?\n/).map((line) => {
    // لا نغيّر أسطر التعليقات/التوجيهات
    if (!line || line.startsWith("#")) return line;
    // لو الرابط مطلق http(s) نتركه كما هو
    if (/^https?:\/\//i.test(line)) return line;
    // غير ذلك: اجعله يمر عبر بروكسي السيرفر
    // مثال: segment.ts -> /hls/hls/live2/segment.ts (مع الحفاظ على base)
    return `/hls/${base}${line}`.replace(/([^:]|^)\/{2,}/g, "$1/"); // تنظيف // الزائدة
  });

  return lines.join("\n");
}

// بروكسي HLS: أي طلب يبدأ بـ /hls/* يتم جلبه من ORIGIN_BASE
app.get("/hls/*", async (req, res) => {
  try {
    const rest = req.params[0]; // كل ما بعد /hls/
    const upstreamUrl = `${ORIGIN_BASE}/${rest}`;

    // تمرير UA بسيط (اختياري)
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        "user-agent": req.get("user-agent") || "hls-proxy",
      },
    });

    // الحالة + بعض الترويسات
    res.status(upstreamRes.status);
    copyHeaders(upstreamRes, res);

    // لو ملف M3U8: أعد الكتابة للروابط الداخلية حتى تظل عبر بروكسي السيرفر
    const isM3U8 =
      upstreamUrl.toLowerCase().includes(".m3u8") ||
      (upstreamRes.headers.get("content-type") || "")
        .toLowerCase()
        .includes("application/vnd.apple.mpegurl");

    if (isM3U8) {
      const text = await upstreamRes.text();
      const rewritten = rewriteM3U8(text, rest);
      res.setHeader("content-type", "application/vnd.apple.mpegurl");
      return res.send(rewritten);
    }

    // غير ذلك: مرّر البودي كما هو (TS/MP4/MPD/صور..)
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    return res.send(buf);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(502).send("Bad Gateway (proxy error)");
  }
});

// صفحة المشغّل (لو حاب تفتحها على /player)
app.get("/player", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "player.html"));
});

// خيار: اجعل الصفحة الرئيسية تذهب للمشغل
app.get("/", (_req, res) => res.redirect("/player"));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Origin base: ${ORIGIN_BASE}`);
});
