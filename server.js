// server.js
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// عدّل هذا إذا تغيّر الدومين الأصلي
const UPSTREAM_BASE = (process.env.UPSTREAM_BASE || 'https://races-player.it-f2c.workers.dev').replace(/\/$/, '');

// Middlewares
app.use(cors());
app.use(compression());
app.use(morgan('dev'));

// Static from public/
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// صفحة رئيسية
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// التعامل مع Preflight
app.options('/hls/*', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, Referer, Range, Accept, Content-Type',
  });
  res.sendStatus(204);
});

// بروكسي /hls/*
app.use('/hls', async (req, res) => {
  try {
    // نبقي نفس المسار بالكامل كما طلبه المتصفح
    // مثال: /hls/live2/playlist.m3u8?x=1
    const targetUrl = UPSTREAM_BASE + req.originalUrl;

    // نُحضِّر رؤوس مناسبة
    const headers = {
      'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'accept': req.headers['accept'] || '*/*',
      // لا نرسل accept-encoding حتى لا يعيد المصدر gzip مربك
      // ولا نرسل host
    };
    if (req.headers['range']) headers['range'] = req.headers['range'];
    if (req.headers['origin']) headers['origin'] = req.headers['origin'];
    if (req.headers['referer']) headers['referer'] = req.headers['referer'];

    const upstreamResp = await fetch(targetUrl, {
      method: req.method,
      headers,
    });

    // Debug مفيد عند المشاكل
    if (!upstreamResp.ok) {
      console.error('Upstream not OK:', upstreamResp.status, targetUrl);
    }

    res.status(upstreamResp.status);

    // نمرر الهيدرز المهمة فقط
    const passHeaders = [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'cache-control',
      'etag',
      'last-modified'
    ];
    for (const h of passHeaders) {
      const v = upstreamResp.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    // CORS دائماً
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!upstreamResp.body) {
      res.end();
      return;
    }

    // بث جسم الاستجابة كستريم
    const reader = upstreamResp.body.getReader();
    const pump = () =>
      reader.read().then(({ done, value }) => {
        if (done) return res.end();
        res.write(value);
        return pump();
      });
    pump().catch(() => res.end());
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(502).send('Bad Gateway (proxy failed)');
  }
});

// أي مسار آخر يرجع player.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`➡️  Upstream base: ${UPSTREAM_BASE}`);
});
