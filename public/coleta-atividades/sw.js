const CACHE_NAME = "grob-coleta-v1";
const APP_SHELL = [
  "/coleta-atividades/",
  "/coleta-atividades/manifest.webmanifest",
  "/css/app.css",
  "/css/pre-inscritos.css",
  "/css/gestao-evento.css",
  "/js/auth.js",
  "/js/coleta-atividades.js",
  "/js/firebase-client.js",
  "/img/LogoPNG.png",
];
const EXTERNAL_ASSETS = [
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js",
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
        // A coleta segue instalada; o recurso externo será tentado novamente
        // enquanto houver conexão.
        console.warn("Não foi possível guardar recurso para uso offline.", asset, error);
      }
    }));
  }));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith("grob-coleta-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || (
        event.request.mode === "navigate" ? caches.match("/coleta-atividades/") : Response.error()
      ))),
  );
});
