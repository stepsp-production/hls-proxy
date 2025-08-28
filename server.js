// server.js
import express from "express";
import fetch, { Headers } from "node-fetch";
import https from "https";

const app = express();
const ORIGIN = process.env.ORIGIN || "https://46.152.153.249";
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// CORS
function addCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range, Referer, User-Agent");
  res.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type");
  res.set("Timing-Allow-Origin", "*");
}
app.options("*", (req, res) => { addCors(res); res.status(204).end(); });

// إعادة محاولة خفيفة
async function fetchWithRetry(url, options={}, retries=1) {
  let last, res;
  for (let i=0;i<=retries;i++){
    try {
      res = await fetch(url, options);
      if (res.ok) return res;
      if (![502,504].includes(res.status)) return res;
    } catch(e){ last = e; }
    await new Promise(r => setTimeout(r, 300));
  }
  if (res) return res;
  throw last || new Error("fetch failed");
}

app.get("/favicon.ico", (req,res)=> res.status(204).end());

app.get("/hls/*", async (req, res) => {
  addCors(res);
  const upstreamUrl = ORIGIN + req.originalUrl;

  try {
    const hdr = new Headers();
    if (req.headers.range) hdr.set("Range", req.headers.range);
    hdr.set("User-Agent", req.headers["user-agent"] || "VLC/3.0.18 LibVLC/3.0.18");
    hdr.set("Accept-Encoding", ""); // لا ضغط كي نعيد الكتابة بسهولة
    hdr.set("Referer", ORIGIN);
    hdr.set("Origin", ORIGIN);

    const up = await fetchWithRetry(upstreamUrl, {
      method: "GET",
      headers: hdr,
      agent: httpsAgent,
      redirect: "follow",
    }, 1);

    if (!up.ok) {
      const txt = await up.text().catch(()=> "");
      res.status(up.status).type("text/plain")
         .send(`Upstream returned ${up.status}\nURL: ${upstreamUrl}\n${txt}`);
      return;
    }

    const p = req.path.toLowerCase();
    const isM3U8 = p.endsWith(".m3u8");
    const isTS   = p.endsWith(".ts") || p.endsWith(".m4s") || p.endsWith(".mp4") || p.endsWith(".aac") || p.endsWith(".m4a") || p.endsWith(".m4v");

    res.set("Cache-Control",
      isM3U8 ? "public, max-age=3, must-revalidate"
             : (isTS ? "public, max-age=60, immutable" : "no-store")
    );

    if (isM3U8) {
      res.type("application/vnd.apple.mpegurl; charset=utf-8");
      res.set("Content-Disposition", 'inline; filename="playlist.m3u8"');
      res.set("X-Content-Type-Options", "nosniff");

      const text = await up.text();
      const scheme = (req.headers["x-forwarded-proto"] || req.protocol || "https");
      const host   = (req.headers["x-forwarded-host"]  || req.get("host"));
      const selfBase = `${scheme}://${host}`;
      const baseDir  = req.originalUrl.substring(0, req.originalUrl.lastIndexOf("/") + 1);

      let rewritten = text.replaceAll("https://46.152.153.249", selfBase);
      rewritten = rewritten.split("\n").map(line => {
        const t = line.trim();
        if (!t || t.startsWith("#")) return line;
        if (/^https?:\/\//i.test(t)) return line;
        return `${selfBase}${baseDir}${t}`;
      }).join("\n");

      return res.send(rewritten);
    }

    if (isTS) {
      if (p.endsWith(".ts"))   res.type("video/mp2t");
      else if (p.endsWith(".mp4")) res.type("video/mp4");
      else if (p.endsWith(".aac")) res.type("audio/aac");
      res.set("X-Content-Type-Options", "nosniff");
      res.status(up.status);
      up.body.pipe(res);
      return;
    }

    res.type(up.headers.get("content-type") || "application/octet-stream");
    res.status(up.status);
    up.body.pipe(res);

  } catch (e) {
    res.status(502).type("text/plain").send(`Upstream fetch failed: ${e?.message || e}\nTried: ${upstreamUrl}`);
  }
});

// صفحة لاعب اختيارية (للاستخدام في iframe إن احتجت)
app.get("/player", (req, res) => {
  const q = req.query.src || "/hls/live/playlist.m3u8";
  const host = req.get("host");
  const absSrc = q.startsWith("http") ? q : `https://${host}${q}`;

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
<title>HLS-hope</title>
<link rel="icon" href="data:,">
<style>body{margin:0;background:#000;color:#fff;font-family:system-ui}.wrap{padding:16px;max-width:960px;margin:auto}video{width:100%;background:#000;border-radius:8px}</style>
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
    const hls = (v.canPlayType('application/vnd.apple.mpegurl'))
      ? null
      : (window.Hls && Hls.isSupported() ? new Hls({
          enableWorker:true, lowLatencyMode:true,
          manifestLoadingMaxRetry:8, manifestLoadingRetryDelay:500, manifestLoadingTimeOut:20000,
          fragLoadingMaxRetry:6, fragLoadingRetryDelay:400, fragLoadingTimeOut:20000,
          liveSyncDurationCount:3, liveMaxLatencyDurationCount:10, backBufferLength:30, maxBufferLength:30
        }) : null);
    if (hls) { hls.loadSource(SRC); hls.attachMedia(v); }
    else { v.src = SRC; }
  </script>
</body>
</html>`);
});

app.get("/", (req, res) => {
  addCors(res);
  res.type("text/plain").send("HLS Proxy is running. Use /hls/... or /player?src=/hls/... paths.");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`HLS proxy running on :${PORT}`));


