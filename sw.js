/* =============================================================
   sw.js — Service Worker with tiered caching strategies
   ============================================================= */

const CACHE_NAME = 'tripcams-v5';
const STATIC_ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/api.js',
  'js/cameras.js',
  'js/map.js',
  'data/route.json',
  'img/placeholder.svg',
  'manifest.json',
];

const CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
];

const API_CACHE = 'tripcams-api-v1';
const IMAGE_CACHE = 'tripcams-images-v1';
const TILE_CACHE = 'tripcams-tiles-v1';
const API_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const IMAGE_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes (was 2 — too short for road trips)
const TILE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours (map tiles rarely change)
const IMAGE_CACHE_LIMIT = 200;
const TILE_CACHE_LIMIT = 500;

// Install — precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);
      // CDN assets — best effort
      for (const url of CDN_ASSETS) {
        try { await cache.add(url); } catch (e) { /* ok */ }
      }
    })
  );
  self.skipWaiting();
});

// Activate — cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== API_CACHE && k !== IMAGE_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch — routing
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API requests (via CORS proxy or direct to camera APIs)
  if (isApiRequest(url)) {
    event.respondWith(networkFirstWithCache(event.request, API_CACHE, API_CACHE_DURATION));
    return;
  }

  // Camera images
  if (isCameraImage(url)) {
    event.respondWith(cacheFirstWithExpiry(event.request, IMAGE_CACHE, IMAGE_CACHE_DURATION));
    return;
  }

  // Map tiles — cache-first (tiles rarely change, critical for offline)
  if (isMapTile(url)) {
    event.respondWith(cacheFirstWithExpiry(event.request, TILE_CACHE, TILE_CACHE_DURATION, TILE_CACHE_LIMIT));
    return;
  }

  // OSRM routing API — cache for 24 hours (road geometry doesn't change often)
  if (isRoutingApi(url)) {
    event.respondWith(networkFirstWithCache(event.request, API_CACHE, API_CACHE_DURATION));
    return;
  }

  // Static assets — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(event.request));
});

// ── Strategy: Network first, cache fallback ────────────────────

async function networkFirstWithCache(request, cacheName, maxAge) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      const headers = new Headers(response.headers);
      headers.set('sw-cached-at', Date.now().toString());
      const cloned = new Response(await response.clone().blob(), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      cache.put(request, cloned);
    }
    return response;
  } catch (e) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Strategy: Cache first with expiry ──────────────────────────

async function cacheFirstWithExpiry(request, cacheName, maxAge, cacheLimit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0');
    if (Date.now() - cachedAt < maxAge) {
      return cached;
    }
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set('sw-cached-at', Date.now().toString());
      const cloned = new Response(await response.clone().blob(), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      cache.put(request, cloned);
      trimCache(cacheName, cacheLimit || IMAGE_CACHE_LIMIT);
    }
    return response;
  } catch (e) {
    if (cached) return cached;
    return new Response('', { status: 404 });
  }
}

// ── Strategy: Stale-while-revalidate ───────────────────────────

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || await fetchPromise || new Response('Offline', { status: 503 });
}

// ── Helpers ────────────────────────────────────────────────────

function isApiRequest(url) {
  return url.hostname === 'corsproxy.io' ||
    url.hostname === '511.alberta.ca' ||
    url.hostname === 'images.drivebc.ca' ||
    url.hostname.includes('wsdot');
}

function isCameraImage(url) {
  const path = url.pathname.toLowerCase();
  const host = url.hostname.toLowerCase();
  return (
    (host.includes('511.alberta.ca') && path.includes('cctv')) ||
    (host.includes('drivebc') && (path.includes('image') || path.includes('webcam'))) ||
    (host.includes('wsdot') && path.includes('camera')) ||
    (host.includes('images.wsdot.wa.gov'))
  );
}

function isMapTile(url) {
  const host = url.hostname.toLowerCase();
  return host.includes('basemaps.cartocdn.com') ||
    host.includes('tile.openstreetmap.org') ||
    host.includes('tiles.stadiamaps.com') ||
    (host.includes('unpkg.com') && url.pathname.includes('leaflet') && url.pathname.endsWith('.png'));
}

function isRoutingApi(url) {
  return url.hostname.includes('router.project-osrm.org');
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    for (let i = 0; i < keys.length - maxItems; i++) {
      await cache.delete(keys[i]);
    }
  }
}
