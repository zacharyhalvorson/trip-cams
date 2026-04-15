#!/usr/bin/env node
/* =============================================================
   coverage.test.js — Route camera coverage & performance tests

   Ensures every route a user could select will find cameras and
   that region detection stays fast.

   Run:  node tests/coverage.test.js
   ============================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Load source data ────────────────────────────────────────

const regionBounds = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/region-bounds.json'), 'utf-8')
);

// Extract CAMERA_REGISTRY keys from api.js by parsing the source
const apiSource = fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf-8');
const camerasSource = fs.readFileSync(path.join(ROOT, 'js/cameras.js'), 'utf-8');

function extractRegistryKeys(source, registryName) {
  // Match the registry object and extract keys like:  AB: {
  const registryRegex = new RegExp(`const ${registryName}\\s*=\\s*\\{([\\s\\S]*?)\\n  \\};`);
  const match = source.match(registryRegex);
  if (!match) throw new Error(`Could not find ${registryName} in source`);
  const keys = [];
  const keyRegex = /^\s{4}(\w{2}):\s*\{/gm;
  let m;
  while ((m = keyRegex.exec(match[1])) !== null) {
    keys.push(m[1]);
  }
  return new Set(keys);
}

function extractIBIRegions(source) {
  const match = source.match(/IBI_REGIONS\s*=\s*new Set\(\[([^\]]+)\]/);
  if (!match) throw new Error('Could not find IBI_REGIONS in cameras.js');
  const codes = [];
  const re = /'(\w+)'/g;
  let m;
  while ((m = re.exec(match[1])) !== null) codes.push(m[1]);
  return new Set(codes);
}

const cameraRegistry = extractRegistryKeys(apiSource, 'CAMERA_REGISTRY');
const incidentRegistry = extractRegistryKeys(apiSource, 'INCIDENT_REGISTRY');
const ibiRegions = extractIBIRegions(camerasSource);

// Build flat bounds lookup
const allBounds = {};
for (const [country, regions] of Object.entries(regionBounds)) {
  for (const [code, data] of Object.entries(regions)) {
    allBounds[code] = {
      name: data.name, country,
      latMin: data.lat[0], latMax: data.lat[1],
      lonMin: data.lon[0], lonMax: data.lon[1],
    };
  }
}

// ── Test infrastructure ─────────────────────────────────────

let passed = 0;
let failed = 0;
let warned = 0;
const failures = [];
const warnings = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.log(`  FAIL: ${message}`);
  }
}

function warn(message) {
  warned++;
  warnings.push(message);
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── Region detection (mirrors api.js getRegionsForRoute) ────

function detectRegions(geometry) {
  const found = new Set();
  const supportedBounds = [];
  for (const [code, b] of Object.entries(allBounds)) {
    if (cameraRegistry.has(code)) {
      supportedBounds.push({ code, ...b });
    }
  }
  const step = Math.max(1, Math.floor(geometry.length / 50));
  for (let i = 0; i < geometry.length; i += step) {
    const p = geometry[i];
    for (const r of supportedBounds) {
      if (!found.has(r.code) &&
          p.lat >= r.latMin && p.lat <= r.latMax &&
          p.lon >= r.lonMin && p.lon <= r.lonMax) {
        found.add(r.code);
      }
    }
  }
  const last = geometry[geometry.length - 1];
  for (const r of supportedBounds) {
    if (!found.has(r.code) &&
        last.lat >= r.latMin && last.lat <= r.latMax &&
        last.lon >= r.lonMin && last.lon <= r.lonMax) {
      found.add(r.code);
    }
  }
  return found;
}

// Same but checks ALL bounds (not just supported ones)
function detectAllRegions(geometry) {
  const found = new Set();
  const step = Math.max(1, Math.floor(geometry.length / 50));
  for (let i = 0; i < geometry.length; i += step) {
    const p = geometry[i];
    for (const [code, b] of Object.entries(allBounds)) {
      if (!found.has(code) &&
          p.lat >= b.latMin && p.lat <= b.latMax &&
          p.lon >= b.lonMin && p.lon <= b.lonMax) {
        found.add(code);
      }
    }
  }
  return found;
}

// Interpolate a straight line between two points into N samples
function interpolate(from, to, n = 100) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push({
      lat: from.lat + t * (to.lat - from.lat),
      lon: from.lon + t * (to.lon - from.lon),
    });
  }
  return points;
}

// ═════════════════════════════════════════════════════════════
//  TEST 1: Registry consistency
// ═════════════════════════════════════════════════════════════

section('Registry consistency');

// Every IBI region in CAMERA_REGISTRY should be in IBI_REGIONS set
const ibiRegistryMatch = apiSource.match(/CAMERA_REGISTRY\s*=\s*\{([\s\S]*?)\n  \};/);
if (ibiRegistryMatch) {
  const lines = ibiRegistryMatch[1].split('\n');
  for (const line of lines) {
    const m = line.match(/^\s{4}(\w{2}):\s*\{.*norm:\s*'normalizeIBI'/);
    if (m) {
      const code = m[1];
      assert(ibiRegions.has(code),
        `${code} uses normalizeIBI in CAMERA_REGISTRY but missing from IBI_REGIONS in cameras.js`);
    }
  }
}

// Every IBI_REGIONS entry should be in CAMERA_REGISTRY
for (const code of ibiRegions) {
  assert(cameraRegistry.has(code),
    `${code} is in IBI_REGIONS but missing from CAMERA_REGISTRY`);
}

// Every CAMERA_REGISTRY entry should have region bounds defined
for (const code of cameraRegistry) {
  assert(code in allBounds || code === 'CA',
    `${code} is in CAMERA_REGISTRY but has no region bounds defined`);
}

// INCIDENT_REGISTRY should be a superset of IBI entries in CAMERA_REGISTRY
// (IBI platforms always expose /api/v2/get/event alongside cameras)
for (const code of cameraRegistry) {
  if (ibiRegions.has(code)) {
    assert(incidentRegistry.has(code),
      `${code} is an IBI region in CAMERA_REGISTRY but missing from INCIDENT_REGISTRY`);
  }
}

console.log(`  ${passed} passed`);

// ═════════════════════════════════════════════════════════════
//  TEST 2: Coverage gaps — bounds without camera APIs
// ═════════════════════════════════════════════════════════════

section('Coverage gaps (regions with bounds but no camera API)');

const missingRegions = [];
for (const [code, b] of Object.entries(allBounds)) {
  if (!cameraRegistry.has(code) && code !== 'DC') { // DC has no DOT cameras
    missingRegions.push({ code, name: b.name, country: b.country });
  }
}

if (missingRegions.length === 0) {
  console.log('  All regions with bounds have camera APIs');
} else {
  console.log(`  ${missingRegions.length} regions have bounds but no camera API:`);
  for (const { code, name, country } of missingRegions) {
    console.log(`    WARN: ${code} (${name}, ${country})`);
    warn(`${code} (${name}) has region bounds but no camera API`);
  }
}

// ═════════════════════════════════════════════════════════════
//  TEST 3: Major route coverage
// ═════════════════════════════════════════════════════════════

// Cities with coordinates — covers all 50 states plus Canadian provinces
const CITIES = {
  // US East
  'New York, NY':       { lat: 40.71, lon: -74.01 },
  'Philadelphia, PA':   { lat: 39.95, lon: -75.17 },
  'Washington, DC':     { lat: 38.91, lon: -77.04 },
  'Boston, MA':         { lat: 42.36, lon: -71.06 },
  'Miami, FL':          { lat: 25.76, lon: -80.19 },
  'Atlanta, GA':        { lat: 33.75, lon: -84.39 },
  'Charlotte, NC':      { lat: 35.23, lon: -80.84 },
  'Pittsburgh, PA':     { lat: 40.44, lon: -79.99 },
  'Baltimore, MD':      { lat: 39.29, lon: -76.61 },

  // US Midwest
  'Chicago, IL':        { lat: 41.88, lon: -87.63 },
  'Detroit, MI':        { lat: 42.33, lon: -83.05 },
  'Minneapolis, MN':    { lat: 44.98, lon: -93.27 },
  'Milwaukee, WI':      { lat: 43.04, lon: -87.91 },
  'Cleveland, OH':      { lat: 41.50, lon: -81.69 },
  'St. Louis, MO':      { lat: 38.63, lon: -90.20 },
  'Kansas City, MO':    { lat: 39.10, lon: -94.58 },
  'Indianapolis, IN':   { lat: 39.77, lon: -86.16 },
  'Des Moines, IA':     { lat: 41.59, lon: -93.62 },
  'Omaha, NE':          { lat: 41.26, lon: -95.94 },

  // US West
  'Los Angeles, CA':    { lat: 34.05, lon: -118.24 },
  'San Francisco, CA':  { lat: 37.77, lon: -122.42 },
  'Seattle, WA':        { lat: 47.61, lon: -122.33 },
  'Portland, OR':       { lat: 45.52, lon: -122.68 },
  'Denver, CO':         { lat: 39.74, lon: -104.99 },
  'Phoenix, AZ':        { lat: 33.45, lon: -112.07 },
  'Las Vegas, NV':      { lat: 36.17, lon: -115.14 },
  'Salt Lake City, UT': { lat: 40.76, lon: -111.89 },
  'Boise, ID':          { lat: 43.62, lon: -116.21 },
  'Albuquerque, NM':    { lat: 35.08, lon: -106.65 },
  'Billings, MT':       { lat: 45.78, lon: -108.50 },

  // US South
  'Dallas, TX':         { lat: 32.78, lon: -96.80 },
  'Houston, TX':        { lat: 29.76, lon: -95.37 },
  'New Orleans, LA':    { lat: 29.95, lon: -90.07 },
  'Nashville, TN':      { lat: 36.16, lon: -86.78 },
  'Louisville, KY':     { lat: 38.25, lon: -85.76 },
  'Charleston, WV':     { lat: 38.35, lon: -81.63 },

  // US Additional for coverage
  'Fargo, ND':          { lat: 46.88, lon: -96.79 },
  'Sioux Falls, SD':    { lat: 43.55, lon: -96.73 },
  'Oklahoma City, OK':  { lat: 35.47, lon: -97.52 },
  'Little Rock, AR':    { lat: 34.75, lon: -92.29 },
  'Cheyenne, WY':       { lat: 41.14, lon: -104.82 },
  'Anchorage, AK':      { lat: 61.22, lon: -149.90 },
  'Fairbanks, AK':      { lat: 64.84, lon: -147.72 },

  // Canada
  'Vancouver, BC':      { lat: 49.28, lon: -123.12 },
  'Calgary, AB':        { lat: 51.05, lon: -114.07 },
  'Edmonton, AB':       { lat: 53.54, lon: -113.49 },
  'Winnipeg, MB':       { lat: 49.90, lon: -97.14 },
  'Toronto, ON':        { lat: 43.65, lon: -79.38 },
  'Montreal, QC':       { lat: 45.50, lon: -73.57 },
  'Ottawa, ON':         { lat: 45.42, lon: -75.70 },
  'Halifax, NS':        { lat: 44.65, lon: -63.57 },
  'Fredericton, NB':    { lat: 45.96, lon: -66.64 },
  'Charlottetown, PE':  { lat: 46.24, lon: -63.13 },
  'St. Johns, NL':      { lat: 47.56, lon: -52.71 },
  'Whitehorse, YT':     { lat: 60.72, lon: -135.06 },
};

// Routes are tagged as:
//   'required' — must detect ≥1 camera region (test FAILS otherwise)
//   'desired'  — should detect cameras but failure is a warning (known gap states)
const ROUTES = [
  // The bug route
  ['New York, NY', 'Philadelphia, PA', 'I-95 NE corridor', 'required'],

  // I-95 corridor
  ['Boston, MA', 'New York, NY', 'I-95 New England', 'required'],
  ['New York, NY', 'Washington, DC', 'I-95 Mid-Atlantic', 'required'],
  ['Washington, DC', 'Miami, FL', 'I-95 South', 'required'],
  ['Washington, DC', 'Atlanta, GA', 'I-85 South', 'required'],
  ['Atlanta, GA', 'Miami, FL', 'I-75 South', 'required'],
  ['Charlotte, NC', 'Atlanta, GA', 'I-85 Piedmont', 'required'],
  ['Baltimore, MD', 'Philadelphia, PA', 'I-95 Short hop', 'required'],

  // Midwest
  ['Chicago, IL', 'Detroit, MI', 'I-94 Great Lakes', 'required'],
  ['Chicago, IL', 'Minneapolis, MN', 'I-94 Upper Midwest', 'required'],
  ['Chicago, IL', 'St. Louis, MO', 'I-55 Illinois', 'required'],
  ['Minneapolis, MN', 'Milwaukee, WI', 'I-94 WI/MN', 'required'],
  ['Cleveland, OH', 'Pittsburgh, PA', 'I-76 Ohio/PA', 'required'],
  ['Indianapolis, IN', 'Chicago, IL', 'I-65 Midwest', 'required'],
  ['Des Moines, IA', 'Omaha, NE', 'I-80 Plains', 'required'],
  ['Kansas City, MO', 'Denver, CO', 'I-70 West', 'required'],
  ['Louisville, KY', 'Nashville, TN', 'I-65 South', 'required'],
  ['Cleveland, OH', 'Charleston, WV', 'I-77 Appalachia', 'required'],

  // West
  ['Los Angeles, CA', 'San Francisco, CA', 'I-5 / US-101 California', 'required'],
  ['Seattle, WA', 'Portland, OR', 'I-5 Pacific NW', 'required'],
  ['Portland, OR', 'San Francisco, CA', 'I-5 West Coast', 'required'],
  ['Denver, CO', 'Salt Lake City, UT', 'I-70 Mountain', 'required'],
  ['Phoenix, AZ', 'Las Vegas, NV', 'US-93 Southwest', 'required'],
  ['Los Angeles, CA', 'Phoenix, AZ', 'I-10 Southwest', 'required'],
  ['Las Vegas, NV', 'Salt Lake City, UT', 'I-15 Great Basin', 'required'],
  ['Seattle, WA', 'Boise, ID', 'I-90/I-84 NW', 'required'],
  ['Denver, CO', 'Albuquerque, NM', 'I-25 Mountain', 'required'],
  ['Billings, MT', 'Boise, ID', 'I-90/I-15 Mountain NW', 'required'],
  ['Denver, CO', 'Cheyenne, WY', 'I-25 Front Range', 'required'],
  ['Fargo, ND', 'Minneapolis, MN', 'I-94 Northern Plains', 'required'],

  // South & Central
  ['New Orleans, LA', 'Houston, TX', 'I-10 Gulf', 'required'],
  ['Atlanta, GA', 'New Orleans, LA', 'I-10/I-20 Deep South', 'required'],
  ['Nashville, TN', 'Atlanta, GA', 'I-24/I-75 Southeast', 'required'],
  ['Dallas, TX', 'Houston, TX', 'I-45 Texas', 'required'],
  ['Oklahoma City, OK', 'Dallas, TX', 'I-35 South Central', 'required'],
  ['Little Rock, AR', 'Dallas, TX', 'I-30 AR/TX', 'required'],
  ['Sioux Falls, SD', 'Fargo, ND', 'I-29 Dakotas', 'required'],
  ['Omaha, NE', 'Sioux Falls, SD', 'I-29 Plains', 'required'],

  // Alaska
  ['Anchorage, AK', 'Fairbanks, AK', 'AK-3 Parks Hwy', 'required'],

  // Canada
  ['Vancouver, BC', 'Calgary, AB', 'Trans-Canada West', 'required'],
  ['Calgary, AB', 'Edmonton, AB', 'QE2 Alberta', 'required'],
  ['Calgary, AB', 'Winnipeg, MB', 'Trans-Canada Prairies', 'required'],
  ['Toronto, ON', 'Montreal, QC', 'ON-401 / QC-20', 'required'],
  ['Toronto, ON', 'Ottawa, ON', 'ON-401/416 Ontario', 'required'],
  ['Montreal, QC', 'Halifax, NS', 'Trans-Canada Maritimes', 'required'],
  ['Halifax, NS', 'Fredericton, NB', 'Trans-Canada NB/NS', 'required'],
  ['Fredericton, NB', 'Charlottetown, PE', 'Trans-Canada PEI', 'required'],
  ['Halifax, NS', 'St. Johns, NL', 'NL ferry route', 'required'],
  ['Edmonton, AB', 'Whitehorse, YT', 'Alaska Hwy North', 'required'],

  // Cross-border
  ['Seattle, WA', 'Vancouver, BC', 'I-5 / BC-99 Border', 'required'],
  ['Toronto, ON', 'New York, NY', 'I-90/QEW Cross-border', 'required'],
  ['Detroit, MI', 'Toronto, ON', 'ON-401 Cross-border', 'required'],
  ['Calgary, AB', 'Seattle, WA', 'Trans-mountain', 'required'],
  ['Montreal, QC', 'Boston, MA', 'I-89/I-93 NE Border', 'required'],
];

section(`Major route coverage (${ROUTES.length} city pairs)`);

let routesPassed = 0;
let routesFailed = 0;
let routesDesiredFailed = 0;

for (const [fromName, toName, label, level] of ROUTES) {
  const from = CITIES[fromName];
  const to = CITIES[toName];
  if (!from || !to) {
    console.log(`  SKIP: ${label} — city not found`);
    continue;
  }

  const geometry = interpolate(from, to, 100);
  const regions = detectRegions(geometry);
  const allRegionsOnRoute = detectAllRegions(geometry);
  const unsupported = [...allRegionsOnRoute].filter(r => !cameraRegistry.has(r) && r !== 'DC');

  if (regions.size > 0) {
    routesPassed++;
    if (unsupported.length > 0) {
      console.log(`  OK:   ${label.padEnd(30)} regions: [${[...regions].join(', ')}]  (gaps: ${unsupported.join(', ')})`);
    } else {
      console.log(`  OK:   ${label.padEnd(30)} regions: [${[...regions].join(', ')}]`);
    }
  } else if (level === 'desired') {
    routesDesiredFailed++;
    console.log(`  GAP:  ${label.padEnd(30)} — no cameras (route is entirely in: ${[...allRegionsOnRoute].join(', ')})`);
    warn(`Route "${label}" (${fromName} → ${toName}) has no camera coverage — needs ${[...allRegionsOnRoute].join(', ')} API`);
  } else {
    routesFailed++;
    console.log(`  FAIL: ${label.padEnd(30)} — NO camera regions detected! (passes through: ${[...allRegionsOnRoute].join(', ')})`);
    assert(false, `Route "${label}" (${fromName} → ${toName}) detects 0 camera regions`);
  }
}

console.log(`\n  ${routesPassed} routes OK, ${routesFailed} required FAILED, ${routesDesiredFailed} desired gaps`);

// ═════════════════════════════════════════════════════════════
//  TEST 4: Region detection performance
// ═════════════════════════════════════════════════════════════

section('Region detection performance');

// Simulate a dense OSRM geometry (2000 points) and measure detection time
const denseGeometry = interpolate(
  CITIES['New York, NY'],
  CITIES['Los Angeles, CA'],
  2000
);

const iterations = 100;
const start = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) {
  detectRegions(denseGeometry);
}
const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms
const avgMs = elapsed / iterations;

console.log(`  ${iterations} iterations × 2000-point geometry: avg ${avgMs.toFixed(2)}ms`);
assert(avgMs < 50, `Region detection too slow: ${avgMs.toFixed(2)}ms (limit: 50ms)`);

// Also test with typical geometry sizes
const sizes = [50, 200, 500, 1000, 5000];
for (const size of sizes) {
  const geo = interpolate(CITIES['Seattle, WA'], CITIES['Miami, FL'], size);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 50; i++) detectRegions(geo);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 50;
  console.log(`  ${String(size).padStart(5)} points: ${ms.toFixed(2)}ms`);
  assert(ms < 100, `Region detection with ${size} points too slow: ${ms.toFixed(2)}ms`);
}

// ═════════════════════════════════════════════════════════════
//  TEST 5: Every supported region is reachable from at least
//          one test route (no orphan registrations)
// ═════════════════════════════════════════════════════════════

section('Orphan region check');

const reachableRegions = new Set();

// Test each city individually — which regions does it fall in?
for (const city of Object.values(CITIES)) {
  for (const [code, b] of Object.entries(allBounds)) {
    if (city.lat >= b.latMin && city.lat <= b.latMax &&
        city.lon >= b.lonMin && city.lon <= b.lonMax) {
      reachableRegions.add(code);
    }
  }
}

// Also test all route pairs
for (const [fromName, toName] of ROUTES) {
  const from = CITIES[fromName];
  const to = CITIES[toName];
  if (!from || !to) continue;
  const geo = interpolate(from, to, 100);
  for (const code of detectAllRegions(geo)) {
    reachableRegions.add(code);
  }
}

let orphanCount = 0;
for (const code of cameraRegistry) {
  if (code === 'CA') continue; // CA is multi-district, handled specially
  if (!reachableRegions.has(code)) {
    orphanCount++;
    console.log(`  WARN: ${code} (${allBounds[code]?.name}) is registered but no test route reaches it`);
    warn(`${code} registered but unreachable by test routes — add a city/route covering it`);
  }
}

if (orphanCount === 0) {
  console.log('  All registered regions are reachable from test routes');
}

// ═════════════════════════════════════════════════════════════
//  Summary
// ═════════════════════════════════════════════════════════════

section('Summary');
console.log(`  Camera regions: ${cameraRegistry.size} supported / ${Object.keys(allBounds).length} total`);
console.log(`  Passed:   ${passed}`);
console.log(`  Failed:   ${failed}`);
console.log(`  Warnings: ${warned}`);

if (failures.length > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`    - ${f}`);
}
if (warnings.length > 0) {
  console.log('\n  Warnings:');
  for (const w of warnings) console.log(`    - ${w}`);
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
