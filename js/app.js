/* =============================================================
   app.js — Main application init, UI rendering, interactions
   ============================================================= */

const App = (() => {
  let routeData = null;
  let allStops = [];
  let allCameras = [];
  let filteredCameras = [];
  let currentWaypoints = [];
  let activeRegion = 'all';
  let fromStop = null;
  let toStop = null;
  let dropdownTarget = null; // 'from' or 'to'
  let autoRefreshInterval = null;
  let currentModalCamera = null;
  let sheetExpanded = false; // true when sheet is pulled up (20vh map)
  let _mapInitiatedScroll = false; // true when map viewport change is scrolling the list

  const PREFS_KEY = 'tripcams_prefs';
  const ROUTE_DATA_KEY = 'tripcams_route_data';
  const HISTORY_KEY = 'tripcams_destination_history';
  const MAX_HISTORY = 8;
  const INITIAL_RENDER_BATCH = 12; // Cards to render immediately; rest deferred

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        from: fromStop?.id || null,
        to: toStop?.id || null,
        region: activeRegion,
      }));
    } catch (e) { /* ignore */ }
  }

  function loadPrefs() {
    try {
      const stored = localStorage.getItem(PREFS_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (e) { return null; }
  }

  function saveRouteData(data) {
    try {
      localStorage.setItem(ROUTE_DATA_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch (e) { /* ignore */ }
  }

  function loadRouteData() {
    try {
      const stored = localStorage.getItem(ROUTE_DATA_KEY);
      if (stored) return JSON.parse(stored).data;
    } catch (e) { /* ignore */ }
    return null;
  }

  function loadHistory() {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) { return []; }
  }

  function saveHistory(stopId) {
    try {
      let history = loadHistory();
      // Remove if already present, then prepend
      history = history.filter(id => id !== stopId);
      history.unshift(stopId);
      // Cap at max
      if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) { /* ignore */ }
  }

  // Connection quality detection
  function isSlowConnection() {
    if (!navigator.onLine) return true;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    // saveData flag or effective type is slow
    if (conn.saveData) return true;
    if (conn.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) return true;
    return false;
  }

  // DOM refs
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {};

  function cacheDom() {
    dom.fromInput = $('#fromInput');
    dom.fromValue = $('#fromValue');
    dom.toInput = $('#toInput');
    dom.toValue = $('#toValue');
    dom.swapBtn = $('#swapBtn');
    dom.locateBtn = $('#locateBtn');
    dom.dropdown = $('#dropdown');
    dom.dropdownOverlay = $('#dropdownOverlay');
    dom.dropdownSearch = $('#dropdownSearch');
    dom.dropdownList = $('#dropdownList');
    dom.mapContainer = $('#mapContainer');
    dom.mapToggle = $('#mapToggle');
    dom.centerMapBtn = $('#centerMapBtn');
    dom.sheet = $('#sheet');
    dom.sheetHandle = $('#sheetHandle');
    dom.cameraList = $('#cameraList');
    dom.skeletonList = $('#skeletonList');
    dom.cameraCount = $('#cameraCount');
    dom.countNumber = $('#countNumber');
    dom.refreshBtn = $('#refreshBtn');
    dom.modalOverlay = $('#modalOverlay');
    dom.modal = $('#modal');
    dom.modalName = $('#modalName');
    dom.modalInfo = $('#modalInfo');
    dom.modalImage = $('#modalImage');
    dom.modalLoading = $('#modalLoading');
    dom.modalClose = $('#modalClose');
    dom.autoRefreshToggle = $('#autoRefreshToggle');
    dom.lastRefreshed = $('#lastRefreshed');
    dom.offlineBanner = $('#offlineBanner');
    dom.filterBtn = $('#filterBtn');
    dom.filterOverlay = $('#filterOverlay');
    dom.filterClose = $('#filterClose');
  }

  async function init() {
    cacheDom();
    bindEvents();
    registerServiceWorker();
    TripMap.init();

    // Sync camera list when user pans/zooms the map
    TripMap.onViewportChange((visibleIds) => {
      if (visibleIds.length === 0) return;

      // Find the first camera card (in list/route order) that's in the viewport
      const cards = dom.cameraList.querySelectorAll('.camera-card');
      const visibleSet = new Set(visibleIds);
      for (const card of cards) {
        if (visibleSet.has(card.dataset.id)) {
          _mapInitiatedScroll = true;
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          card.classList.add('highlighted');
          setTimeout(() => card.classList.remove('highlighted'), 2000);
          // Clear flag after scroll settles
          setTimeout(() => { _mapInitiatedScroll = false; }, 800);
          break;
        }
      }
    });

    // Load route data — try localStorage first for instant startup
    const cachedRouteData = loadRouteData();
    if (cachedRouteData) {
      routeData = cachedRouteData;
    }
    try {
      const resp = await fetch('data/route.json');
      routeData = await resp.json();
      saveRouteData(routeData);
    } catch (e) {
      if (!routeData) {
        console.error('Failed to load route data:', e);
        return;
      }
      // Using cached route data — fine for offline
    }

    allStops = Cameras.getAllStops(routeData);

    // Parse URL hash for initial stops
    parseHash();

    // If no hash, restore saved preferences
    if (!fromStop && !toStop) {
      const prefs = loadPrefs();
      if (prefs) {
        if (prefs.from) fromStop = allStops.find(s => s.id === prefs.from) || null;
        if (prefs.to) toStop = allStops.find(s => s.id === prefs.to) || null;
        if (prefs.region && ['all', 'AB', 'BC', 'WA'].includes(prefs.region)) {
          activeRegion = prefs.region;
          for (const p of $$('.pill')) p.classList.toggle('active', p.dataset.region === activeRegion);
          dom.filterBtn.classList.toggle('has-filter', activeRegion !== 'all');
        }
      }
    }

    // Set defaults if not from hash or prefs
    if (!fromStop) fromStop = allStops.find(s => s.id === 'calgary') || allStops[0];
    if (!toStop) toStop = allStops.find(s => s.id === 'seattle') || allStops[allStops.length - 1];

    updateRouteDisplay();
    updateRoute();

    // Online/offline detection
    updateOnlineStatus();

    // Defer camera loading until after first paint so the UI is interactive sooner
    requestAnimationFrame(() => {
      loadCameras();
    });
  }

  function bindEvents() {
    // Route inputs
    dom.fromInput.addEventListener('click', () => openDropdown('from'));
    dom.toInput.addEventListener('click', () => openDropdown('to'));
    dom.swapBtn.addEventListener('click', swapStops);
    dom.locateBtn.addEventListener('click', locateUser);

    // Dropdown
    dom.dropdownOverlay.addEventListener('click', closeDropdown);
    dom.dropdownSearch.addEventListener('input', filterDropdown);

    // Map toggle
    dom.mapToggle.addEventListener('click', toggleMap);
    dom.centerMapBtn.addEventListener('click', centerMap);

    // Filter modal
    dom.filterBtn.addEventListener('click', openFilterModal);
    dom.filterClose.addEventListener('click', closeFilterModal);
    dom.filterOverlay.addEventListener('click', (e) => {
      if (e.target === dom.filterOverlay) closeFilterModal();
    });

    // Filter pills (inside filter modal)
    for (const pill of $$('.pill')) {
      pill.addEventListener('click', () => {
        activeRegion = pill.dataset.region;
        for (const p of $$('.pill')) p.classList.toggle('active', p.dataset.region === activeRegion);
        // Update filter button indicator
        dom.filterBtn.classList.toggle('has-filter', activeRegion !== 'all');
        applyFilters();
        closeFilterModal();
        savePrefs();
      });
    }

    // Refresh
    dom.refreshBtn.addEventListener('click', refreshCameras);

    // Modal
    dom.modalClose.addEventListener('click', closeModal);
    dom.modalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.modalOverlay) closeModal();
    });
    dom.autoRefreshToggle.addEventListener('change', toggleAutoRefresh);

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (dom.modalOverlay.classList.contains('active')) closeModal();
        else if (dom.filterOverlay.classList.contains('active')) closeFilterModal();
        else if (dom.dropdown.classList.contains('active')) closeDropdown();
      }
    });

    // Online/offline
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Bottom sheet drag
    initSheetDrag();
  }

  // ── Route Selection ──────────────────────────────────────────

  function openDropdown(target) {
    dropdownTarget = target;
    dom.dropdown.classList.add('active');
    dom.dropdownOverlay.classList.add('active');
    dom.dropdownSearch.value = '';
    renderDropdownList('');
    requestAnimationFrame(() => dom.dropdownSearch.focus());
  }

  function closeDropdown() {
    dom.dropdown.classList.remove('active');
    dom.dropdownOverlay.classList.remove('active');
    dropdownTarget = null;
  }

  function filterDropdown() {
    renderDropdownList(dom.dropdownSearch.value);
  }

  function createStopLi(stop) {
    const li = document.createElement('li');
    li.dataset.id = stop.id;
    li.tabIndex = 0;
    li.innerHTML = `<span class="city-name">${stop.name}</span><span class="city-region ${stop.region}">${stop.region}</span>`;
    li.addEventListener('click', () => selectStop(stop.id));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectStop(stop.id); });
    return li;
  }

  function renderDropdownList(query) {
    dom.dropdownList.innerHTML = '';
    const q = query.toLowerCase().trim();
    const history = loadHistory();

    // Show recent section when not searching and there's history
    if (!q && history.length > 0) {
      const recentStops = history
        .map(id => allStops.find(s => s.id === id))
        .filter(Boolean);

      if (recentStops.length > 0) {
        const header = document.createElement('li');
        header.className = 'dropdown-section-header';
        header.textContent = 'Recent';
        dom.dropdownList.appendChild(header);

        for (const stop of recentStops) {
          dom.dropdownList.appendChild(createStopLi(stop));
        }

        const allHeader = document.createElement('li');
        allHeader.className = 'dropdown-section-header';
        allHeader.textContent = 'All destinations';
        dom.dropdownList.appendChild(allHeader);
      }
    }

    for (const stop of allStops) {
      const searchText = (stop.name + ' ' + stop.region).toLowerCase();
      if (!q || searchText.includes(q)) {
        dom.dropdownList.appendChild(createStopLi(stop));
      }
    }
  }

  function selectStop(stopId) {
    const stop = allStops.find(s => s.id === stopId);
    if (!stop) return;

    if (dropdownTarget === 'from') {
      fromStop = stop;
    } else {
      toStop = stop;
    }

    saveHistory(stopId);

    closeDropdown();
    updateRouteDisplay();
    updateRoute();
    loadCameras();
    updateHash();
    savePrefs();
  }

  function swapStops() {
    const temp = fromStop;
    fromStop = toStop;
    toStop = temp;
    updateRouteDisplay();
    updateRoute();
    applyFilters();
    updateHash();
    savePrefs();
    if (fromStop) saveHistory(fromStop.id);
    if (toStop) saveHistory(toStop.id);

    // Animate the swap button
    dom.swapBtn.style.transform = 'scale(0.85) rotate(180deg)';
    setTimeout(() => { dom.swapBtn.style.transform = ''; }, 300);
  }

  function updateRouteDisplay() {
    if (fromStop) dom.fromValue.textContent = `${fromStop.name}, ${fromStop.region}`;
    if (toStop) dom.toValue.textContent = `${toStop.name}, ${toStop.region}`;
  }

  function updateRoute() {
    if (!routeData || !fromStop || !toStop) return;
    currentWaypoints = Cameras.findRoute(routeData, fromStop.id, toStop.id);
    TripMap.drawRoute(currentWaypoints);
    TripMap.fitToRoute(currentWaypoints);
  }

  // ── URL Hash ─────────────────────────────────────────────────

  function parseHash() {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const from = params.get('from');
    const to = params.get('to');
    if (from) fromStop = allStops.find(s => s.id === from) || null;
    if (to) toStop = allStops.find(s => s.id === to) || null;
  }

  function updateHash() {
    if (fromStop && toStop) {
      window.location.hash = `from=${fromStop.id}&to=${toStop.id}`;
    }
  }

  // ── Geolocation ──────────────────────────────────────────────

  function locateUser() {
    if (!navigator.geolocation) return;

    dom.locateBtn.style.color = 'var(--green)';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        TripMap.showUserLocation(latitude, longitude);

        // Snap to nearest stop for "from"
        const nearest = Cameras.nearestStop(latitude, longitude, allStops);
        fromStop = nearest;
        if (nearest) saveHistory(nearest.id);
        updateRouteDisplay();
        updateRoute();
        applyFilters();
        updateHash();
        savePrefs();
      },
      (err) => {
        console.warn('Geolocation failed:', err.message);
        dom.locateBtn.style.color = '';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // ── Camera Loading ───────────────────────────────────────────

  async function loadCameras() {
    dom.skeletonList.classList.remove('hidden');
    removeCameraCards();
    allCameras = [];
    let anyFromCache = false;

    // Show loading state instead of confusing "0 cameras"
    dom.countNumber.textContent = '';
    dom.countNumber.classList.add('loading');
    dom.cameraCount.classList.add('loading');

    // Determine which regions the route passes through
    const neededRegions = new Set();
    if (currentWaypoints.length > 0) {
      for (const wp of currentWaypoints) {
        neededRegions.add(wp.region);
      }
    }

    await API.fetchProgressive((region, result) => {
      if (result.fromCache) anyFromCache = true;
      allCameras = allCameras.concat(result.data || []);
      applyFilters();
      // Once first results arrive, remove loading state on count
      dom.countNumber.classList.remove('loading');
      dom.cameraCount.classList.remove('loading');
    }, neededRegions.size > 0 ? neededRegions : null);

    if (anyFromCache && !navigator.onLine) {
      dom.offlineBanner.classList.add('visible');
    }
    dom.skeletonList.classList.add('hidden');
    dom.countNumber.classList.remove('loading');
    dom.cameraCount.classList.remove('loading');
  }

  async function refreshCameras() {
    dom.refreshBtn.classList.add('spinning');
    API.clearCache();
    // Also clear Service Worker image cache so fresh images are fetched
    if ('caches' in window) {
      await caches.delete('tripcams-images-v1').catch(() => {});
    }
    await loadCameras();
    setTimeout(() => dom.refreshBtn.classList.remove('spinning'), 500);
  }

  function applyFilters() {
    // Filter by corridor
    let cameras = currentWaypoints.length > 0
      ? Cameras.filterByCorridor(allCameras, currentWaypoints, routeData?.corridorBuffer || 30)
      : allCameras;

    // Filter by region
    if (activeRegion !== 'all') {
      cameras = cameras.filter(c => c.region === activeRegion);
    }

    // Sort by route order
    if (currentWaypoints.length > 0) {
      cameras = Cameras.sortByRoute(cameras, currentWaypoints);
    }

    filteredCameras = cameras;
    renderCameraList(cameras);
    TripMap.setMarkers(cameras, onMarkerClick);
    dom.countNumber.textContent = cameras.length;
  }

  // ── Camera List Rendering ────────────────────────────────────

  function removeCameraCards() {
    const cards = dom.cameraList.querySelectorAll('.camera-card, .empty-state');
    cards.forEach(c => c.remove());
  }

  function buildCameraCard(cam, index) {
    const card = document.createElement('div');
    card.dataset.id = cam.id;
    card.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

    const hasImage = cam.imageUrl && cam.status === 'active';

    if (hasImage) {
      card.className = 'camera-card';
      const imgSrc = cam.thumbnailUrl || cam.imageUrl;
      card.innerHTML = `
        <div class="camera-thumb">
          <img src="img/placeholder.svg"
               data-src="${imgSrc}"
               alt="${cam.name}"
               width="640" height="360"
               loading="lazy">
          <span class="thumb-region ${cam.region}">${cam.region}</span>
        </div>
        <div class="camera-info">
          <div class="camera-name">${cam.name}</div>
          <div class="camera-highway">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5"/>
            </svg>
            ${cam.highway}${cam.direction ? ' · ' + cam.direction : ''}
          </div>
          <div class="camera-status">
            <span class="status-dot"></span>
            Live
          </div>
        </div>
      `;
      card.addEventListener('click', () => openModal(cam));
    } else {
      card.className = 'camera-card camera-card-disabled';
      card.innerHTML = `
        <span class="thumb-region ${cam.region}">${cam.region}</span>
        <span class="camera-name">${cam.name}</span>
        <span class="camera-highway-inline">${cam.highway}${cam.direction ? ' · ' + cam.direction : ''}</span>
        <span class="camera-status offline"><span class="status-dot"></span>Offline</span>
      `;
    }

    return card;
  }

  let _pendingRenderRaf = null;

  function renderCameraList(cameras) {
    removeCameraCards();
    if (_pendingRenderRaf) { cancelAnimationFrame(_pendingRenderRaf); _pendingRenderRaf = null; }

    if (cameras.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <h3>No cameras found</h3>
        <p>Try adjusting your route or filters to see cameras along this corridor.</p>
      `;
      dom.cameraList.appendChild(empty);
      return;
    }

    // Render first batch immediately for fast initial paint
    const firstBatch = cameras.slice(0, INITIAL_RENDER_BATCH);
    const restBatch = cameras.slice(INITIAL_RENDER_BATCH);

    const fragment = document.createDocumentFragment();
    firstBatch.forEach((cam, i) => fragment.appendChild(buildCameraCard(cam, i)));
    dom.cameraList.appendChild(fragment);

    // Defer remaining cards to next frame so UI is interactive sooner
    if (restBatch.length > 0) {
      _pendingRenderRaf = requestAnimationFrame(() => {
        _pendingRenderRaf = null;
        const restFragment = document.createDocumentFragment();
        restBatch.forEach((cam, i) =>
          restFragment.appendChild(buildCameraCard(cam, INITIAL_RENDER_BATCH + i))
        );
        dom.cameraList.appendChild(restFragment);

        // Re-setup observers for the new cards
        setupLazyLoading();
        setupScrollTracking(cameras);
        prefetchUpcoming(cameras);
      });
    }

    // Setup observers for first batch immediately
    setupLazyLoading();
    setupScrollTracking(cameras);
    prefetchUpcoming(cameras);
  }

  // Time-bucketed cache key: same URL reused within each bucket so SW cache hits.
  // On good connections: 5-min buckets. On slow/offline: 30-min buckets.
  function cacheBustUrl(src) {
    const bucketMs = isSlowConnection() ? 30 * 60 * 1000 : 5 * 60 * 1000;
    const bucket = Math.floor(Date.now() / bucketMs) * bucketMs;
    const sep = src.includes('?') ? '&' : '?';
    return src + sep + '_t=' + bucket;
  }

  function setupLazyLoading() {
    const images = dom.cameraList.querySelectorAll('img[data-src]');
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.src = cacheBustUrl(img.dataset.src);
            img.removeAttribute('data-src');
            img.onerror = () => { img.src = 'img/placeholder.svg'; };
            observer.unobserve(img);
          }
        }
      }, { rootMargin: getLazyMargin() });

      images.forEach(img => observer.observe(img));
    } else {
      // Fallback: load all
      images.forEach(img => {
        img.src = cacheBustUrl(img.dataset.src);
        img.removeAttribute('data-src');
      });
    }
  }

  // Lazy-load rootMargin: load more ahead on fast connections, less on slow
  function getLazyMargin() {
    if (isSlowConnection()) return '50px';   // Conservative on slow connections
    return '400px';                           // Aggressive prefetch on fast connections
  }

  // ── Prefetch upcoming camera images into SW cache ────────────

  function prefetchUpcoming(cameras) {
    // On slow connections, skip prefetching to save bandwidth
    if (isSlowConnection()) return;

    // Prefetch thumbnails for the first N cameras that haven't loaded yet
    const PREFETCH_COUNT = 6;
    const activeCameras = cameras
      .filter(c => c.imageUrl && c.status === 'active')
      .slice(0, INITIAL_RENDER_BATCH + PREFETCH_COUNT);

    // Use low-priority link prefetch hints for cameras just beyond the viewport
    const existing = document.querySelectorAll('link[data-prefetch-cam]');
    existing.forEach(el => el.remove());

    activeCameras.slice(INITIAL_RENDER_BATCH).forEach(cam => {
      const src = cam.thumbnailUrl || cam.imageUrl;
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'image';
      link.href = cacheBustUrl(src);
      link.dataset.prefetchCam = '1';
      document.head.appendChild(link);
    });
  }

  // ── Scroll Tracking (highlight markers for visible cards) ────

  let scrollTrackingObserver = null;

  function setupScrollTracking(cameras) {
    if (scrollTrackingObserver) scrollTrackingObserver.disconnect();
    if (!('IntersectionObserver' in window)) return;

    const visibleIds = new Set();

    scrollTrackingObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.dataset.id;
        if (entry.isIntersecting) {
          visibleIds.add(id);
        } else {
          visibleIds.delete(id);
        }
      }
      TripMap.highlightVisible(visibleIds);
      // When sheet is expanded, zoom map to show visible cameras
      // (but not if the map itself triggered this scroll)
      if (sheetExpanded && !_mapInitiatedScroll) {
        TripMap.fitToVisible(visibleIds);
      }
    }, {
      root: dom.cameraList,
      rootMargin: '0px',
      threshold: 0.5,
    });

    const cards = dom.cameraList.querySelectorAll('.camera-card');
    cards.forEach(card => scrollTrackingObserver.observe(card));
  }

  // ── Map Interactions ─────────────────────────────────────────

  function onMarkerClick(cam) {
    // Scroll to card in list
    const card = dom.cameraList.querySelector(`[data-id="${cam.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('highlighted');
      setTimeout(() => card.classList.remove('highlighted'), 2000);
    }
    openModal(cam);
  }

  function toggleMap() {
    dom.mapContainer.classList.toggle('collapsed');
    TripMap.invalidateSize();
  }

  function centerMap() {
    if (currentWaypoints.length > 0) {
      TripMap.fitToRoute(currentWaypoints);
    }
  }

  // ── Filter Modal ─────────────────────────────────────────────

  function openFilterModal() {
    dom.filterOverlay.classList.add('active');
  }

  function closeFilterModal() {
    dom.filterOverlay.classList.remove('active');
  }

  // ── Bottom Sheet Drag ────────────────────────────────────────

  function initSheetDrag() {
    const handle = dom.sheetHandle;
    const sheet = dom.sheet;
    const mapContainer = dom.mapContainer;
    let startY = 0;
    let startTop = 0;
    let isDragging = false;

    function getSheetTop() {
      return sheet.getBoundingClientRect().top;
    }

    function onStart(e) {
      isDragging = true;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startTop = getSheetTop();
      sheet.style.transition = 'none';
      mapContainer.style.transition = 'none';
    }

    function onMove(e) {
      if (!isDragging) return;
      e.preventDefault();
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const delta = y - startY;
      const headerHeight = document.querySelector('.header').offsetHeight;
      const minTop = headerHeight;
      const maxTop = window.innerHeight - 120;
      const newTop = Math.max(minTop, Math.min(maxTop, startTop + delta));

      sheet.style.top = newTop + 'px';
      mapContainer.style.height = (newTop - headerHeight) + 'px';
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;
      sheet.style.transition = '';
      mapContainer.style.transition = '';

      const headerHeight = document.querySelector('.header').offsetHeight;
      const currentTop = getSheetTop();
      const windowHeight = window.innerHeight;
      const midpoint = headerHeight + (windowHeight - headerHeight) * 0.4;

      // Snap to either expanded (mostly list) or collapsed (mostly map)
      if (currentTop < midpoint) {
        // Show mostly list — zoom map to visible cameras
        mapContainer.style.height = '20vh';
        sheet.style.top = `calc(${headerHeight}px + 20vh)`;
        sheetExpanded = true;
        TripMap.invalidateSize();
        // After map resizes, fit to currently visible cards
        setTimeout(() => {
          const visibleCards = dom.cameraList.querySelectorAll('.camera-card');
          const visibleIds = new Set();
          for (const card of visibleCards) {
            const rect = card.getBoundingClientRect();
            const listRect = dom.cameraList.getBoundingClientRect();
            if (rect.top < listRect.bottom && rect.bottom > listRect.top) {
              visibleIds.add(card.dataset.id);
            }
          }
          if (visibleIds.size > 0) {
            TripMap.fitToVisible(visibleIds);
          }
        }, 200);
      } else {
        // Show mostly map — zoom out to full route
        mapContainer.style.height = '50vh';
        sheet.style.top = `calc(${headerHeight}px + 50vh)`;
        sheetExpanded = false;
        TripMap.invalidateSize();
        setTimeout(() => TripMap.fitToRoute(currentWaypoints), 200);
      }
    }

    handle.addEventListener('touchstart', onStart, { passive: true });
    handle.addEventListener('mousedown', onStart);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('mouseup', onEnd);
  }

  // ── Modal ────────────────────────────────────────────────────

  function openModal(cam) {
    currentModalCamera = cam;
    dom.modalName.textContent = cam.name;
    dom.modalInfo.textContent = `${cam.highway}${cam.direction ? ' · ' + cam.direction : ''} · ${cam.region}`;

    // Load full image
    dom.modalLoading.classList.add('active');
    dom.modalImage.src = '';
    dom.modalImage.onload = () => {
      dom.modalLoading.classList.remove('active');
      updateLastRefreshed();
    };
    dom.modalImage.onerror = () => {
      dom.modalLoading.classList.remove('active');
      dom.modalImage.src = 'img/placeholder.svg';
    };
    dom.modalImage.src = cam.imageUrl || 'img/placeholder.svg';

    dom.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Highlight on map
    TripMap.highlightMarker(cam.id);
    TripMap.panTo(cam.lat, cam.lon);
  }

  function closeModal() {
    dom.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    currentModalCamera = null;
    stopAutoRefresh();
    dom.autoRefreshToggle.checked = false;
  }

  function toggleAutoRefresh() {
    if (dom.autoRefreshToggle.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshInterval = setInterval(() => {
      if (!currentModalCamera) return;
      const cam = currentModalCamera;
      dom.modalLoading.classList.add('active');
      const img = new Image();
      img.onload = () => {
        dom.modalImage.src = img.src;
        dom.modalLoading.classList.remove('active');
        updateLastRefreshed();
      };
      img.onerror = () => {
        dom.modalLoading.classList.remove('active');
      };
      // Cache-bust (use Date.now() here — modal auto-refresh should show latest)
      const sep = cam.imageUrl.includes('?') ? '&' : '?';
      img.src = cam.imageUrl + sep + '_t=' + Date.now();
    }, 15000); // every 15 seconds
  }

  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }

  function updateLastRefreshed() {
    const now = new Date();
    dom.lastRefreshed.textContent = `Updated ${now.toLocaleTimeString()}`;
  }

  // ── Online/Offline ───────────────────────────────────────────

  function updateOnlineStatus() {
    if (navigator.onLine) {
      dom.offlineBanner.classList.remove('visible');
    } else {
      dom.offlineBanner.classList.add('visible');
    }
  }

  // ── Service Worker ───────────────────────────────────────────

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.warn('SW registration failed:', err);
      });
    }
  }

  // ── Boot ─────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();
