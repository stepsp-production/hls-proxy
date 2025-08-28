import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;
const ORIGIN = process.env.ORIGIN || "https://46.152.153.249";

// دالة CORS قوية
function addCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range");
}

// للـ preflight
app.options("*", (req, res) => {
  addCors(res);
  return res.status(204).end();
});

// بروكسي للملفات
app.get("/hls/*", async (req, res) => {
  try {
    const targetUrl = ORIGIN + req.path.replace("/hls", "");
    console.log("Proxying:", targetUrl);

    // اجبار User-Agent زي VLC
    const response = await fetch(targetUrl, {
      headers: { "User-Agent": "VLC/3.0.18 LibVLC/3.0.18" }
    });

    if (!response.ok) {
      return res.status(response.status).send("Upstream error");
    }

    // معالجة playlist.m3u8
    if (req.path.endsWith(".m3u8")) {
      let text = await response.text();

      // rewrite الروابط الداخلية للـ proxy
      text = text.replace(/(https?:\/\/[^\/]+)?\/(.*\.m3u8)/g,
        (_, __, p2) => `${req.protocol}://${req.get("host")}/hls/${p2}`);

      text = text.replace(/(https?:\/\/[^\/]+)?\/(.*\.(ts|mp4|m4s))/g,
        (_, __, p2) => `${req.protocol}://${req.get("host")}/hls/${p2}`);

      addCors(res);
      res.type("application/vnd.apple.mpegurl");
      res.set("Content-Disposition", 'inline; filename="playlist.m3u8"');
      res.set("X-Content-Type-Options", "nosniff");
      return res.send(text);
    }

    // معالجة ملفات ts/m4s
    if (req.path.endsWith(".ts") || req.path.endsWith(".m4s")) {
      addCors(res);
      res.type("video/mp2t");
      res.set("X-Content-Type-Options", "nosniff");
      response.body.pipe(res);
      return;
    }

    // أي ملف ثاني
    addCors(res);
    res.type(response.headers.get("content-type") || "application/octet-stream");
    response.body.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy failed");
  }
});

app.get("/", (req, res) => {
  addCors(res);
  res.send("HLS Proxy is running. Use /hls/... paths.");
});

app.listen(PORT, () => {
  console.log(`HLS proxy running on :${PORT}`);
});
