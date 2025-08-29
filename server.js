// hls-proxy server.js
const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const compression = require('compression');
const morgan = require('morgan');
const cors = require('cors');
const path = require('path');

// غيّر الأصل من الإعدادات في Render: ORIGIN_BASE=http://46.152.153.249
const ORIGIN_BASE = process.env.ORIGIN_BASE || 'http://46.152.153.249';

const app = express();
app.set('trust proxy', true);
app.use(morgan('dev'));
app.use(compression());
app.use(cors({
  origin: true,
  credentials: false,
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

// رأس أمني مع سماح HLS
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // اسمح للمتصفح بطلب المانيفست والتسيوغ
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// وكيل HLS: يمرر كل شيء تحت /hls/* إلى المصدر
app.use('/hls', createProxyMiddleware({
  target: ORIGIN_BASE,
  changeOrigin: true,
  secure: false,           // لا تتحقق من شهادة TLS (نحن نستعمل HTTP أصلاً)
  ws: false,
  followRedirects: true,
  // نحافظ على رؤوس HLS المهمة
  onProxyReq: (proxyReq, req) => {
    proxyReq.setHeader('Connection', 'keep-alive');
    if (req.headers['range']) proxyReq.setHeader('Range', req.headers['range']);
    proxyReq.setHeader('Accept', '*/*');
    proxyReq.setHeader('User-Agent', req.headers['user-agent'] || 'Mozilla/5.0');
    proxyReq.setHeader('Referer', ORIGIN_BASE + '/');
    proxyReq.setHeader('Origin', ORIGIN_BASE);
  },
  onProxyRes: (proxyRes, req, res) => {
    // تأكد من Content-Type الصحيح
    const u = req.url || '';
    if (u.endsWith('.m3u8')) proxyRes.headers['content-type'] = 'application/vnd.apple.mpegurl';
    if (u.endsWith('.ts') || u.endsWith('.m4s')) proxyRes.headers['content-type'] = 'video/mp2t';
    // اسمح بالـ range
    if (proxyRes.headers['accept-ranges'] !== 'bytes') {
      proxyRes.headers['accept-ranges'] = 'bytes';
    }
    // CORS
    proxyRes.headers['access-control-allow-origin'] = '*';
  },
  // رجّع رسالة أوضح بدلاً من 502 صامتة
  selfHandleResponse: false,
  proxyTimeout: 25_000,
  timeout: 25_000,
}));

// صفحة اختبار بسيطة: /player?src=/hls/live2/playlist.m3u8
app.get('/player', (req, res) => {
  const src = req.query.src || '/hls/live/playlist.m3u8';
  res.type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>HLS Test</title>
<body style="background:#000;margin:0;display:grid;place-items:center;height:100vh">
<video id="v" controls playsinline style="width:min(90vw,900px);max-height:90vh;background:#111"></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
const v=document.getElementById('v'); const src=${JSON.stringify(src)};
if (Hls.isSupported()){
  const h=new Hls(); h.loadSource(src); h.attachMedia(v);
  h.on(Hls.Events.ERROR,(e,d)=>console.log('HLS error',d));
}else{ v.src=src; }
</script>`);
});

// ستاتيك اختياري لو أردت public/
app.use(express.static(path.join(__dirname, 'public')));

// صحّة
app.get('/healthz', (_, r)=>r.send('ok'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Proxy on', PORT, '→', ORIGIN_BASE));
