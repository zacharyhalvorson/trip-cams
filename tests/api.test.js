#!/usr/bin/env node
/* =============================================================
   api.test.js — Transport + region health tests for js/api.js

   Evaluates the browser module with an injected fetch/localStorage
   so the hedged transport chain, transport memory, bundled fallback,
   and region health reporting can be tested without a browser or
   network access.

   Run:  node tests/api.test.js
   ============================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const camerasSrc = fs.readFileSync(path.join(ROOT, 'js/cameras.js'), 'utf-8');
const apiSrc = fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf-8');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ok    ${msg}`); }
  else { failed++; console.log(`  FAIL  ${msg}`); }
}

// Build an API instance with a mocked network. `store` (a Map) backs
// localStorage and can be shared between instances to simulate reloads.
function makeAPI(fetchImpl, store = new Map()) {
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const Cameras = new Function(`${camerasSrc};return Cameras;`)();
  const API = new Function(
    'Cameras', 'localStorage', 'navigator', 'fetch',
    `${apiSrc};return API;`
  )(Cameras, localStorage, { onLine: true }, fetchImpl);
  return { API, store };
}

const IBI_PAYLOAD = [{
  Id: 1, Latitude: 51.0, Longitude: -114.0, Location: 'Test Cam', Roadway: 'Hwy 1',
  Views: [{ Id: 0, Url: 'https://example.com/cam.jpg', Status: 'Enabled' }],
}];

const jsonResponse = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
const notFound = () => ({ ok: false, status: 404, text: async () => '' });

// A fetch that never responds but honors abort (hanging endpoint)
const hangingFetch = (url, opts) => new Promise((resolve, reject) => {
  const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  if (opts?.signal) {
    if (opts.signal.aborted) return abort();
    opts.signal.addEventListener('abort', abort, { once: true });
  }
});

const AB_URL = 'https://511.alberta.ca';
const isProxied = (url) => !url.startsWith(AB_URL) && !url.startsWith('./');

async function run() {
  console.log('\n── Direct fetch works, health reported ok ──');
  {
    const calls = [];
    const { API } = makeAPI(async (url) => {
      calls.push(url);
      if (url.startsWith(AB_URL)) return jsonResponse(IBI_PAYLOAD);
      throw new Error('network error');
    });
    const results = {};
    await API.fetchProgressive((r, res) => { results[r] = res; }, new Set(['AB']));
    assert(results.AB && results.AB.data.length === 1, 'AB returns 1 normalized camera');
    assert(API.getRegionHealth().AB?.status === 'ok', 'AB health is ok');
    assert(calls.length === 1 && !isProxied(calls[0]), 'exactly one direct request made');
  }

  console.log('\n── Direct blocked → proxy succeeds → transport remembered ──');
  const sharedStore = new Map();
  {
    const calls = [];
    const { API } = makeAPI(async (url) => {
      calls.push(url);
      if (!isProxied(url)) throw new TypeError('Failed to fetch'); // CORS-style failure
      return jsonResponse(IBI_PAYLOAD);
    }, sharedStore);
    const results = {};
    await API.fetchProgressive((r, res) => { results[r] = res; }, new Set(['AB']));
    assert(results.AB.data.length === 1, 'AB loads via proxy after direct fails');
    assert(API.getRegionHealth().AB?.status === 'ok', 'AB health ok via proxy');
    const prefs = JSON.parse(sharedStore.get('tripcams_transports') || '{}');
    assert(prefs['511.alberta.ca'] === 0, 'winning proxy remembered for host');
  }

  console.log('\n── Next session starts on the remembered transport ──');
  {
    const calls = [];
    const { API } = makeAPI(async (url) => {
      calls.push(url);
      if (isProxied(url)) return jsonResponse(IBI_PAYLOAD);
      throw new TypeError('Failed to fetch');
    }, sharedStore);
    API.clearCache(); // drop cached camera data, keep transport prefs
    const results = {};
    await API.fetchProgressive((r, res) => { results[r] = res; }, new Set(['AB']));
    assert(results.AB.data.length === 1, 'AB loads again');
    assert(calls.length >= 1 && isProxied(calls[0]), 'first request goes straight to the remembered proxy');
  }

  console.log('\n── Total failure → bundled fallback (AB has one) ──');
  {
    const { API } = makeAPI(async (url) => {
      if (url.startsWith('./data/cameras-ab.json')) {
        const raw = fs.readFileSync(path.join(ROOT, 'data/cameras-ab.json'), 'utf-8');
        return { ok: true, status: 200, text: async () => raw, json: async () => JSON.parse(raw) };
      }
      throw new TypeError('Failed to fetch');
    });
    const results = {};
    await API.fetchProgressive((r, res) => { results[r] = res; }, new Set(['AB']));
    assert(results.AB.data.length > 0, `AB serves ${results.AB.data.length} cameras from bundled fallback`);
    assert(API.getRegionHealth().AB?.status === 'fallback', 'AB health is fallback');
  }

  console.log('\n── Total failure, no fallback file → health failed ──');
  {
    const { API } = makeAPI(async (url) => {
      if (url.startsWith('./')) return notFound();
      throw new TypeError('Failed to fetch');
    });
    const results = {};
    await API.fetchProgressive((r, res) => { results[r] = res; }, new Set(['SK']));
    assert(results.SK.data.length === 0, 'SK returns no cameras');
    assert(API.getRegionHealth().SK?.status === 'failed', 'SK health is failed');
    assert(!!API.getRegionHealth().SK?.error, 'SK health carries an error message');
  }

  console.log('\n── Hedging: hanging direct does not block a fast proxy ──');
  {
    const { API } = makeAPI(async (url, opts) => {
      if (!isProxied(url)) return hangingFetch(url, opts); // direct hangs until aborted
      return jsonResponse(IBI_PAYLOAD);
    });
    const t0 = Date.now();
    const results = {};
    await API.fetchProgressive((r, res) => { results[r] = res; }, new Set(['AB']));
    const elapsed = Date.now() - t0;
    assert(results.AB.data.length === 1, 'AB loads despite hanging direct fetch');
    assert(elapsed < 6000, `resolved in ${elapsed}ms (hedged, not serialized behind the 8s direct timeout)`);
  }

  console.log('\n── Multi-state endpoints fan health out to sibling regions ──');
  {
    const { API } = makeAPI(async (url) => {
      if (url.includes('newengland511')) return jsonResponse(IBI_PAYLOAD);
      if (url.startsWith('./')) return notFound();
      throw new TypeError('Failed to fetch');
    });
    const results = {};
    await API.fetchProgressive((r, res) => { results[r] = res; }, new Set(['VT', 'NH', 'ME']));
    const health = API.getRegionHealth();
    assert(health.VT?.status === 'ok' && health.NH?.status === 'ok' && health.ME?.status === 'ok',
      'VT/NH/ME all report ok from the single shared fetch');
  }

  console.log(`\n── Summary ──\n  Passed: ${passed}\n  Failed: ${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
