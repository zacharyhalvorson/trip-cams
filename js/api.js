/* =============================================================
   api.js — Camera API registry, geocoding, CORS proxy + fallback
   ============================================================= */

const API = (() => {
  const CORS_PROXY = 'https://corsproxy.io/?url=';
  const CORS_PROXY_ALT = 'https://api.allorigins.win/raw?url=';

  // ── Camera API Registry ────────────────────────────────────────
  // Each entry: { url, normalizer, country, needsProxy }
  // normalizer is a string key resolved at fetch time (Cameras module)
  // IBI 511 regions all share the same normalizer as Alberta

  const CAMERA_REGISTRY = {
    // ── Canada: IBI 511 Platform (same format as Alberta) ──
    AB: { url: 'https://511.alberta.ca/api/v2/get/cameras', norm: 'normalizeAlberta', country: 'CA' },
    SK: { url: 'https://hotline.gov.sk.ca/api/v2/get/cameras', norm: 'normalizeIBI', country: 'CA' },
    MB: { url: 'https://www.manitoba511.ca/api/v2/get/cameras', norm: 'normalizeIBI', country: 'CA' },
    ON: { url: 'https://511on.ca/api/v2/get/cameras', norm: 'normalizeIBI', country: 'CA' },
    NB: { url: 'https://511.gnb.ca/api/v2/get/cameras', norm: 'normalizeIBI', country: 'CA' },
    NS: { url: 'https://511.novascotia.ca/api/v2/get/cameras', norm: 'normalizeIBI', country: 'CA' },
    PE: { url: 'https://511.gov.pe.ca/api/v2/get/cameras', norm: 'normalizeIBI', country: 'CA' },
    NL: { url: 'https://511nl.ca/api/v2/get/cameras', norm: 'normalizeIBI', country: 'CA' },
    YT: { url: 'https://511yukon.ca/api/v2/get/cameras', norm: 'normalizeIBI', country: 'CA' },

    // ── Canada: Other ──
    BC: { url: 'https://www.drivebc.ca/api/webcams/', norm: 'normalizeBC', country: 'CA' },
    QC: { url: 'https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson', norm: 'normalizeQC', country: 'CA' },

    // ── US: IBI 511 Platform ──
    NY: { url: 'https://511ny.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    GA: { url: 'https://511ga.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    WI: { url: 'https://511wi.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    LA: { url: 'https://511la.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    AZ: { url: 'https://az511.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    ID: { url: 'https://511.idaho.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    AK: { url: 'https://511.alaska.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    UT: { url: 'https://udottraffic.utah.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    NV: { url: 'https://nvroads.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    CT: { url: 'https://ctroads.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },

    // ── US: Custom formats ──
    WA: {
      urls: [
        'https://www.wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=75de6d3e-f4e0-4dc0-841f-11b95c1acc7e',
        'https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query?where=1%3D1&outFields=*&f=json',
        'https://www.wsdot.wa.gov/arcgis/rest/services/Production/WSDOTTrafficCameras/MapServer/0/query?where=1%3D1&outFields=*&f=json',
      ],
      norm: 'normalizeWA', country: 'US'
    },
    OR: { url: 'https://gis.odot.state.or.us/arcgis1006/rest/services/trip_check/Trip_Check_Terrain/MapServer/1/query?where=1%3D1&outFields=*&f=json', norm: 'normalizeArcGIS', country: 'US' },
    MD: { url: 'https://chart.maryland.gov/DataFeeds/GetCamerasJson', norm: 'normalizeMD', country: 'US' },
    OH: { url: 'https://publicapi.ohgo.com/api/v1/cameras', norm: 'normalizeOH', country: 'US' },
    ND: { url: 'https://travelfiles.dot.nd.gov/geojson_nc/cameras.json', norm: 'normalizeND', country: 'US' },

    // ── US: ArcGIS Feature Services ──
    WY: { url: 'https://map.wyoroad.info/ags/rest/services/WTIMAP/WebCameras_v2/MapServer/0/query?where=1%3D1&outFields=*&f=json', norm: 'normalizeArcGIS', country: 'US' },
    KY: { url: 'https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/Ky_WebCams_WGS84WM/MapServer/0/query?where=1%3D1&outFields=*&f=json', norm: 'normalizeArcGIS', country: 'US' },
    DE: { url: 'https://enterprise.firstmaptest.delaware.gov/arcgis/rest/services/Transportation/DE_TMC_Traffic_Feeds/FeatureServer/1/query?where=1%3D1&outFields=*&f=json', norm: 'normalizeArcGIS', country: 'US' },

    // ── US: California per-district ──
    CA: { url: null, norm: 'normalizeCA', country: 'US', multiDistrict: true },
  };

  // California district endpoints and their approximate bounding boxes
  const CA_DISTRICTS = [
    { id: 1, url: 'https://cwwp2.dot.ca.gov/data/d1/cctv/cctvStatusD01.json', lat: [38.5, 42.0], lon: [-124.4, -122.0] },
    { id: 2, url: 'https://cwwp2.dot.ca.gov/data/d2/cctv/cctvStatusD02.json', lat: [39.0, 42.0], lon: [-123.0, -120.0] },
    { id: 3, url: 'https://cwwp2.dot.ca.gov/data/d3/cctv/cctvStatusD03.json', lat: [38.0, 40.5], lon: [-122.5, -119.5] },
    { id: 4, url: 'https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json', lat: [37.0, 38.5], lon: [-123.0, -121.0] },
    { id: 5, url: 'https://cwwp2.dot.ca.gov/data/d5/cctv/cctvStatusD05.json', lat: [34.5, 37.5], lon: [-122.0, -119.0] },
    { id: 6, url: 'https://cwwp2.dot.ca.gov/data/d6/cctv/cctvStatusD06.json', lat: [35.5, 38.5], lon: [-121.0, -118.5] },
    { id: 7, url: 'https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json', lat: [33.5, 34.8], lon: [-118.8, -117.0] },
    { id: 8, url: 'https://cwwp2.dot.ca.gov/data/d8/cctv/cctvStatusD08.json', lat: [33.5, 35.5], lon: [-117.8, -114.1] },
    { id: 9, url: 'https://cwwp2.dot.ca.gov/data/d9/cctv/cctvStatusD09.json', lat: [35.0, 38.0], lon: [-119.5, -117.0] },
    { id: 10, url: 'https://cwwp2.dot.ca.gov/data/d10/cctv/cctvStatusD10.json', lat: [37.0, 38.5], lon: [-122.0, -119.5] },
    { id: 11, url: 'https://cwwp2.dot.ca.gov/data/d11/cctv/cctvStatusD11.json', lat: [32.5, 33.5], lon: [-117.6, -115.5] },
    { id: 12, url: 'https://cwwp2.dot.ca.gov/data/d12/cctv/cctvStatusD12.json', lat: [33.5, 34.5], lon: [-118.5, -117.0] },
  ];

  // ── Caching ────────────────────────────────────────────────────

  const CACHE_KEY = 'tripcams_cache';
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Simple in-memory + localStorage cache
  const memCache = {};

  function getCachedData(region) {
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

  // ── Network helpers ────────────────────────────────────────────

  // Parse JSON, JSONP callback, or JS variable assignment
  async function parseJSON(resp) {
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      // JSONP: callback({...})
      const jsonp = text.match(/^\s*\w+\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*$/);
      if (jsonp) return JSON.parse(jsonp[1]);
      // JS assignment: var name = {...};
      const assign = text.match(/^\s*(?:var|let|const)\s+\w+\s*=\s*([\s\S]*?)\s*;?\s*$/);
      if (assign) return JSON.parse(assign[1]);
      throw e;
    }
  }

  function getTimeouts() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const slow = conn && (conn.saveData || ['slow-2g', '2g', '3g'].includes(conn.effectiveType));
    return { direct: slow ? 20000 : 10000, proxy: slow ? 25000 : 15000 };
  }

  async function fetchWithProxy(url, options = {}) {
    const proxied = CORS_PROXY + encodeURIComponent(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getTimeouts().proxy);
    try {
      const resp = await fetch(proxied, { ...options, signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await parseJSON(resp);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchDirect(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getTimeouts().direct);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await parseJSON(resp);
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

  async function fetchWithAltProxy(url, options = {}) {
    const proxied = CORS_PROXY_ALT + encodeURIComponent(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getTimeouts().proxy);
    try {
      const resp = await fetch(proxied, { ...options, signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await parseJSON(resp);
    } finally {
      clearTimeout(timeout);
    }
  }

  // Try direct, then primary proxy, then alt proxy
  async function fetchWithRetry(url) {
    try {
      return await fetchDirect(url);
    } catch (e) {
      try {
        return await fetchWithProxy(url);
      } catch (e2) {
        return await fetchWithAltProxy(url);
      }
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

  // ── Region fetching ────────────────────────────────────────────

  // Get the normalizer function for a region
  function getNormalizer(region) {
    const entry = CAMERA_REGISTRY[region];
    if (!entry) return (d) => [];
    const normName = entry.norm;
    // normalizeIBI is the generic IBI 511 normalizer that takes a region code
    if (normName === 'normalizeIBI') return (d) => Cameras.normalizeIBI(d, region);
    if (normName === 'normalizeAlberta') return Cameras.normalizeAlberta;
    if (normName === 'normalizeBC') return Cameras.normalizeBC;
    if (normName === 'normalizeWA') return Cameras.normalizeWA;
    if (normName === 'normalizeQC') return Cameras.normalizeQC;
    if (normName === 'normalizeMD') return Cameras.normalizeMD;
    if (normName === 'normalizeOH') return Cameras.normalizeOH;
    if (normName === 'normalizeND') return Cameras.normalizeND;
    if (normName === 'normalizeArcGIS') return (d) => Cameras.normalizeArcGIS(d, region);
    if (normName === 'normalizeCA') return Cameras.normalizeCA;
    return (d) => [];
  }

  // Generic fetch for a region: stale-while-revalidate pattern
  async function fetchRegion(region, endpoint, normalizer) {
    const cached = getCachedData(region);

    // Fresh cache — return immediately
    if (cached && cached.fresh) {
      return { data: normalizer(cached.data), fromCache: true };
    }

    // Stale cache exists — return it but refresh in background
    if (cached && !cached.fresh) {
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
        setCachedData(region, fallback);
        return { data: normalizer(fallback), fromCache: true };
      }
      return { data: [], fromCache: true, error: e.message };
    }
  }

  // Store route geometry for California district optimization
  let _currentRouteGeometry = null;
  function setRouteGeometry(geometry) { _currentRouteGeometry = geometry; }

  // Fetch a single registered region
  async function fetchRegisteredRegion(region) {
    const entry = CAMERA_REGISTRY[region];
    if (!entry) return { data: [], fromCache: true, error: 'Unknown region' };

    const normalizer = getNormalizer(region);

    // Special case: California multi-district
    if (entry.multiDistrict && region === 'CA') {
      return fetchCalifornia(normalizer, _currentRouteGeometry);
    }

    // Support entries with multiple fallback URLs
    if (entry.urls) {
      return fetchRegionMultiUrl(region, entry.urls, normalizer);
    }
    return fetchRegion(region, entry.url, normalizer);
  }

  // Try multiple endpoint URLs in sequence until one succeeds
  async function fetchRegionMultiUrl(region, urls, normalizer) {
    const cached = getCachedData(region);
    if (cached && cached.fresh) {
      return { data: normalizer(cached.data), fromCache: true };
    }
    if (cached && !cached.fresh) {
      // Stale cache — return it, refresh in background
      (async () => {
        for (const url of urls) {
          try {
            const raw = await fetchWithRetry(url);
            setCachedData(region, raw);
            return;
          } catch (e) { /* try next URL */ }
        }
      })();
      return { data: normalizer(cached.data), fromCache: true, stale: true };
    }
    // No cache — try each URL
    for (const url of urls) {
      try {
        const raw = await fetchWithRetry(url);
        setCachedData(region, raw);
        return { data: normalizer(raw), fromCache: false };
      } catch (e) { /* try next URL */ }
    }
    // All URLs failed — try fallback file
    console.warn(`${region} all API URLs failed, using fallback`);
    const fallback = await fetchFallback(region);
    if (fallback) {
      setCachedData(region, fallback);
      return { data: normalizer(fallback), fromCache: true };
    }
    return { data: [], fromCache: true, error: 'All endpoints failed' };
  }

  // California: fetch only relevant districts, merge results
  async function fetchCalifornia(normalizer, routeGeometry) {
    const cached = getCachedData('CA');
    if (cached && cached.fresh) {
      return { data: normalizer(cached.data), fromCache: true };
    }

    // Determine which districts to fetch based on route geometry
    let districts = CA_DISTRICTS;
    if (routeGeometry && routeGeometry.length > 0) {
      districts = CA_DISTRICTS.filter(d => {
        // Check if any route point falls within district bounds
        for (let i = 0; i < routeGeometry.length; i += Math.max(1, Math.floor(routeGeometry.length / 50))) {
          const p = routeGeometry[i];
          if (p.lat >= d.lat[0] && p.lat <= d.lat[1] && p.lon >= d.lon[0] && p.lon <= d.lon[1]) {
            return true;
          }
        }
        return false;
      });
      if (districts.length === 0) districts = CA_DISTRICTS; // fallback to all
    }

    if (cached && !cached.fresh) {
      // Stale — return stale, refresh in background
      Promise.allSettled(districts.map(d => fetchWithRetry(d.url).catch(() => null)))
        .then(results => {
          const merged = results.flatMap(r => r.status === 'fulfilled' && r.value ? (Array.isArray(r.value) ? r.value : (r.value.data || [])) : []);
          if (merged.length > 0) setCachedData('CA', merged);
        });
      return { data: normalizer(cached.data), fromCache: true, stale: true };
    }

    // No cache — fetch districts
    try {
      const results = await Promise.allSettled(districts.map(d => fetchWithRetry(d.url)));
      const merged = results.flatMap(r => r.status === 'fulfilled' && r.value ? (Array.isArray(r.value) ? r.value : (r.value.data || [])) : []);
      if (merged.length > 0) setCachedData('CA', merged);
      return { data: normalizer(merged), fromCache: false };
    } catch (e) {
      const fallback = await fetchFallback('CA');
      if (fallback) {
        setCachedData('CA', fallback);
        return { data: normalizer(fallback), fromCache: true };
      }
      return { data: [], fromCache: true, error: e.message };
    }
  }

  // ── Progressive fetching ───────────────────────────────────────

  // Fetch regions progressively, calling onRegion as each completes
  // neededRegions: Set of region codes to fetch
  // Batches requests to avoid overwhelming connections (max 4 concurrent)
  async function fetchProgressive(onRegion, neededRegions) {
    const regions = neededRegions
      ? [...neededRegions].filter(r => CAMERA_REGISTRY[r])
      : Object.keys(CAMERA_REGISTRY);

    if (regions.length === 0) return;

    const BATCH_SIZE = 4;
    for (let i = 0; i < regions.length; i += BATCH_SIZE) {
      const batch = regions.slice(i, i + BATCH_SIZE);
      const fetchers = batch.map(key =>
        fetchRegisteredRegion(key)
          .then(r => { onRegion(key, r); return r; })
          .catch(e => { onRegion(key, { data: [], fromCache: true, error: e.message }); })
      );
      await Promise.allSettled(fetchers);
    }
  }

  // Return cached data synchronously for instant display (no network)
  function getCachedImmediate(neededRegions) {
    const regions = neededRegions
      ? [...neededRegions].filter(r => CAMERA_REGISTRY[r])
      : Object.keys(CAMERA_REGISTRY);

    let cameras = [];
    let anyFound = false;
    for (const key of regions) {
      const cached = getCachedData(key);
      if (cached) {
        const normalizer = getNormalizer(key);
        cameras = cameras.concat(normalizer(cached.data));
        anyFound = true;
      }
    }
    return anyFound ? cameras : null;
  }

  // Clear cache for all known regions
  function clearCache() {
    for (const key of Object.keys(CAMERA_REGISTRY)) {
      delete memCache[key];
      try { localStorage.removeItem(`${CACHE_KEY}_${key}`); } catch (e) { /* ignore */ }
    }
  }

  // Check if a region has camera support in the registry
  function hasRegion(code) {
    return code in CAMERA_REGISTRY;
  }

  // Get all supported region codes
  function getSupportedRegions() {
    return new Set(Object.keys(CAMERA_REGISTRY));
  }

  // ── Region detection from route geometry ───────────────────────

  let _regionBounds = null;

  async function loadRegionBounds() {
    if (_regionBounds) return _regionBounds;
    try {
      const resp = await fetch('data/region-bounds.json');
      if (resp.ok) {
        _regionBounds = await resp.json();
        return _regionBounds;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // Given OSRM route geometry (array of {lat, lon}), determine which
  // registered camera regions the route passes through.
  // Samples geometry at intervals for performance.
  async function getRegionsForRoute(geometry) {
    const bounds = await loadRegionBounds();
    if (!bounds || geometry.length === 0) return new Set();

    const found = new Set();
    const supported = getSupportedRegions();

    // Sample every Nth point for performance (at least 50 samples)
    const step = Math.max(1, Math.floor(geometry.length / 50));

    // Build flat list of region bounds for iteration
    const allRegions = [];
    for (const [country, regions] of Object.entries(bounds)) {
      for (const [code, data] of Object.entries(regions)) {
        if (supported.has(code)) {
          allRegions.push({ code, latMin: data.lat[0], latMax: data.lat[1], lonMin: data.lon[0], lonMax: data.lon[1] });
        }
      }
    }

    for (let i = 0; i < geometry.length; i += step) {
      const p = geometry[i];
      for (const r of allRegions) {
        if (!found.has(r.code) && p.lat >= r.latMin && p.lat <= r.latMax && p.lon >= r.lonMin && p.lon <= r.lonMax) {
          found.add(r.code);
        }
      }
    }
    // Always check last point
    const last = geometry[geometry.length - 1];
    for (const r of allRegions) {
      if (!found.has(r.code) && last.lat >= r.latMin && last.lat <= r.latMax && last.lon >= r.lonMin && last.lon <= r.lonMax) {
        found.add(r.code);
      }
    }

    return found;
  }

  // ── Geocoding (Photon / Komoot) ────────────────────────────────

  const PHOTON_URL = 'https://photon.komoot.io';
  const GEOCODE_CACHE = new Map(); // query -> results (session-only)
  let _geocodeAbort = null;

  // Bounding box for US + Canada
  const NA_BOUNDS = { latMin: 24.5, latMax: 72.0, lonMin: -170.0, lonMax: -50.0 };

  // Search for cities/towns matching query
  async function fetchGeocode(query, biasLat, biasLon) {
    const q = query.trim();
    if (q.length < 2) return [];

    // Check session cache
    const cacheKey = `${q}|${biasLat?.toFixed(1)}|${biasLon?.toFixed(1)}`;
    if (GEOCODE_CACHE.has(cacheKey)) return GEOCODE_CACHE.get(cacheKey);

    // Cancel previous in-flight request
    if (_geocodeAbort) _geocodeAbort.abort();
    _geocodeAbort = new AbortController();

    const params = new URLSearchParams({
      q,
      limit: '8',
      lang: 'en',
    });
    // Add place type filters
    params.append('osm_tag', 'place:city');
    params.append('osm_tag', 'place:town');

    if (biasLat != null && biasLon != null) {
      params.set('lat', biasLat.toFixed(4));
      params.set('lon', biasLon.toFixed(4));
    }

    try {
      const resp = await fetch(`${PHOTON_URL}/api/?${params}`, { signal: _geocodeAbort.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      let results = (data.features || [])
        .filter(f => {
          const c = f.geometry?.coordinates;
          if (!c) return false;
          // Filter to North America bounding box
          return c[1] >= NA_BOUNDS.latMin && c[1] <= NA_BOUNDS.latMax &&
                 c[0] >= NA_BOUNDS.lonMin && c[0] <= NA_BOUNDS.lonMax;
        })
        .map(f => photonToLocation(f));

      // Deduplicate by name+region
      const seen = new Set();
      results = results.filter(r => {
        const key = `${r.name}|${r.region}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      GEOCODE_CACHE.set(cacheKey, results);
      return results;
    } catch (e) {
      if (e.name === 'AbortError') return []; // Cancelled, not an error
      console.warn('Geocode failed:', e.message);
      return [];
    }
  }

  // Fallback search without place type filter (for addresses)
  async function fetchGeocodeFallback(query, biasLat, biasLon) {
    const q = query.trim();
    if (q.length < 2) return [];

    const cacheKey = `fallback:${q}|${biasLat?.toFixed(1)}|${biasLon?.toFixed(1)}`;
    if (GEOCODE_CACHE.has(cacheKey)) return GEOCODE_CACHE.get(cacheKey);

    if (_geocodeAbort) _geocodeAbort.abort();
    _geocodeAbort = new AbortController();

    const params = new URLSearchParams({ q, limit: '8', lang: 'en' });
    if (biasLat != null && biasLon != null) {
      params.set('lat', biasLat.toFixed(4));
      params.set('lon', biasLon.toFixed(4));
    }

    try {
      const resp = await fetch(`${PHOTON_URL}/api/?${params}`, { signal: _geocodeAbort.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      // Extract city from each result and deduplicate
      const citySet = new Map(); // "city|state" -> location
      for (const f of (data.features || [])) {
        const c = f.geometry?.coordinates;
        if (!c) continue;
        if (c[1] < NA_BOUNDS.latMin || c[1] > NA_BOUNDS.latMax || c[0] < NA_BOUNDS.lonMin || c[0] > NA_BOUNDS.lonMax) continue;

        const props = f.properties || {};
        const cityName = props.city || props.county || props.name;
        const state = props.state;
        const country = props.countrycode?.toUpperCase();
        if (!cityName || !state || (country !== 'US' && country !== 'CA')) continue;

        const region = resolveRegionCode(state, country);
        const key = `${cityName}|${region}`;
        if (!citySet.has(key)) {
          citySet.set(key, {
            id: `custom-${slugify(cityName)}-${region}`,
            name: cityName,
            region: region,
            country: country,
            lat: c[1],
            lon: c[0],
            source: 'geocode',
            displayName: `${cityName}, ${region}`,
            isNearestCity: true,
          });
        }
      }

      const results = [...citySet.values()].slice(0, 5);
      GEOCODE_CACHE.set(cacheKey, results);
      return results;
    } catch (e) {
      if (e.name === 'AbortError') return [];
      return [];
    }
  }

  // Reverse geocode: lat/lon -> nearest city
  async function reverseGeocode(lat, lon) {
    const cacheKey = `rev:${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (GEOCODE_CACHE.has(cacheKey)) return GEOCODE_CACHE.get(cacheKey);

    try {
      const resp = await fetch(`${PHOTON_URL}/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
      if (!resp.ok) return null;
      const data = await resp.json();
      const features = data.features || [];
      if (features.length === 0) return null;

      // Find the first result that has a city name
      for (const f of features) {
        const props = f.properties || {};
        const cityName = props.city || props.town || props.name;
        if (cityName) {
          const result = photonToLocation(f);
          // Use the actual requested coordinates (more accurate than reverse result)
          result.lat = lat;
          result.lon = lon;
          result.source = 'geolocation';
          GEOCODE_CACHE.set(cacheKey, result);
          return result;
        }
      }
      return null;
    } catch (e) {
      console.warn('Reverse geocode failed:', e.message);
      return null;
    }
  }

  // Convert a Photon GeoJSON feature to our location object
  function photonToLocation(feature) {
    const props = feature.properties || {};
    const coords = feature.geometry.coordinates;
    const country = (props.countrycode || '').toUpperCase();
    const state = props.state || '';
    const region = resolveRegionCode(state, country);
    const name = props.city || props.town || props.name || 'Unknown';

    return {
      id: `custom-${slugify(name)}-${region}`,
      name,
      region,
      country: country === 'CA' ? 'CA' : 'US',
      lat: coords[1],
      lon: coords[0],
      source: 'geocode',
      displayName: `${name}, ${region}`,
    };
  }

  // Resolve a state/province name to its 2-letter code
  function resolveRegionCode(stateName, countryCode) {
    const name = stateName.toLowerCase().trim();
    // Check if already a valid 2-letter code
    if (stateName.length === 2 && /^[A-Z]{2}$/.test(stateName)) return stateName;

    const US_STATES = {
      'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
      'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
      'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
      'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
      'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
      'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
      'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
      'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
      'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
      'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
      'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
      'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
      'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
    };
    const CA_PROVINCES = {
      'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
      'new brunswick': 'NB', 'newfoundland and labrador': 'NL', 'newfoundland': 'NL',
      'nova scotia': 'NS', 'ontario': 'ON', 'prince edward island': 'PE',
      'quebec': 'QC', 'québec': 'QC', 'saskatchewan': 'SK',
      'northwest territories': 'NT', 'nunavut': 'NU', 'yukon': 'YT',
    };

    if (countryCode === 'CA') return CA_PROVINCES[name] || stateName.toUpperCase().slice(0, 2);
    return US_STATES[name] || stateName.toUpperCase().slice(0, 2);
  }

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  // ── Public API ─────────────────────────────────────────────────

  return {
    fetchProgressive,
    clearCache,
    getCachedImmediate,
    hasRegion,
    getSupportedRegions,
    getRegionsForRoute,
    loadRegionBounds,
    fetchGeocode,
    fetchGeocodeFallback,
    reverseGeocode,
    setRouteGeometry,
    CAMERA_REGISTRY,
  };
})();
