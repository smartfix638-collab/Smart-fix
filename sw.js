/* ============================================================
   SMARTFIX ERP — Service Worker
   File: sw.js
   Version: 4.0.0
   Purpose:
     • Offline caching for app shell + modules
     • Network-first for Firebase (always fresh data)
     • Cache-first for static assets
     • Auto-update with user notification
     • Background sync hook for offline writes
   ============================================================ */

/* ---------- CONFIG ---------- */
const APP_VERSION   = '4.0.0';
const CACHE_NAME    = 'smartfix-v' + APP_VERSION;
const RUNTIME_CACHE = 'smartfix-runtime-v' + APP_VERSION;

/* App shell files — cached on install */
const PRECACHE_URLS = [
  './',
  './index.html',
  './app.html',
  './customer.html',

  './js/firebase-config.js',
  './js/auth.js',
  './js/common.js',
  './js/state.js',
  './js/cloud.js',
  './js/router.js',
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

  './manifest.json'
];

/* Hosts we NEVER cache (always network) */
const NO_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'firebaselogging.googleapis.com',
  'api.qrserver.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

/* CDN URLs we DO cache (Tailwind, XLSX, scanner, firebase SDK) */
const CDN_CACHE_PATTERNS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'gstatic.com/firebasejs',
  'unpkg.com'
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
   ACTIVATE — clean old caches
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

  /* Skip non-GET */
  if (req.method !== 'GET') return;

  /* Skip chrome-extension, data URLs etc. */
  if (!req.url.startsWith('http')) return;

  const url = new URL(req.url);

  /* ---- 1. Firebase & sensitive APIs → always network ---- */
  if (NO_CACHE_HOSTS.some((h) => url.hostname.includes(h))) {
    return; /* let browser handle */
  }

  /* ---- 2. CDN libraries → cache-first, update in background ---- */
  if (CDN_CACHE_PATTERNS.some((p) => req.url.includes(p))) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  /* ---- 3. Same-origin HTML/JS/CSS → network-first (get fresh) ---- */
  if (url.origin === self.location.origin) {
    /* HTML and JS always network-first so updates deploy */
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

    /* Images, fonts → cache-first */
    event.respondWith(cacheFirst(req, CACHE_NAME));
    return;
  }

  /* ---- 4. Everything else → network with cache fallback ---- */
  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});


/* ============================================================
   STRATEGIES
   ============================================================ */

/**
 * Cache-first: try cache, fallback to network + save
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    /* Update in background for next time (stale-while-revalidate) */
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
    /* Offline & no cache — return simple offline page */
    return offlineFallback(request);
  }
}

/**
 * Network-first: try network, fallback to cache
 */
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

/**
 * Offline fallback — minimal HTML page
 */
function offlineFallback(request) {
  /* For HTML pages → show a nice offline page */
  if (request.destination === 'document') {
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SmartFix ERP — Offline</title>
        <style>
          body {
            margin: 0; min-height: 100vh;
            background: radial-gradient(ellipse at top, #0c1e3a 0%, #020617 60%);
            color: #e2e8f0; display: flex; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
          }
          .card {
            max-width: 400px; background: rgba(15, 23, 42, 0.75);
            border: 1px solid rgba(56, 189, 248, 0.15);
            border-radius: 18px; padding: 32px 24px;
            text-align: center; backdrop-filter: blur(20px);
            box-shadow: 0 24px 80px rgba(0,0,0,0.5);
          }
          .icon { font-size: 56px; margin-bottom: 16px; }
          h1 { font-size: 20px; color: #38bdf8; margin: 0 0 8px; }
          p { color: #94a3b8; font-size: 13px; line-height: 1.6; margin: 0 0 20px; }
          button {
            background: linear-gradient(135deg, #0ea5e9, #0369a1);
            color: white; border: none; padding: 12px 24px;
            border-radius: 10px; font-weight: 700; font-size: 14px;
            cursor: pointer; width: 100%;
          }
          button:hover { transform: translateY(-1px); }
          .note {
            margin-top: 16px; padding-top: 16px;
            border-top: 1px solid rgba(56, 189, 248, 0.15);
            font-size: 11px; color: #64748b;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">📴</div>
          <h1>You're Offline</h1>
          <p>
            SmartFix ERP needs an internet connection to sync with the cloud.<br><br>
            Please check your connection and try again.
          </p>
          <button onclick="location.reload()">🔄 Retry</button>
          <div class="note">
            Your unsaved changes are safely stored locally
          </div>
        </div>
      </body>
      </html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  /* For other requests → 503 */
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain' }
  });
}


/* ============================================================
   MESSAGE HANDLER (for app ↔ SW communication)
   ============================================================ */
self.addEventListener('message', (event) => {
  const data = event.data || {};

  /* Skip waiting — app tells us a new version is available */
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  /* Clear caches */
  if (data.type === 'CLEAR_CACHES') {
    caches.keys().then((names) => {
      Promise.all(names.map((n) => caches.delete(n))).then(() => {
        event.ports[0]?.postMessage({ ok: true });
      });
    });
    return;
  }

  /* Get version */
  if (data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: APP_VERSION, cache: CACHE_NAME });
    return;
  }
});


/* ============================================================
   BACKGROUND SYNC (for offline writes)
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


/* ============================================================
   PUSH NOTIFICATIONS (future ready)
   ============================================================ */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: 'SmartFix ERP', body: event.data.text() };
  }

  const options = {
    body: payload.body || 'New notification',
    icon: payload.icon || './manifest.json',
    badge: payload.badge || './manifest.json',
    tag: payload.tag || 'smartfix-notif',
    data: payload.data || {},
    vibrate: [100, 50, 100]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'SmartFix ERP', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || './app.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('app.html') && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});


/* ============================================================
   BOOT LOG
   ============================================================ */
console.log('%c🔧 SmartFix ERP Service Worker v' + APP_VERSION + ' ready', 'color:#0ea5e9;font-weight:bold');
