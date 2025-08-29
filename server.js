// server.js
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ✳️ عدّل هذا إن كان لديك مصدر آخر
const UPSTREAM_BASE = (process.env.UPSTREAM_BASE || 'https://races-player.it-f2c.workers.dev').replace(/\/$/, '');

app.use(cors());
app.use(compression());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// Preflight
app.options('/hls/*', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, Referer, Range, Accept, Content-Type',
  });
  res.sendStatus(204);
});

// Proxy
app.use('/hls', async (req, res) => {
  try {
    // نستخدم المسار كما هو (مثال: /hls/live2/playlist.m3u8?x=1)
    const targetUrl = UPSTREAM_BASE + req.originalUrl;

    // رؤوس مناسبة — نلغي Origin/Referer و Accept-Encoding
    const headers = {
      'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'accept': req.headers['accept'] || '*/*',
    };
    if (req.headers['range']) headers['range'] = req.headers['range'];

    const upstreamResp = await fetch(targetUrl, { method: req.method, headers });

    if (!upstreamResp.ok) {
      console.error('Upstream not OK:', upstreamResp.status, targetUrl);
    }

    // لو الملف .m3u8 نحاول ضبط Content-Type
    if (/\.m3u8($|\?)/i.test(req.originalUrl)) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    }

    res.status(upstreamResp.status);
    const passHeaders = [
      'content-length', 'accept-ranges', 'content-range',
      'cache-control', 'etag', 'last-modified'
    ];
    for (const h of passHeaders) {
      const v = upstreamResp.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!upstreamResp.body) return res.end();

    const reader = upstreamResp.body.getReader();
    const pump = () => reader.read().then(({ done, value }) => {
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

// أي مسار آخر → player.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`➡️  Upstream base: ${UPSTREAM_BASE}`);
});
