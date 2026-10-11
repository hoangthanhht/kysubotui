// Lưu bản web + bộ AI (model, onnxruntime-web) vào máy để lần sau mở nhanh và dùng được khi mất mạng.
// Đổi CACHE khi phát hành bản web mới (app.js WEB_VERSION) để máy người dùng tải bản mới.
const CACHE = "ksbt-web-1.0.1";
const SHELL = ["./", "index.html", "app.css", "app.js", "infer.js", "viewer.js", "store.js", "manifest.webmanifest",
  "../site.js", "../img/icon-192.png", "../img/icon-512.png", "../img/favicon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("goatcounter.com") || url.hostname === "gc.zgo.at") return; // thống kê: luôn qua mạng
  const heavy = url.pathname.includes("/models/") || url.hostname === "cdn.jsdelivr.net";
  // Model + onnxruntime: lấy từ máy trước (nặng, đổi theo phiên bản). Trang: mạng trước, mất mạng thì dùng bản lưu.
  e.respondWith(heavy ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req)) || Response.error();
  }
}
