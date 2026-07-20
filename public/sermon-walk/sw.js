const CACHE_NAME = "sermon-walk-v1";
const ASSETS = [
  "/sermon-walk/",
  "/sermon-walk/index.html",
  "/sermon-walk/styles.css",
  "/sermon-walk/app.js",
  "/sermon-walk/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
  )));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !new URL(event.request.url).pathname.startsWith("/sermon-walk/")) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
