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

  function getCachedData(region) {
    if (memCache[region] && Date.now() - memCache[region].ts < CACHE_DURATION) {
      return memCache[region].data;
    }
    try {
      const stored = localStorage.getItem(`${CACHE_KEY}_${region}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Date.now() - parsed.ts < CACHE_DURATION) {
          memCache[region] = parsed;
          return parsed.data;
        }
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

  async function fetchAlberta() {
    const cached = getCachedData('AB');
    if (cached) return { data: Cameras.normalizeAlberta(cached), fromCache: true };

    try {
      // Try direct first, then proxy
      let raw;
      try {
        raw = await fetchDirect(ENDPOINTS.AB);
      } catch (e) {
        raw = await fetchWithProxy(ENDPOINTS.AB);
      }
      setCachedData('AB', raw);
      return { data: Cameras.normalizeAlberta(raw), fromCache: false };
    } catch (e) {
      console.warn('Alberta API failed, using fallback:', e.message);
      const fallback = await fetchFallback('AB');
      if (fallback) return { data: Cameras.normalizeAlberta(fallback), fromCache: true };
      return { data: [], fromCache: true, error: e.message };
    }
  }

  async function fetchBC() {
    const cached = getCachedData('BC');
    if (cached) return { data: Cameras.normalizeBC(cached), fromCache: true };

    try {
      let raw;
      try {
        raw = await fetchDirect(ENDPOINTS.BC);
      } catch (e) {
        raw = await fetchWithProxy(ENDPOINTS.BC);
      }
      setCachedData('BC', raw);
      return { data: Cameras.normalizeBC(raw), fromCache: false };
    } catch (e) {
      console.warn('BC API failed, using fallback:', e.message);
      const fallback = await fetchFallback('BC');
      if (fallback) return { data: Cameras.normalizeBC(fallback), fromCache: true };
      return { data: [], fromCache: true, error: e.message };
    }
  }

  async function fetchWA() {
    if (!WSDOT_ACCESS_CODE) {
      // No API key configured, use fallback only
      const fallback = await fetchFallback('WA');
      if (fallback) return { data: Cameras.normalizeWA(fallback), fromCache: true };
      return { data: [], fromCache: true, error: 'No WSDOT access code configured' };
    }

    const cached = getCachedData('WA');
    if (cached) return { data: Cameras.normalizeWA(cached), fromCache: true };

    try {
      const url = `${ENDPOINTS.WA}?AccessCode=${WSDOT_ACCESS_CODE}`;
      let raw;
      try {
        raw = await fetchDirect(url);
      } catch (e) {
        raw = await fetchWithProxy(url);
      }
      setCachedData('WA', raw);
      return { data: Cameras.normalizeWA(raw), fromCache: false };
    } catch (e) {
      console.warn('WSDOT API failed, using fallback:', e.message);
      const fallback = await fetchFallback('WA');
      if (fallback) return { data: Cameras.normalizeWA(fallback), fromCache: true };
      return { data: [], fromCache: true, error: e.message };
    }
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

  return { fetchAll, clearCache };
})();
