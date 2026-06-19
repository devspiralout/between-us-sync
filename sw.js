// Between Us (sync) — offline support without staleness. Our own files are served
// network-first (so a new deploy shows up immediately when online, cache only as
// an offline fallback); fonts and the versioned Firebase SDK are immutable so they
// stay cache-first. NEVER intercept Firestore traffic — that would freeze live sync.
const CACHE = "between-us-sync-v20";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./questions.js", "./firebase-config.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  const isSdk = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!sameOrigin && !isFont && !isSdk) return; // Firestore & everything else: untouched

  // Immutable third-party assets (web fonts, version-pinned Firebase SDK): cache-first.
  if (isFont || isSdk) {
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
      )
    );
    return;
  }

  // Our own app files: network-first. Fetch fresh (bypassing the HTTP cache so a
  // new deploy is picked up at once), update the cache, and fall back to the
  // cached copy — or the app shell — only when the network is unavailable.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});

// ——— push notifications ———
// FCM delivers messages here (the token is bound to this service worker). We send
// data-only messages from the Cloud Function and render the notification ourselves.
self.addEventListener("push", (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) { payload = {}; }
  const d = payload.data || payload.notification || payload || {};
  const title = d.title || "Between Us";
  const body = d.body || "";
  const url = d.url || "./";
  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: "between-us",
    data: { url },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
      for (const c of cls) { if (c.url.includes("between-us-sync") && "focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
