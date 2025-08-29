// server.js
const express = require('express');
const morgan  = require('morgan');
const cors    = require('cors');
const path    = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app  = express();
const PORT = process.env.PORT || 10000;

// ===== 1) لوج + CORS عام =====
app.use(morgan('dev'));
app.use(cors({ origin: '*', credentials: false }));

// ترويسات CORS إضافية لأي رد (احتياطي)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  // لا تخزّن لكي لا يعلق المانيفست
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ===== 2) ملفات ثابتة من /public =====
app.use(express.static('public'));

// ===== 3) صفحة افتراضية بسيطة =====
app.get('/', (req, res) => {
  // حوّل مباشرة للـ player مع قناة افتراضية (live2) — عدّل إن شئت
  res.redirect('/player?src=/hls/live2/playlist.m3u8');
});

// ===== 4) بروكسي HLS =====
// غيّر هذا حسب مصدر HLS الأصلي لديك
const UPSTREAM = 'https://races-player.it-f2c.workers.dev';

// أي شيء تحت /hls/* يُرسل للمصدر
app.use('/hls', createProxyMiddleware({
  target: UPSTREAM,
  changeOrigin: true,
  secure: true,
  // لا تضغط (HLS أفضل بلا ضغط)
  selfHandleResponse: false,
  // إعادة كتابة المسار كما هو (هنا لا نبدّل شيئًا)
  pathRewrite: (pathReq, req) => {
    // مثال: /hls/live2/playlist.m3u8  =>  /hls/live2/playlist.m3u8 عند الـ UPSTREAM
    return pathReq;
  },
  onProxyReq(proxyReq, req, res) {
    // تأكد أن المانيفست/الشرائح تُخدّم فورًا
    proxyReq.setHeader('Cache-Control', 'no-store');
  },
  onProxyRes(proxyRes, req, res) {
    // فرض CORS للخارج
    proxyRes.headers['access-control-allow-origin']  = '*';
    proxyRes.headers['access-control-allow-headers'] = 'Origin, X-Requested-With, Content-Type, Accept, Range';
    proxyRes.headers['access-control-allow-methods'] = 'GET,HEAD,OPTIONS';
    // لا كاش
    proxyRes.headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['x-frame-options'];
  },
  // أخطاء واضحة
  onError(err, req, res) {
    res.status(502).end('Bad gateway from proxy: ' + (err?.message || err));
  }
}));

// ===== 5) تشغيل =====
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
  console.log('👉 Available at your primary URL');
});
