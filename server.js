const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// لوجينغ وضغط وكورز
app.use(morgan('dev'));
app.use(compression());
app.use(cors());

// خدمة الملفات الثابتة من مجلد public/
app.use(express.static(path.join(__dirname, 'public'), {
  fallthrough: true,
  maxAge: '1h',
}));

// صفحة player.html في public/
app.get('/player', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// بروكسي بسيط لـ HLS (تمرير المصدر src كما هو إلى nginx/render upstream إذا كان مفعّل)
app.get('/hls/*', async (req, res) => {
  // إن كنت لا تستخدم upstream داخلي، اترك هذا المسار ليعيد 404 أو أعد التوجيه
  res.status(502).send('Upstream for HLS is not configured on this server.');
});

// صحّة
app.get('/health', (_req, res) => res.json({ ok: true }));

// 404 افتراضي
app.use((_req, res) => res.status(404).send('Not found'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
