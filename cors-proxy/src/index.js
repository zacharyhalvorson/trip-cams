/**
 * CORS Proxy for Trip Cams
 *
 * Proxies requests to government camera APIs that don't support CORS.
 * Restricted to known camera API domains for security.
 *
 * Usage: https://<worker>.workers.dev/?<target-url>
 *   e.g. https://trip-cams-cors.workers.dev/?https://511.alberta.ca/api/v2/get/cameras
 *
 * Deploy: cd cors-proxy && npx wrangler deploy
 *
 * ── API key injection ──
 * Most IBI 511 platforms require a registered developer key
 * (?key=...) and OHGO requires an api-key header. Keys are injected
 * here, server-side, so they never ship in client JS. Store them as a
 * Worker secret:
 *
 *   npx wrangler secret put API_KEYS
 *
 * with a JSON value mapping hostname → key config:
 *
 *   {
 *     "511ny.org": "my-511ny-key",
 *     "publicapi.ohgo.com": { "header": "api-key", "key": "my-ohgo-key" }
 *   }
 *
 * A plain string value means "append as the `key` query parameter"
 * (the IBI 511 convention). See docs/api-keys.md for the registration
 * checklist.
 */

const ALLOWED_HOSTS = new Set([
  // Canada: IBI 511 Platform
  '511.alberta.ca',
  'hotline.gov.sk.ca',
  'www.manitoba511.ca',
  '511on.ca',
  '511.gnb.ca',
  '511.novascotia.ca',
  '511.gov.pe.ca',
  '511nl.ca',
  '511yukon.ca',
  // Canada: Other
  'www.drivebc.ca',
  'images.drivebc.ca',
  'ws.mapserver.transports.gouv.qc.ca',
  // US: IBI 511 Platform
  '511ny.org',
  '511nj.org',
  '511pa.com',
  'ctroads.com',
  '511ga.org',
  'fl511.com',
  '511sc.org',
  '511wi.gov',
  '511la.org',
  '511mn.org',
  '511ia.org',
  '511.nebraska.gov',
  'az511.com',
  'www.az511.com',
  'www.cotrip.org',
  'nmroads.com',
  'www.511mt.net',
  '511.idaho.gov',
  '511.alaska.gov',
  'udottraffic.utah.gov',
  'nvroads.com',
  'mass511.com',
  '511in.org',
  'www.gettingaroundillinois.com',
  'wv511.org',
  'www.newengland511.org',
  'www.sd511.org',
  'kandrive.gov',
  'oktraffic.org',
  'www.511virginia.org',
  'drivenc.gov',
  'smartway.tn.gov',
  'traveler.modot.org',
  'mi511.org',
  'algotraffic.com',
  'mdottraffic.com',
  'idrivearkansas.com',
  'drivetexas.org',
  // US: Custom formats
  'data.wsdot.wa.gov',
  'www.wsdot.wa.gov',
  'gis.odot.state.or.us',
  'tripcheck.com',
  'chart.maryland.gov',
  'publicapi.ohgo.com',
  'travelfiles.dot.nd.gov',
  'cwwp2.dot.ca.gov',
  // US: ArcGIS Feature Services
  'map.wyoroad.info',
  'wyoroad.info',
  'www.wyoroad.info',
  'kygisserver.ky.gov',
  'enterprise.firstmap.delaware.gov',
  'enterprise.firstmaptest.delaware.gov',
  // Geocoding
  'photon.komoot.io',
]);

// Origins allowed to use this proxy
const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.github\.io$/,
  /^https:\/\/zacharyhalvorson\.github\.io$/,
  /^https:\/\/tripcams\.pizza$/,
];

function isOriginAllowed(origin) {
  if (!origin) return true; // non-browser requests (curl, etc.)
  return ALLOWED_ORIGINS.some(pattern => pattern.test(origin));
}

// Parse the API_KEYS secret once per isolate
let _apiKeys = null;
function getApiKeys(env) {
  if (_apiKeys) return _apiKeys;
  try {
    _apiKeys = env.API_KEYS ? JSON.parse(env.API_KEYS) : {};
  } catch (e) {
    _apiKeys = {};
  }
  return _apiKeys;
}

// Apply a configured API key for this host: string → `key` query param
// (IBI 511 convention), { header, key } → request header (e.g. OHGO).
// Returns { url, headers } to use for the upstream request.
function applyApiKey(targetUrl, host, env, baseHeaders) {
  const config = getApiKeys(env)[host];
  if (!config) return { url: targetUrl, headers: baseHeaders };
  if (typeof config === 'string') {
    const u = new URL(targetUrl);
    u.searchParams.set('key', config);
    return { url: u.toString(), headers: baseHeaders };
  }
  if (config.header && config.key) {
    return { url: targetUrl, headers: { ...baseHeaders, [config.header]: config.key } };
  }
  return { url: targetUrl, headers: baseHeaders };
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(request.headers.get('Origin')),
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.search.slice(1); // everything after ?

    if (!targetUrl) {
      return new Response(
        JSON.stringify({ error: 'Usage: ?<url>' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate origin
    const origin = request.headers.get('Origin');
    if (!isOriginAllowed(origin)) {
      return new Response(
        JSON.stringify({ error: 'Origin not allowed' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate target host
    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!ALLOWED_HOSTS.has(parsedTarget.hostname)) {
      return new Response(
        JSON.stringify({ error: `Host not allowed: ${parsedTarget.hostname}` }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Inject API key for this host if one is configured
    const upstream = applyApiKey(targetUrl, parsedTarget.hostname, env, {
      'User-Agent': 'RoadTripCameras/1.0',
      'Accept': 'application/json, text/plain, */*',
    });

    // Proxy the request
    try {
      const proxyResponse = await fetch(upstream.url, {
        method: request.method,
        headers: upstream.headers,
        redirect: 'follow',
      });

      // Clone response with CORS headers
      const headers = new Headers(proxyResponse.headers);
      const cors = corsHeaders(origin);
      for (const [key, value] of Object.entries(cors)) {
        headers.set(key, value);
      }
      // Ensure content type is preserved
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      return new Response(proxyResponse.body, {
        status: proxyResponse.status,
        headers,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Fetch failed: ${err.message}` }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
      );
    }
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}
