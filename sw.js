/* Offline page shell; never intercept API calls, auth requests or cloud state.
   Keep these asset URLs aligned with index.html when preparing a release. */
const SHELL_CACHE = "tp-shell-20261025-qa-v2";
const SHELL = [
  "./",
  "./index.html",
  "./style.css?v=20261025-goal-direction-v1",
  "./github-page/milestones.css?v=20261024-journey-clean-v2",
  "./github-page/config.js",
  "./github-page/domain.js?v=20261022-sage-reflection-v1",
  "./github-page/connection.js?v=20261025-goal-direction-v1",
  "./github-page/milestones.js?v=20261024-journey-clean-v2",
  "./script.js?v=20261025-goal-direction-v1",
  "./github-page/pwa.js?v=20261024-week-first-v1",
  "./github-page/cycle-management.js?v=20261025-weekly-start-v1"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("tp-shell-") && k !== SHELL_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/") || request.headers.has("Authorization")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(request).then(hit => hit || fetch(request)));
});