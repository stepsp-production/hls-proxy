// server.js
// Node >=18 (يوجد fetch مدمج)
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ✨ عدّل هذا إن احتجت: هذا هو الأصل الذي سنوجّه له /hls/*
const UPSTREAM_BASE = process.env.UPSTREAM_BASE || 'https://races-player.it-f2c.workers.dev';

// middlewares
app.use(cors());
app.use(compression());
app.use(morgan('dev'));

// ملفات static من public/ (مثلاً /player.html و /app.js …)
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// صفحة مساعدة: /  → تفتح public/player.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

/**
 * بروكسي بسيط لمسار /hls/*  → يوجه لنفس المسار على الـ UPSTREAM_BASE
 * مثال: GET /hls/live2/playlist.m3u8
 * سيذهب إلى: https://races-player.it-f2c.workers.dev/hls/live2/playlist.m3u8
 */
app.use('/hls', async (req, res) => {
  try {
    // نبني عنوان الهدف بالحرف: نفس الـ path والـ query
    const targetUrl = new URL(req.originalUrl, UPSTREAM_BASE).toString();

    // نمرّر الـ headers المهمة (خصوصاً Range)
    const headers = {
      'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'accept': req.headers['accept'] || '*/*',
      'origin': req.headers['origin'] || undefined,
      'referer': req.headers['referer'] || undefined,
    };
    if (req.headers['range']) headers['range'] = req.headers['range'];

    const upstreamResp = await fetch(targetUrl, {
      method: req.method,
      headers,
      // لا نرسل body في GET/HEAD
    });

    // نعيد نفس كود الحالة
    res.status(upstreamResp.status);

    // ننقل عدداً من الهيدرز المهمة فقط (حتى لا نرسل ما يربك المتصفح)
    const passThroughHeaders = [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'cache-control',
      'last-modified',
      'etag',
      'access-control-allow-origin'
    ];
    passThroughHeaders.forEach(h => {
      const v = upstreamResp.headers.get(h);
      if (v) res.setHeader(h, v);
    });

    // HLS يحتاج CORS واضح دائماً
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (upstreamResp.body) {
      // نبثّ البودي كستريم (مهم للـ .ts)
      upstreamResp.body.pipeTo(
        new WritableStream({
          write(chunk) { res.write(chunk); },
          close() { res.end(); },
          abort() { res.end(); }
        })
      ).catch(() => res.end());
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(502).send('Bad Gateway (proxy failed)');
  }
});

// أي مسار غير معروف → player.html (حتى يعمل رابط /player?src=...)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`➡️  Upstream base: ${UPSTREAM_BASE}`);
});
