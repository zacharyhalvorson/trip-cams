/* =============================================================
   api.js — Fetch cameras from all 3 APIs with CORS proxy + fallback
   ============================================================= */

const API = (() => {
  const CORS_PROXY = 'https://corsproxy.io/?url=';

  const ENDPOINTS = {
    AB: 'https://511.alberta.ca/api/v2/get/cameras',
    BC: 'https://www.drivebc.ca/api/webcams/',
    WA: 'https://wsdot.com/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson',
  };

  // WSDOT access code (free, public registration)
  // Register at: https://wsdot.wa.gov/traffic/api/
  const WSDOT_ACCESS_CODE = '';

  const CACHE_KEY = 'tripcams_cache';
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Simple in-memory + localStorage cache
  const memCache = {};

  // Returns { data, fresh } where fresh indicates whether data is within TTL
  function getCachedData(region) {
    // Check memory cache first
    if (memCache[region]) {
      const fresh = Date.now() - memCache[region].ts < CACHE_DURATION;
      return { data: memCache[region].data, fresh, ts: memCache[region].ts };
    }
    try {
      const stored = localStorage.getItem(`${CACHE_KEY}_${region}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        memCache[region] = parsed;
        const fresh = Date.now() - parsed.ts < CACHE_DURATION;
        return { data: parsed.data, fresh, ts: parsed.ts };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function setCachedData(region, data) {
    const entry = { data, ts: Date.now() };
    memCache[region] = entry;
    try {
      localStorage.setItem(`${CACHE_KEY}_${region}`, JSON.stringify(entry));
    } catch (e) { /* quota exceeded, ignore */ }
  }

  async function fetchWithProxy(url, options = {}) {
    const proxied = CORS_PROXY + encodeURIComponent(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(proxied, { ...options, signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchDirect(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchFallback(region) {
    try {
      const resp = await fetch(`data/cameras-${region.toLowerCase()}.json`);
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  // Generic fetch for a region: stale-while-revalidate pattern
  // Returns stale data immediately if available, refreshes in background
  async function fetchRegion(region, endpoint, normalizer) {
    const cached = getCachedData(region);

    // Fresh cache — return immediately
    if (cached && cached.fresh) {
      return { data: normalizer(cached.data), fromCache: true };
    }

    // Stale cache exists — return it but refresh in background
    if (cached && !cached.fresh) {
      // Fire-and-forget background refresh
      refreshRegion(region, endpoint).catch(() => {});
      return { data: normalizer(cached.data), fromCache: true, stale: true };
    }

    // No cache at all — must fetch
    try {
      const raw = await fetchWithRetry(endpoint);
      setCachedData(region, raw);
      return { data: normalizer(raw), fromCache: false };
    } catch (e) {
      console.warn(`${region} API failed, using fallback:`, e.message);
      const fallback = await fetchFallback(region);
      if (fallback) {
        // Save fallback as cache so it's available next time
        setCachedData(region, fallback);
        return { data: normalizer(fallback), fromCache: true };
      }
      return { data: [], fromCache: true, error: e.message };
    }
  }

  // Try direct, then proxy, with shorter timeouts for poor connections
  async function fetchWithRetry(url) {
    try {
      return await fetchDirect(url);
    } catch (e) {
      return await fetchWithProxy(url);
    }
  }

  // Background refresh — updates cache silently
  async function refreshRegion(region, endpoint) {
    try {
      const raw = await fetchWithRetry(endpoint);
      setCachedData(region, raw);
    } catch (e) {
      // Silent fail — stale data remains in cache
    }
  }

  async function fetchAlberta() {
    return fetchRegion('AB', ENDPOINTS.AB, Cameras.normalizeAlberta);
  }

  async function fetchBC() {
    return fetchRegion('BC', ENDPOINTS.BC, Cameras.normalizeBC);
  }

  async function fetchWA() {
    if (!WSDOT_ACCESS_CODE) {
      const cached = getCachedData('WA');
      if (cached) return { data: Cameras.normalizeWA(cached.data), fromCache: true };
      const fallback = await fetchFallback('WA');
      if (fallback) {
        setCachedData('WA', fallback);
        return { data: Cameras.normalizeWA(fallback), fromCache: true };
      }
      return { data: [], fromCache: true, error: 'No WSDOT access code configured' };
    }

    const url = `${ENDPOINTS.WA}?AccessCode=${WSDOT_ACCESS_CODE}`;
    return fetchRegion('WA', url, Cameras.normalizeWA);
  }

  async function fetchAll() {
    const [ab, bc, wa] = await Promise.allSettled([
      fetchAlberta(),
      fetchBC(),
      fetchWA(),
    ]);

    const results = {
      AB: ab.status === 'fulfilled' ? ab.value : { data: [], error: ab.reason?.message },
      BC: bc.status === 'fulfilled' ? bc.value : { data: [], error: bc.reason?.message },
      WA: wa.status === 'fulfilled' ? wa.value : { data: [], error: wa.reason?.message },
    };

    const allCameras = [
      ...(results.AB.data || []),
      ...(results.BC.data || []),
      ...(results.WA.data || []),
    ];

    const anyFromCache = results.AB.fromCache || results.BC.fromCache || results.WA.fromCache;

    return { cameras: allCameras, results, anyFromCache };
  }

  // Clear cache and force refetch
  function clearCache() {
    for (const key of ['AB', 'BC', 'WA']) {
      delete memCache[key];
      try { localStorage.removeItem(`${CACHE_KEY}_${key}`); } catch (e) { /* ignore */ }
    }
  }

  // Fetch regions progressively, calling onRegion as each completes
  async function fetchProgressive(onRegion) {
    const fetchers = [
      fetchAlberta().then(r => { onRegion('AB', r); return r; }),
      fetchBC().then(r => { onRegion('BC', r); return r; }),
      fetchWA().then(r => { onRegion('WA', r); return r; }),
    ];
    await Promise.allSettled(fetchers);
  }

  return { fetchAll, fetchProgressive, clearCache };
})();
