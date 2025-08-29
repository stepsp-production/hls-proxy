// server.js
import express from "express";
import fetch from "node-fetch"; // إذا كنت على Node < 18
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

/** ===== CSP & CORS (للـNeocities والـHLS) ===== */
app.use((req, res, next) => {
  // CORS واسع للسماح للتشغيل عبر <video>/MediaSource
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Origin, X-Requested-With, Content-Type, Accept");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  // تمنع بعض مشاكل التحميل في المتصفحات
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  // CSP مع السماح بالـblob: للميديا والاتصال
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.dashjs.org https://www.youtube.com https://player.vimeo.com",
      "script-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.dashjs.org https://www.youtube.com https://player.vimeo.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "media-src 'self' blob: data:",
      "connect-src 'self' blob: data:",
      "frame-src 'self' https://www.youtube.com https://player.vimeo.com",
      "worker-src 'self' blob:"
    ].join("; ")
  );

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/** ===== ملفات ثابتة من public/ ===== */
app.use(express.static(path.join(__dirname, "public")));

/** صفحة المشغّل: GET /player */
app.get("/player", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "player.html"));
});

/** ====== بروكسي بسيط للـHLS (m3u8 + ts/m4s) ======
 * الفكرة: أنت تدخل /hls/... من الخارج، ونحن نعيد توجيهها إلى المصدر الحقيقي.
 * عدّل BASE_ORIGIN إلى مصدر القنوات الحقيقي عندك.
 */
const BASE_ORIGIN = process.env.HLS_BASE || "https://races-player.it-f2c.workers.dev";

// يعيد كتابة مسارات الـm3u8 لتشير إلى نفس السيرفر (على Render)
function rewriteManifest(content, reqBasePath) {
  const lines = content.split("\n").map((ln) => {
    // سطر قطعة/قائمة فرعية
    if (ln && !ln.startsWith("#")) {
      try {
        const u = new URL(ln, BASE_ORIGIN); // مسار مطلق للمصدر
        // نعيد كتابته ليمر عبر سيرفرنا: /hls/<…>
        const pathname = u.pathname.startsWith("/") ? u.pathname : `/${u.pathname}`;
        return reqBasePath + pathname; // مثال: /hls + /live2/segment123.ts
      } catch {
        // لو كان سطر نسبي غريب، نخليه كما هو
        return ln;
      }
    }
    return ln;
  });
  return lines.join("\n");
}

// كل شيء تحت /hls/* نعيد توجيهه للمصدر الحقيقي
app.get("/hls/*", async (req, res) => {
  try {
    // المسار بعد /hls
    const upstreamPath = req.path.replace(/^\/hls/, "");
    const upstreamURL = BASE_ORIGIN + upstreamPath + (req.url.includes("?") ? "?" + req.url.split("?")[1] : "");

    const r = await fetch(upstreamURL, {
      headers: {
        // دعم Range لملفات .ts
        Range: req.headers.range || "",
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        Accept: "*/*",
      },
    });

    // مرِّر كود الحالة كما هو
    res.status(r.status);

    // مرِّر بعض الترويسات المهمّة
    const contentType = r.headers.get("content-type") || "";
    if (contentType) res.setHeader("Content-Type", contentType);
    const acceptRanges = r.headers.get("accept-ranges");
    if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
    const contentRange = r.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);
    const contentLength = r.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    // m3u8: نعيد كتابة الروابط لتعود عبر /hls/ على نفس السيرفر
    if (contentType.includes("application/vnd.apple.mpegurl") || upstreamURL.endsWith(".m3u8")) {
      const text = await r.text();
      const rewritten = rewriteManifest(text, "/hls");
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      return res.send(rewritten);
    }

    // أي شيء آخر (ts/m4s/…): نعمل stream
    r.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(502).send("Bad Gateway (proxy error)");
  }
});

app.get("/", (_req, res) => res.send("HLS proxy is up. Try /player"));

app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
