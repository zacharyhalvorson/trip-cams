#!/usr/bin/env node
/* =============================================================
   probe-endpoints.mjs — Live health check for every camera API

   Fetches every endpoint in CAMERA_REGISTRY (including all Caltrans
   districts), runs the response through the app's real normalizers,
   and reports per-region status. This is the ground truth for "does
   region X actually work" — the static coverage test can't see a
   dead endpoint or a changed response format; this can.

   Run:  node scripts/probe-endpoints.mjs [--json report.json]

   Exit code 1 if any region listed in tests/endpoint-expectations.json
   "expectOk" fails. Regions not listed there are report-only, so
   speculative registry entries don't break CI.

   Must run somewhere with open egress (GitHub Actions runner, local
   dev machine) — sandboxed environments with restricted networking
   will report every region as unreachable.
   ============================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const camerasSrc = fs.readFileSync(path.join(ROOT, 'js/cameras.js'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf-8');

// Evaluate the browser IIFEs — both only touch browser APIs lazily inside
// functions, so constructing them in Node is safe. API needs the Cameras
// global for normalizer lookups.
const Cameras = new Function(`${camerasSrc}\n;return Cameras;`)();
const API = new Function(
  'Cameras', 'localStorage', 'navigator',
  `${apiSrc}\n;return API;`
)(
  Cameras,
  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  { onLine: true }
);

const REGISTRY = API.CAMERA_REGISTRY;

// Caltrans district URLs live in a private const — extract them from source
// so this script stays in sync with the app.
const CA_DISTRICT_URLS = [...apiSrc.matchAll(/url:\s*'(https:\/\/cwwp2\.dot\.ca\.gov[^']+)'/g)]
  .map(m => m[1]);

// Normalizers that take (data, region)
const REGION_NORMALIZERS = new Set(['normalizeIBI', 'normalizeArcGIS']);

const FETCH_TIMEOUT_MS = 20000;
const CONCURRENCY = 8;
const UA = 'Mozilla/5.0 (compatible; TripCamsHealthCheck/1.0; +https://tripcams.pizza)';

// Mirrors api.js parseJSON: plain JSON, JSONP, or JS variable assignment
function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const jsonp = text.match(/^\s*\w+\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*$/);
    if (jsonp) return JSON.parse(jsonp[1]);
    const assign = text.match(/^\s*(?:var|let|const)\s+\w+\s*=\s*([\s\S]*?)\s*;?\s*$/);
    if (assign) return JSON.parse(assign[1]);
    throw e;
  }
}

async function fetchUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/json,text/javascript,*/*' },
      redirect: 'follow',
    });
    if (!resp.ok) {
      // Include a snippet of the error body — DOT APIs usually say exactly
      // what's wrong ("API key is required", "format must be...", etc.)
      let snippet = '';
      try {
        snippet = (await resp.text()).slice(0, 140).replace(/\s+/g, ' ').trim();
      } catch (e) { /* body unavailable */ }
      return { error: `HTTP ${resp.status}${snippet ? ` — ${snippet}` : ''}` };
    }
    const text = await resp.text();
    try {
      return { data: parseBody(text) };
    } catch (e) {
      const head = text.slice(0, 80).replace(/\s+/g, ' ');
      return { error: `parse error (body starts: "${head}")` };
    }
  } catch (e) {
    return { error: e.name === 'AbortError' ? `timeout after ${FETCH_TIMEOUT_MS}ms` : (e.cause?.code || e.message) };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFor(region, data) {
  const entry = REGISTRY[region];
  const fn = Cameras[entry.norm];
  if (!fn) return [];
  return REGION_NORMALIZERS.has(entry.norm) ? fn(data, region) : fn(data);
}

// Spot-check that one camera image actually serves (headers only)
async function checkImage(cameras) {
  const cam = cameras.find(c => c.imageUrl && c.status === 'active') || cameras.find(c => c.imageUrl);
  if (!cam) return 'no image URLs';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(cam.imageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
    });
    const type = resp.headers.get('content-type') || '';
    controller.abort(); // headers are enough — don't download the image
    if (!resp.ok) return `HTTP ${resp.status}`;
    if (!type.startsWith('image/') && !type.includes('octet-stream')) return `unexpected content-type ${type}`;
    return 'ok';
  } catch (e) {
    return e.name === 'AbortError' ? 'ok' : `error: ${e.cause?.code || e.message}`;
  } finally {
    clearTimeout(timer);
  }
}

