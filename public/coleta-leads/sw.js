const CACHE_NAME = "grob-leads-v10";
const APP_SHELL = [
  "/coleta-leads/",
  "/css/app.css",
  "/css/pre-inscritos.css",
  "/css/gestao-evento.css",
  "/js/auth.js",
  "/js/offline-profile.js",
  "/js/coleta-leads.js",
  "/js/lead-offline-store.js",
  "/js/firebase-client.js",
  "/img/LogoPNG.png",
];
const EXTERNAL_ASSETS = [
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    await cache.addAll(APP_SHELL);
    await Promise.all(EXTERNAL_ASSETS.map(async (asset) => {
      try {
        const response = await fetch(asset);
        await cache.put(asset, response);
      } catch (error) {
        console.warn("Não foi possível guardar recurso para uso offline.", asset, error);
      }
    }));
  }));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith("grob-leads-") && key !== CACHE_NAME)
    .map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  const canServeFromCache = requestUrl.origin === self.location.origin || EXTERNAL_ASSETS.includes(requestUrl.href);
  if (!canServeFromCache) return;
  event.respondWith(fetch(event.request)
    .then((response) => {
      if (response.ok || response.type === "opaque") {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    })
    .catch(() => caches.match(event.request).then((cached) => cached || (
      event.request.mode === "navigate" ? caches.match("/coleta-leads/") : Response.error()
    ))));
});
