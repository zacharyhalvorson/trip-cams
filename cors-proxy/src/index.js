/**
 * CORS Proxy for Road Trip Cameras
 *
 * Proxies requests to government camera APIs that don't support CORS.
 * Restricted to known camera API domains for security.
 *
 * Usage: https://<worker>.workers.dev/?<target-url>
 *   e.g. https://road-trip-cameras-cors.workers.dev/?https://511.alberta.ca/api/v2/get/cameras
 *
 * Deploy: cd cors-proxy && npx wrangler deploy
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
  '511ga.org',
  '511wi.gov',
  '511la.org',
  'az511.com',
  '511.idaho.gov',
  '511.alaska.gov',
  'udottraffic.utah.gov',
  'nvroads.com',
  'ctroads.com',
  // US: Custom
  'data.wsdot.wa.gov',
  'www.wsdot.wa.gov',
  'gis.odot.state.or.us',
  'chart.maryland.gov',
  'publicapi.ohgo.com',
  'cwwp2.dot.ca.gov',
  'travelfiles.dot.nd.gov',
  'wyoroad.info',
  'www.wyoroad.info',
  'kygisserver.ky.gov',
  'firstmaptest.delaware.gov',
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
];

function isOriginAllowed(origin) {
  if (!origin) return true; // non-browser requests (curl, etc.)
  return ALLOWED_ORIGINS.some(pattern => pattern.test(origin));
}

export default {
  async fetch(request) {
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

    // Proxy the request
    try {
      const proxyResponse = await fetch(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': 'RoadTripCameras/1.0',
          'Accept': 'application/json, text/plain, */*',
        },
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
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