async function probeRegion(region) {
  const entry = REGISTRY[region];
  const t0 = Date.now();

  if (entry.multiDistrict) {
    // California: probe every district, report aggregate
    const results = await Promise.all(CA_DISTRICT_URLS.map(u => fetchUrl(u)));
    const merged = results.flatMap(r => r.data ? (Array.isArray(r.data) ? r.data : (r.data.data || [])) : []);
    const okDistricts = results.filter(r => r.data).length;
    const cameras = normalizeFor(region, merged);
    const ms = Date.now() - t0;
    if (cameras.length > 0) {
      const imageCheck = await checkImage(cameras);
      const note = `${okDistricts}/${CA_DISTRICT_URLS.length} districts`;
      return { region, status: okDistricts === CA_DISTRICT_URLS.length ? 'ok' : 'degraded', cameras: cameras.length, ms, note, imageCheck };
    }
    return { region, status: 'failed', cameras: 0, ms, note: results.map((r, i) => r.error ? `D${i + 1}: ${r.error}` : null).filter(Boolean).join('; ') };
  }

  const urls = entry.urls || [entry.url];
  const errors = [];
  let sawEmpty = false;
  for (const url of urls) {
    const { data, error } = await fetchUrl(url);
    if (error) { errors.push(error); continue; }
    const cameras = normalizeFor(region, data);
    const ms = Date.now() - t0;
    if (cameras.length > 0) {
      const withImages = cameras.filter(c => c.imageUrl).length;
      const imageCheck = await checkImage(cameras);
      // No image URLs means the normalizer's field mapping is stale —
      // surface the raw field names so it can be fixed without guessing
      const note = withImages === 0 ? `raw fields: ${sampleKeys(data)}` : undefined;
      return { region, status: 'ok', cameras: cameras.length, withImages, ms, imageCheck, note };
    }
    // Endpoint responded but produced no cameras — registry URL or
    // normalizer no longer matches what the API returns. Keep trying
    // any remaining candidate URLs.
    sawEmpty = true;
    errors.push(`empty response (shape: ${sampleKeys(data)})`);
  }
  return { region, status: sawEmpty ? 'empty' : 'failed', cameras: 0, ms: Date.now() - t0, note: errors.join('; ') };
}

// Field names of a representative item in an API response, for diagnostics.
// Dumps ALL item keys — this is what fixing a stale normalizer needs.
function sampleKeys(data) {
  if (Array.isArray(data)) {
    return data.length ? `array[${data.length}] item: ${Object.keys(data[0]).join(',')}` : 'array[0]';
  }
  if (data && typeof data === 'object') {
    const feature = Array.isArray(data.features) ? data.features[0] : null;
    const container = (feature && (feature.attributes || feature.properties)) // ArcGIS / GeoJSON
      || feature
      || (Array.isArray(data.data) ? data.data[0] : null);
    const top = Object.keys(data).slice(0, 6).join(',');
    return container ? `{${top}} item: ${Object.keys(container).join(',')}` : `object keys: ${top}`;
  }
  return typeof data;
}

async function main() {
  const regions = Object.keys(REGISTRY);
  console.log(`Probing ${regions.length} regions (${CA_DISTRICT_URLS.length} CA districts)...\n`);

  const results = [];
  for (let i = 0; i < regions.length; i += CONCURRENCY) {
    const batch = regions.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(probeRegion));
    for (const r of batchResults) {
      results.push(r);
      const flag = r.status === 'ok' ? ' OK ' : r.status === 'degraded' ? 'WARN' : 'FAIL';
      const detail = r.status === 'ok'
        ? `${String(r.cameras).padStart(5)} cameras  ${String(r.ms).padStart(6)}ms  image: ${r.imageCheck}${r.note ? `  (${r.note})` : ''}`
        : `${r.status.toUpperCase()}: ${r.note || ''}`;
      console.log(`  [${flag}] ${r.region.padEnd(3)} ${detail}`);
    }
  }

  // Compare against expectations
  let expectations = { expectOk: [] };
  const expectationsPath = path.join(ROOT, 'tests/endpoint-expectations.json');
  try {
    expectations = JSON.parse(fs.readFileSync(expectationsPath, 'utf-8'));
  } catch (e) {
    console.warn(`\nNo readable ${expectationsPath} — all regions report-only`);
  }

  const byRegion = Object.fromEntries(results.map(r => [r.region, r]));
  const broken = expectations.expectOk.filter(r => byRegion[r] && byRegion[r].status !== 'ok' && byRegion[r].status !== 'degraded');
  const speculativeBroken = results.filter(r =>
    !expectations.expectOk.includes(r.region) && r.status !== 'ok' && r.status !== 'degraded');
  const okCount = results.filter(r => r.status === 'ok' || r.status === 'degraded').length;

  console.log(`\n── Summary ──`);
  console.log(`  ${okCount}/${results.length} regions serving cameras`);
  if (broken.length > 0) {
    console.log(`  BROKEN (expected working): ${broken.join(', ')}`);
  }
  if (speculativeBroken.length > 0) {
    console.log(`  Not working (speculative entries, report-only): ${speculativeBroken.map(r => r.region).join(', ')}`);
  }

  // Machine-readable report
  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx !== -1 && process.argv[jsonIdx + 1]) {
    fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  }

  // GitHub Actions job summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results
      .sort((a, b) => a.region.localeCompare(b.region))
      .map(r => `| ${r.region} | ${r.status} | ${r.cameras} | ${r.ms}ms | ${r.imageCheck || ''} | ${r.note || ''} |`)
      .join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Camera endpoint health\n\n${okCount}/${results.length} regions serving cameras\n\n` +
      `| Region | Status | Cameras | Latency | Image check | Notes |\n|---|---|---|---|---|---|\n${rows}\n`);
  }

  process.exit(broken.length > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
