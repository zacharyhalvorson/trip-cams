/* =============================================================
   api.js — Camera API registry, geocoding, CORS proxy + fallback
   ============================================================= */

const API = (() => {
  // Self-hosted Cloudflare Worker proxy (deploy cors-proxy/ to your account)
  // Set to your worker URL, e.g. 'https://trip-cams-cors.<you>.workers.dev'
  const SELF_PROXY = 'https://trip-cams-cors.road-trip-cameras-app.workers.dev';

  const CORS_PROXIES = [
    // Self-hosted proxy is first when configured — most reliable, no rate limits
    ...(SELF_PROXY ? [url => `${SELF_PROXY}/?${url}`] : []),
    url => `https://proxy.corsfix.com/?${url}`,
    url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];

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
    NJ: { url: 'https://511nj.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    PA: { url: 'https://511pa.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    CT: { url: 'https://ctroads.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    GA: { url: 'https://511ga.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    FL: { url: 'https://fl511.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    SC: { url: 'https://511sc.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    WI: { url: 'https://511wi.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    LA: { url: 'https://511la.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    MN: { url: 'https://511mn.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    IA: { url: 'https://511ia.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    NE: { url: 'https://511.nebraska.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    AZ: { url: 'https://az511.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    CO: { url: 'https://www.cotrip.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    NM: { url: 'https://nmroads.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    MT: { url: 'https://www.511mt.net/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    ID: { url: 'https://511.idaho.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    AK: { url: 'https://511.alaska.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    UT: { url: 'https://udottraffic.utah.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    NV: { url: 'https://nvroads.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    MA: { url: 'https://mass511.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    IN: { url: 'https://511in.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    IL: { url: 'https://www.gettingaroundillinois.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    WV: { url: 'https://wv511.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },

    // ── US: IBI 511 — regional / less certain ──
    // These use the standard IBI pattern; the app degrades gracefully if they don't respond.
    VT: { url: 'https://www.newengland511.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    NH: { url: 'https://www.newengland511.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    ME: { url: 'https://www.newengland511.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    SD: { url: 'https://www.sd511.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    KS: { url: 'https://kandrive.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    OK: { url: 'https://oktraffic.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    VA: { url: 'https://www.511virginia.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    NC: { url: 'https://drivenc.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    TN: { url: 'https://smartway.tn.gov/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    MO: { url: 'https://traveler.modot.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    MI: { url: 'https://mi511.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    AL: { url: 'https://algotraffic.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    MS: { url: 'https://mdottraffic.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    AR: { url: 'https://idrivearkansas.com/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },
    TX: { url: 'https://drivetexas.org/api/v2/get/cameras', norm: 'normalizeIBI', country: 'US' },

    // ── US: Custom formats ──
    WA: {
      urls: [
        // Primary: static JSON file, no auth required, most reliable
        'https://data.wsdot.wa.gov/mobile/Cameras.json',
        // Secondary: ArcGIS FeatureServer, no auth, standard format
        // outSR=4326 requests WGS84 lat/lon (default is Web Mercator 3857)
        'https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json',
      ],
      norm: 'normalizeWA', country: 'US'
    },
    OR: { url: 'https://gis.odot.state.or.us/arcgis1006/rest/services/trip_check/Trip_Check_Terrain/MapServer/1/query?where=1%3D1&outFields=*&outSR=4326&f=json', norm: 'normalizeArcGIS', country: 'US' },
    MD: { url: 'https://chart.maryland.gov/DataFeeds/GetCamerasJson', norm: 'normalizeMD', country: 'US' },
    OH: { url: 'https://publicapi.ohgo.com/api/v1/cameras', norm: 'normalizeOH', country: 'US' },
    ND: { url: 'https://travelfiles.dot.nd.gov/geojson_nc/cameras.json', norm: 'normalizeND', country: 'US' },

    // ── US: ArcGIS Feature Services ──
    WY: { url: 'https://map.wyoroad.info/ags/rest/services/WTIMAP/WebCameras_v2/MapServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json', norm: 'normalizeArcGIS', country: 'US' },
    KY: { url: 'https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/Ky_WebCams_WGS84WM/MapServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json', norm: 'normalizeArcGIS', country: 'US' },
    DE: { url: 'https://enterprise.firstmaptest.delaware.gov/arcgis/rest/services/Transportation/DE_TMC_Traffic_Feeds/FeatureServer/1/query?where=1%3D1&outFields=*&f=json', norm: 'normalizeArcGIS', country: 'US' },

    // ── US: California per-district ──
    CA: { url: null, norm: 'normalizeCA', country: 'US', multiDistrict: true },
  };

  // ── Incident / Event API Registry ──────────────────────────────
  // IBI 511 platforms expose /api/v2/get/event with the same auth pattern.
  // Other sources use their own formats.
  const INCIDENT_REGISTRY = {
    // Canada — IBI 511
    AB: { url: 'https://511.alberta.ca/api/v2/get/event' },
    SK: { url: 'https://hotline.gov.sk.ca/api/v2/get/event' },
    MB: { url: 'https://www.manitoba511.ca/api/v2/get/event' },
    ON: { url: 'https://511on.ca/api/v2/get/event' },
    NB: { url: 'https://511.gnb.ca/api/v2/get/event' },
    NS: { url: 'https://511.novascotia.ca/api/v2/get/event' },
    PE: { url: 'https://511.gov.pe.ca/api/v2/get/event' },
    NL: { url: 'https://511nl.ca/api/v2/get/event' },
    YT: { url: 'https://511yukon.ca/api/v2/get/event' },
    // Canada — DriveBC
    BC: { url: 'https://www.drivebc.ca/api/events/' },
    // US — IBI 511
    NY: { url: 'https://511ny.org/api/v2/get/event' },
    NJ: { url: 'https://511nj.org/api/v2/get/event' },
    PA: { url: 'https://511pa.com/api/v2/get/event' },
    CT: { url: 'https://ctroads.com/api/v2/get/event' },
    GA: { url: 'https://511ga.org/api/v2/get/event' },
    FL: { url: 'https://fl511.com/api/v2/get/event' },
    SC: { url: 'https://511sc.org/api/v2/get/event' },
    WI: { url: 'https://511wi.gov/api/v2/get/event' },
    LA: { url: 'https://511la.org/api/v2/get/event' },
    MN: { url: 'https://511mn.org/api/v2/get/event' },
    IA: { url: 'https://511ia.org/api/v2/get/event' },
    NE: { url: 'https://511.nebraska.gov/api/v2/get/event' },
    AZ: { url: 'https://az511.com/api/v2/get/event' },
    CO: { url: 'https://www.cotrip.org/api/v2/get/event' },
    NM: { url: 'https://nmroads.com/api/v2/get/event' },
    MT: { url: 'https://www.511mt.net/api/v2/get/event' },
    ID: { url: 'https://511.idaho.gov/api/v2/get/event' },
    AK: { url: 'https://511.alaska.gov/api/v2/get/event' },
    UT: { url: 'https://udottraffic.utah.gov/api/v2/get/event' },
    NV: { url: 'https://nvroads.com/api/v2/get/event' },
    MA: { url: 'https://mass511.com/api/v2/get/event' },
    IN: { url: 'https://511in.org/api/v2/get/event' },
    IL: { url: 'https://www.gettingaroundillinois.com/api/v2/get/event' },
    WV: { url: 'https://wv511.org/api/v2/get/event' },
    VT: { url: 'https://www.newengland511.org/api/v2/get/event' },
    NH: { url: 'https://www.newengland511.org/api/v2/get/event' },
    ME: { url: 'https://www.newengland511.org/api/v2/get/event' },
    SD: { url: 'https://www.sd511.org/api/v2/get/event' },
    KS: { url: 'https://kandrive.gov/api/v2/get/event' },
    OK: { url: 'https://oktraffic.org/api/v2/get/event' },
    VA: { url: 'https://www.511virginia.org/api/v2/get/event' },
    NC: { url: 'https://drivenc.gov/api/v2/get/event' },
    TN: { url: 'https://smartway.tn.gov/api/v2/get/event' },
    MO: { url: 'https://traveler.modot.org/api/v2/get/event' },
    MI: { url: 'https://mi511.org/api/v2/get/event' },
    AL: { url: 'https://algotraffic.com/api/v2/get/event' },
    MS: { url: 'https://mdottraffic.com/api/v2/get/event' },
    AR: { url: 'https://idrivearkansas.com/api/v2/get/event' },
    TX: { url: 'https://drivetexas.org/api/v2/get/event' },
    // US — Custom formats
    WA: { url: 'https://data.wsdot.wa.gov/mobile/HighwayAlerts.json' },
    OR: { url: 'https://tripcheck.com/Scripts/map/data/incidents.js' },
    MD: { url: 'https://chart.maryland.gov/DataFeeds/GetEventsJson' },
    OH: { url: 'https://publicapi.ohgo.com/api/v1/incidents' },
  };

  // Field mappings per source format — each maps to the normalized shape:
  // { id, region, lat, lon, title, description, severity, road, startTime, lastUpdated }
  // Values are arrays of candidate property names tried in order (first truthy wins).
  const EVENT_FIELDS = {
    ibi: {
      unwrap: ['body', 'events', 'data'],
      id: ['Id', 'id', 'ID'], lat: ['Latitude', 'latitude'], lon: ['Longitude', 'longitude'],
      title: ['Headline', 'EventType', 'headline'], description: ['Description', 'EventSubType', 'description'],
      severity: ['Severity', 'severity'], road: ['RoadwayName', 'Roads', 'roadway'],
      startTime: ['StartDate', 'StartTime', 'startDate'], lastUpdated: ['LastUpdated', 'lastUpdated'],
    },
    bc: {
      unwrap: ['events'],
      id: ['id'], lat: ['latitude'], lon: ['longitude'],
      title: ['headline', 'event_type'], description: ['description'],
      severity: ['severity'], road: ['route', 'highway'],
      startTime: ['start'], lastUpdated: ['last_updated'],
    },
    wa: {
      unwrap: [],
      id: ['AlertID'], lat: ['StartPoint.Latitude'], lon: ['StartPoint.Longitude'],
      title: ['HeadlineDescription', 'EventCategory'], description: ['ExtendedDescription'],
      severity: ['Priority'], road: ['Region'],
      startTime: ['StartTime'], lastUpdated: ['LastUpdatedTime'],
    },
    or: {
      unwrap: ['incidents', 'item'],
      id: ['id', 'incidentId'], lat: ['lat', 'latitude'], lon: ['lon', 'lng', 'longitude'],
      title: ['type', 'incidentType'], description: ['description', 'details'],
      severity: ['severity'], road: ['road', 'route', 'highway'],
      startTime: ['startTime', 'start'], lastUpdated: ['lastUpdated'],
    },
    md: {
      unwrap: ['events'],
      id: ['id', 'Id'], lat: ['latitude', 'Latitude'], lon: ['longitude', 'Longitude'],
      title: ['description', 'Description', 'eventType'], description: ['details', 'Details'],
      severity: ['severity', 'Severity'], road: ['roadName', 'RoadName', 'road'],
      startTime: ['startDate', 'StartDate'], lastUpdated: ['lastUpdated', 'LastUpdated'],
    },
    oh: {
      unwrap: ['results', 'incidents'],
      id: ['id'], lat: ['latitude'], lon: ['longitude'],
      title: ['category', 'type'], description: ['description'],
      severity: ['severity'], road: ['roadName', 'route'],
      startTime: ['startDate'], lastUpdated: ['lastUpdated'],
    },
  };

  // Resolve a dotted path like 'StartPoint.Latitude' on an object
  function _resolveField(obj, path) {
    const parts = path.split('.');
    let val = obj;
    for (const p of parts) {
      if (val == null) return undefined;
      val = val[p];
    }
    return val;
  }

  // Pick the first truthy value from candidate field names
  function _pick(obj, fields) {
    for (const f of fields) {
      const v = _resolveField(obj, f);
      if (v != null && v !== '') return v;
    }
    return undefined;
  }

  function normalizeEvents(data, region, format) {
    if (!data) return [];
    const fields = EVENT_FIELDS[format] || EVENT_FIELDS.ibi;

    // Unwrap: try each candidate wrapper property, fall back to raw array
    let events = Array.isArray(data) ? data : null;
    if (!events) {
      for (const key of fields.unwrap) {
        if (data[key]) { events = data[key]; break; }
      }
      events = events || [];
    }

    return events.filter(e => e && _pick(e, fields.lat) && _pick(e, fields.lon)).map(e => ({
      id: `${region}-evt-${_pick(e, fields.id) || Math.random().toString(36).slice(2)}`,
      region,
      lat: parseFloat(_pick(e, fields.lat)),
      lon: parseFloat(_pick(e, fields.lon)),
      title: _pick(e, fields.title) || 'Incident',
      description: _pick(e, fields.description) || '',
      severity: (_pick(e, fields.severity) || '').toLowerCase(),
      road: _pick(e, fields.road) || '',
      startTime: _pick(e, fields.startTime) || null,
      lastUpdated: _pick(e, fields.lastUpdated) || null,
    }));
  }

  // Map region codes to their normalizer format key
  const INCIDENT_FORMAT = {
    BC: 'bc', WA: 'wa', OR: 'or', MD: 'md', OH: 'oh',
    // All others use 'ibi' (default in normalizeEvents)
  };

  async function fetchIncidents(regions) {
    const regionList = regions ? [...regions] : [];
    const incidents = [];

    await Promise.allSettled(regionList.map(async (region) => {
      const entry = INCIDENT_REGISTRY[region];
      if (!entry) return;
      try {
        const raw = await fetchWithRetry(entry.url);
        incidents.push(...normalizeEvents(raw, region, INCIDENT_FORMAT[region] || 'ibi'));
      } catch (e) {
        // Silent fail — no incidents for this region
      }
    }));

    return incidents;
  }

  function hasIncidentRegion(code) {
    return code in INCIDENT_REGISTRY;
  }

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

  function isSlowConnection() {
    if (!navigator.onLine) return true;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    if (conn.saveData) return true;
    if (conn.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) return true;
    return false;
  }

  function getTimeouts() {
    const slow = isSlowConnection();
    return { direct: slow ? 20000 : 10000, proxy: slow ? 25000 : 15000 };
  }

  // Track which proxy indices have failed this session to skip them on subsequent calls
  const _failedProxies = new Set();

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

  async function fetchViaProxy(url, proxyFn, options = {}) {
    const proxied = proxyFn(url);
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

  async function fetchFallback(region) {
    try {
      const resp = await fetch(`./data/cameras-${region.toLowerCase()}.json`);
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  // Try direct, then each proxy in order (skipping proxies that failed this session)
  async function fetchWithRetry(url) {
    try {
      return await fetchDirect(url);
    } catch (e) {
      for (let i = 0; i < CORS_PROXIES.length; i++) {
        if (_failedProxies.has(i)) continue;
        try {
          return await fetchViaProxy(url, CORS_PROXIES[i]);
        } catch (_) {
          _failedProxies.add(i);
        }
      }
      throw e;
    }
  }

  // Background refresh — updates cache silently
  async function refreshRegion(region, endpoint) {
    try {
      const raw = await fetchWithRetry(endpoint);
      // Only overwrite cache if API returned actual data
      const normalizer = getNormalizer(region);
      if (normalizer(raw).length > 0) {
        setCachedData(region, raw);
      }
    } catch (e) {
      // Silent fail — stale data remains in cache
    }
  }

  // ── Region fetching ────────────────────────────────────────────

  // Normalizers that need the region code passed through
  const REGION_NORMALIZERS = { normalizeIBI: true, normalizeArcGIS: true };

  function getNormalizer(region) {
    const entry = CAMERA_REGISTRY[region];
    if (!entry) return (d) => [];
    const fn = Cameras[entry.norm];
    if (!fn) return (d) => [];
    return REGION_NORMALIZERS[entry.norm] ? (d) => fn(d, region) : fn;
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
      const normalized = normalizer(raw);
      if (normalized.length > 0) {
        setCachedData(region, raw);
        return { data: normalized, fromCache: false };
      }
      // API returned empty data — fall through to fallback
      console.warn(`${region} API returned empty data, trying fallback`);
    } catch (e) {
      console.warn(`${region} API failed, trying fallback:`, e.message);
    }
    const fallback = await fetchFallback(region);
    if (fallback) {
      setCachedData(region, fallback);
      return { data: normalizer(fallback), fromCache: true };
    }
    return { data: [], fromCache: true, error: 'All attempts failed' };
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

  // Two-phase fetch for multi-URL endpoints: try all URLs direct first (fast),
  // then proxy only if all direct attempts fail. Avoids the full retry chain
  // per URL which can take 40s+ each when endpoints are down.
  // Returns raw data on success, null if all attempts fail.
  async function tryUrlsTwoPhase(urls, region) {
    const label = region || 'multi-url';
    const errors = [];
    // Phase 1: try all URLs direct (fast, no proxy overhead)
    for (const url of urls) {
      try {
        const data = await fetchDirect(url);
        if (data) return data;
      } catch (e) {
        errors.push(`direct ${url.split('?')[0]}: ${e.message}`);
      }
    }
    // Phase 2+: try each proxy across all URLs
    for (let i = 0; i < CORS_PROXIES.length; i++) {
      const proxyFn = CORS_PROXIES[i];
      for (const url of urls) {
        try {
          const data = await fetchViaProxy(url, proxyFn);
          if (data) return data;
        } catch (e) {
          errors.push(`proxy${i + 1} ${url.split('?')[0]}: ${e.message}`);
        }
      }
    }
    console.warn(`[${label}] All fetch attempts failed:`, errors.join('; '));
    return null;
  }

  async function fetchRegionMultiUrl(region, urls, normalizer) {
    const cached = getCachedData(region);
    if (cached && cached.fresh) {
      const data = normalizer(cached.data);
      if (data.length === 0) {
        // Cached data normalized to nothing — cache is corrupt, clear it and refetch
        console.warn(`[${region}] Fresh cache normalized to 0 cameras, clearing and refetching`);
        memCache[region] = null;
        try { localStorage.removeItem(`${CACHE_KEY}_${region}`); } catch (e) { /* ignore */ }
      } else {
        return { data, fromCache: true };
      }
    }
    if (cached && !cached.fresh) {
      const data = normalizer(cached.data);
      if (data.length > 0) {
        // Stale cache has usable data — return it, refresh in background
        tryUrlsTwoPhase(urls, region).then(raw => { if (raw) setCachedData(region, raw); });
        return { data, fromCache: true, stale: true };
      }
      // Stale cache normalized to 0 — don't return empty, fall through to fetch
      console.warn(`[${region}] Stale cache normalized to 0 cameras, refetching`);
    }
    // No cache (or corrupt cache) — must fetch
    const raw = await tryUrlsTwoPhase(urls, region);
    if (raw) {
      const data = normalizer(raw);
      if (data.length > 0) {
        setCachedData(region, raw);
        return { data, fromCache: false };
      }
      console.warn(`[${region}] API returned data but normalized to 0 cameras`);
    }
    console.warn(`[${region}] All API URLs failed or returned bad data, using fallback`);
    const fallback = await fetchFallback(region);
    if (fallback) {
      const data = normalizer(fallback);
      if (data.length > 0) {
        setCachedData(region, fallback);
        return { data, fromCache: true };
      }
      console.warn(`[${region}] Fallback file also normalized to 0 cameras`);
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

  // Fetch regions progressively, calling onRegion as each completes.
  // Deduplicates by URL so multi-state APIs (e.g., newengland511 for VT/NH/ME)
  // are only fetched once, with the result fanned out to all matching regions.
  async function fetchProgressive(onRegion, neededRegions) {
    const regions = neededRegions
      ? [...neededRegions].filter(r => CAMERA_REGISTRY[r])
      : Object.keys(CAMERA_REGISTRY);

    if (regions.length === 0) return;

    // Group regions that share the same URL so we fetch once per unique endpoint.
    const urlToRegions = new Map();
    const uniqueRegions = [];
    for (const key of regions) {
      const entry = CAMERA_REGISTRY[key];
      const url = entry.url || (entry.urls && entry.urls[0]) || key;
      if (urlToRegions.has(url)) {
        urlToRegions.get(url).push(key);
      } else {
        urlToRegions.set(url, [key]);
        uniqueRegions.push(key); // first region for this URL does the fetch
      }
    }

    const BATCH_SIZE = isSlowConnection() ? 3 : 8;
    for (let i = 0; i < uniqueRegions.length; i += BATCH_SIZE) {
      const batch = uniqueRegions.slice(i, i + BATCH_SIZE);
      const fetchers = batch.map(key => {
        const entry = CAMERA_REGISTRY[key];
        const url = entry.url || (entry.urls && entry.urls[0]) || key;
        const siblings = urlToRegions.get(url);
        return fetchRegisteredRegion(key)
          .then(r => { onRegion(key, r); return r; })
          .catch(e => { onRegion(key, { data: [], fromCache: true, error: e.message }); });
      });
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
    fetchIncidents,
    hasIncidentRegion,
    isSlowConnection,
    CAMERA_REGISTRY,
  };
})();
