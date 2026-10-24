/* Tiny Progress service worker：只快取網站本身的外殼，絕不快取 API／雲端資料。 */
const CACHE = "tp-shell-stage2-v1";
const SHELL = [
  "./", "./index.html", "./style.css", "./script.js", "./manifest.webmanifest",
  "./github-page/config.js", "./github-page/domain.js", "./github-page/connection.js",
  "./github-page/milestones.js", "./github-page/milestones.css", "./github-page/cycle-management.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 雲端 API、字體等一律不攔截
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html"))),
  );
});
