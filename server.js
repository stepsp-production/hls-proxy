// server.js
import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// عدّل هذا لو تغيّر دومين الـ Worker
const UPSTREAM_BASE = "https://races-player.it-f2c.workers.dev";

const app = express();

// CORS عام
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

// تقديم ملفات public/ كستاتيك (player.html + app.js)
app.use(express.static(path.join(__dirname, "public"), {
  // منع أي تعديلات على الهدرز هنا
}));

function guessContentType(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".m3u8") return "application/vnd.apple.mpegurl";
  if (ext === ".mpd")  return "application/dash+xml";
  if (ext === ".ts")   return "video/mp2t";
  if (ext === ".m4s")  return "video/iso.segment";
  if (ext === ".mp4")  return "video/mp4";
  if (ext === ".aac")  return "audio/aac";
  return "application/octet-stream";
}

function rewriteM3U8(baseUpstreamUrl, bodyText, proxyOrigin) {
  const base = new URL(baseUpstreamUrl);
  const lines = bodyText.split(/\r?\n/).map((ln) => {
    if (!ln || ln.startsWith("#")) return ln;
    let abs;
    try { abs = new URL(ln, base).toString(); } catch { return ln; }
    const u = new URL(abs);
    const idx = u.pathname.indexOf("/hls/");
    if (idx === -1) return ln;
    const proxyPath = u.pathname.slice(idx);
    return `${proxyOrigin}${proxyPath}${u.search || ""}`;
  });
  return lines.join("\n");
}

function getProxyOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host  = req.headers["x-forwarded-host"]  || req.headers.host;
  return `${proto}://${host}`;
}

app.get("/hls/*", async (req, res) => {
  try {
    const upstreamUrl = new URL(req.originalUrl.replace(/^\/+/, "/"), UPSTREAM_BASE).toString();
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(upstreamUrl, { headers });

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status);
      upstream.headers.forEach((v, k) => res.setHeader(k, v));
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(await upstream.text());
    }

    const ct = guessContentType(upstreamUrl);
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (ct.includes("mpegurl") || ct.includes("dash+xml")) {
      res.setHeader("Cache-Control", "no-store");
    } else {
      res.setHeader("Cache-Control", "public, max-age=30, immutable");
    }

    if (upstream.status === 206) {
      res.status(206);
      const cr = upstream.headers.get("Content-Range");
      if (cr) res.setHeader("Content-Range", cr);
      const len = upstream.headers.get("Content-Length");
      if (len) res.setHeader("Content-Length", len);
      res.setHeader("Accept-Ranges", "bytes");
    }

    if (ct === "application/vnd.apple.mpegurl") {
      const text = await upstream.text();
      const origin = getProxyOrigin(req);
      const rewritten = rewriteM3U8(upstreamUrl, text, origin);
      return res.send(rewritten);
    }

    return upstream.body.pipe(res);
  } catch (e) {
    console.error("Proxy error:", e);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(502).send("Bad Gateway (proxy error)");
  }
});

// صفحة اختبار بدون inline scripts
app.get("/player", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "player.html"));
});

app.get("/", (req, res) => {
  res.type("text/plain").send("HLS proxy is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
