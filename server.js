const express = require("express");
const cors = require("cors");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ السماح بالكروس أورجن
app.use(cors());

// ✅ تقديم الملفات الثابتة من مجلد public
// أي ملف تضعه في public/ سيصبح متاح مثل:
// https://your-app.onrender.com/player.html
app.use(express.static("public"));

// ✅ بروكسي لملفات HLS
// أي رابط يبدأ بـ /hls/* سيتم تمريره لسيرفر الفيديو
app.use(
  "/hls",
  createProxyMiddleware({
    target: "https://multimediaraces.site", // عدل الدومين حسب مصدر ملفات m3u8
    changeOrigin: true,
    ws: true,
    pathRewrite: {
      "^/hls": "/hls", // يحافظ على نفس المسار
    },
  })
);

// ✅ صفحة افتراضية للتأكد أن السيرفر شغال
app.get("/", (req, res) => {
  res.send("🚀 HLS Proxy Server is running. Try /player.html");
});

// ✅ تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
