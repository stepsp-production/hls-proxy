// server.js
const express = require('express');
const morgan  = require('morgan');
const cors    = require('cors');
const path    = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app  = express();
const PORT = process.env.PORT || 10000;

// ===== إعداد المصدر (UPSTREAM) =====
// غيّره من لوحة Render -> Environment إلى عنوان الأساس الصحيح (بدون مسار)
const UPSTREAM = process.env.UPSTREAM || 'https://races-player.it-f2c.workers.dev';
// إذا كان المصدر لا يملك بادئة /hls على المسارات، عيّن STRIP_HLS=1 من بيئة Render
const STRIP_HLS = process.env.STRIP_HLS === '1';

app.use(morgan('dev'));
app.use(cors({ origin: '*', credentials: false }));

// ترويسات CORS ولا كاش
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ملفات ثابتة (المشغّل)
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.redirect('/player?src=/hls/live2/playlist.m3u8');
});

// ========== بروكسي HLS ==========
app.use('/hls', createProxyMiddleware({
  target: UPSTREAM,
  changeOrigin: true,
  secure: true,
  ws: false,
  followRedirects: true,
  // تعديل المسار حسب الحاجة
  pathRewrite: (pathReq) => {
    // مثال: /hls/live2/playlist.m3u8
    if (STRIP_HLS) {
      // يصبح /live2/playlist.m3u8
      return pathReq.replace(/^\/hls(\/|$)/, '/');
    }
    // بدون تعديل
    return pathReq;
  },
  onProxyReq(proxyReq, req, res) {
    // أضف ترويسات قد يطلبها المصدر
    const origin = new URL(UPSTREAM).origin;
    proxyReq.setHeader('Origin', origin);
    proxyReq.setHeader('Referer', origin + '/');
    proxyReq.setHeader(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
    );
    proxyReq.setHeader('Cache-Control', 'no-store');
  },
  onProxyRes(proxyRes) {
    // فرض CORS وعدم التخزين
    proxyRes.headers['access-control-allow-origin']  = '*';
    proxyRes.headers['access-control-allow-headers'] = 'Origin, X-Requested-With, Content-Type, Accept, Range';
    proxyRes.headers['access-control-allow-methods'] = 'GET,HEAD,OPTIONS';
    proxyRes.headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['x-frame-options'];
  },
  onError(err, req, res) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad gateway from proxy: ' + (err && err.message ? err.message : String(err)));
  },
  // مهلة مريحة للبث
  proxyTimeout: 25_000,
  timeout: 25_000,
}));

app.listen(PORT, () => {
  console.log('Server running on', PORT);
  console.log('UPSTREAM =', UPSTREAM, ' | STRIP_HLS =', STRIP_HLS);
});
