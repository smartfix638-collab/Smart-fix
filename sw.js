/* ============================================================
   SMARTFIX ERP — Service Worker (v4.3.0)
   File: sw.js
   Purpose: Offline caching + PWA install support
   ============================================================ */

const APP_VERSION = '4.3.0';
const CACHE_NAME = 'smartfix-v' + APP_VERSION;
const RUNTIME_CACHE = 'smartfix-runtime-v' + APP_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './app.html',
  './customer.html',
  './manifest.json',
  './js/firebase-config.js',
  './js/auth.js',
  './js/common.js',
  './js/state.js',
  './js/cloud.js',
  './js/router.js',
  './js/permissions.js',
  './js/attendance.js',
  './js/app-init.js',
  './modules/billing.html',
  './modules/returns.html',
  './modules/purchase.html',
  './modules/vouchers.html',
  './modules/accounting.html',
  './modules/books.html',
  './modules/parties.html',
  './modules/inventory.html',
  './modules/staff.html',
  './modules/settings.html',
  './modules/attendance.html',
  './modules/attendance-report.html'
];

const NO_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'firebaselogging.googleapis.com',
  'api.qrserver.com',
  'nominatim.openstreetmap.org'
];

const CDN_CACHE_PATTERNS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'gstatic.com/firebasejs'
];


/* ============================================================
   INSTALL
   ============================================================ */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v' + APP_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Precache partial fail:', err);
      });
    }).then(() => self.skipWaiting())
  );
});


/* ============================================================
   ACTIVATE
   ============================================================ */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v' + APP_VERSION);
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME && name !== RUNTIME_CACHE) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});


/* ============================================================
   FETCH HANDLER
   ============================================================ */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http')) return;

  const url = new URL(req.url);

  /* Firebase & sensitive → network only */
  if (NO_CACHE_HOSTS.some((h) => url.hostname.includes(h))) {
    return;
  }

  /* CDN → cache-first */
  if (CDN_CACHE_PATTERNS.some((p) => req.url.includes(p))) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  /* Same-origin HTML/JS/CSS → network-first */
  if (url.origin === self.location.origin) {
    if (req.destination === 'document' ||
        req.destination === 'script' ||
        req.destination === 'style' ||
        req.url.endsWith('.html') ||
        req.url.endsWith('.js') ||
        req.url.endsWith('.css') ||
        req.url.endsWith('.json')) {
      event.respondWith(networkFirst(req, CACHE_NAME));
      return;
    }
    event.respondWith(cacheFirst(req, CACHE_NAME));
    return;
  }

  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});


/* ============================================================
   STRATEGIES
   ============================================================ */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request).then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
    }).catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    return offlineFallback(request);
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

function offlineFallback(request) {
  if (request.destination === 'document') {
    return new Response(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Offline</title>
    <style>body{margin:0;min-height:100vh;background:#020617;color:#e2e8f0;display:flex;align-items:center;justify-content:center;font-family:system-ui;padding:20px}
    .c{max-width:400px;background:rgba(15,23,42,.75);border:1px solid rgba(56,189,248,.15);border-radius:18px;padding:32px;text-align:center}
    .i{font-size:56px;margin-bottom:16px}h1{font-size:20px;color:#38bdf8;margin:0 0 8px}
    p{color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 20px}
    button{background:linear-gradient(135deg,#0ea5e9,#0369a1);color:white;border:none;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;width:100%}</style>
    </head><body><div class="c"><div class="i">📴</div><h1>You're Offline</h1>
    <p>SmartFix ERP needs internet to sync.<br>Check your connection and try again.</p>
    <button onclick="location.reload()">🔄 Retry</button></div></body></html>`, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  return new Response('Offline', { status: 503, statusText: 'Offline' });
}


/* ============================================================
   MESSAGE HANDLER
   ============================================================ */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (data.type === 'CLEAR_CACHES') {
    caches.keys().then((names) => {
      Promise.all(names.map((n) => caches.delete(n))).then(() => {
        event.ports[0]?.postMessage({ ok: true });
      });
    });
    return;
  }
  if (data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: APP_VERSION, cache: CACHE_NAME });
    return;
  }
});


/* ============================================================
   BACKGROUND SYNC
   ============================================================ */
self.addEventListener('sync', (event) => {
  if (event.tag === 'smartfix-sync') {
    event.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_NOW' });
  });
}

console.log('🔧 SmartFix SW v' + APP_VERSION + ' loaded');
