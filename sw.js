// Service worker do GenFin: guarda o app para abrir sem internet.
// O app em si vem primeiro da rede (para receber atualizações) e cai no cache quando está offline.
// As APIs de cotação e de IA nunca passam pelo cache.
const CACHE = "genfin-v2";
const APP = ["/", "/carteira.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"];
const FONTES = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(nomes => Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(r => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
        return r;
      }).catch(() => caches.match(req).then(r => r || (req.mode === "navigate" ? caches.match("/") : Response.error())))
    );
  } else if (FONTES.includes(url.hostname)) {
    // Fonte: usa a guardada e atualiza em segundo plano
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(guardada => {
      const rede = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => guardada);
      return guardada || rede;
    })));
  }
});
