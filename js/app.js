/* =============================================================
   app.js — Main application init, UI rendering, interactions
   ============================================================= */

const App = (() => {
  let routeData = null;
  let allStops = [];
  let allCameras = [];
  let filteredCameras = [];
  let currentWaypoints = [];
  let currentRouteGeometry = null; // Dense OSRM road geometry for precise filtering
  let fromStop = null;
  let toStop = null;
  let dropdownTarget = null; // 'from' or 'to'
  let autoRefreshInterval = null;
  let currentModalCamera = null;
  let sheetRevealed = false; // true once the sheet has been revealed (one-way)
  let _mapInitiatedScroll = false; // true when map viewport change is scrolling the list
  let _userHasInteractedWithMap = false; // true after first user pan/zoom on the map
  let _focusedCameraId = null; // the camera card currently centered in the list
  let userLocation = null; // { lat, lon, nearestStop } when geolocation available

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
    dom.pullToRefresh = $('#pullToRefresh');
  }

  async function init() {
    cacheDom();
    bindEvents();
    registerServiceWorker();
    TripMap.init();

    // Sync CSS --header-height with actual header size
    const hh = document.querySelector('.header').offsetHeight;
    document.documentElement.style.setProperty('--header-height', hh + 'px');

    // On wide layouts, the expanded view is always active
    function syncLayout() {
      if (isWideLayout()) {
        document.body.classList.add('sheet-expanded');
        dom.sheet.classList.add('revealed');
        dom.cameraList.style.overflowY = '';
      } else if (!sheetRevealed) {
        dom.cameraList.style.overflowY = 'hidden';
      }
    }
    syncLayout();
    window.addEventListener('resize', syncLayout);

    // Mark when user first interacts with the map (pan/zoom)
    for (const evt of ['mousedown', 'touchstart', 'wheel']) {
      dom.mapContainer.addEventListener(evt, () => {
        _userHasInteractedWithMap = true;
      }, { once: true, passive: true });
    }

    // Sync camera list when user pans/zooms the map
    // Skip until user has actually interacted with the map to avoid
    // auto-scrolling the list away from the top on initial load.
    TripMap.onViewportChange((visibleIds) => {
      if (!_userHasInteractedWithMap) return;
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

    // If we have cached route data, set up the route immediately (no waiting)
    if (routeData) {
      _initRouteAndCameras();
    }

    // Fetch fresh route.json in background — update if different
    fetch('data/route.json')
      .then(resp => resp.json())
      .then(freshData => {
        const hadRouteData = !!routeData;
        routeData = freshData;
        saveRouteData(routeData);
        // If we didn't have cached data, initialize now
        if (!hadRouteData) {
          _initRouteAndCameras();
        }
      })
      .catch(e => {
        if (!routeData) {
          console.error('Failed to load route data:', e);
          // Show error to user instead of silent skeleton forever
          dom.skeletonList.classList.add('hidden');
          const errorDiv = document.createElement('div');
          errorDiv.className = 'empty-state';
          errorDiv.innerHTML = `
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
            <h3>Failed to load route data</h3>
            <p>Check your connection and try refreshing the page.</p>
          `;
          dom.cameraList.appendChild(errorDiv);
        }
      });

    // Detect user location so it can appear in the picker
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          TripMap.showUserLocation(latitude, longitude);
          const nearest = Cameras.nearestStop(latitude, longitude, allStops);
          if (nearest) {
            userLocation = { lat: latitude, lon: longitude, nearestStop: nearest };
          }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }

    // Online/offline detection
    updateOnlineStatus();
  }

  // Extract route setup + camera loading so it can run immediately from cache
  function _initRouteAndCameras() {
    allStops = Cameras.getAllStops(routeData);

    // Parse URL hash for initial stops
    parseHash();

    // If no hash, restore saved preferences
    if (!fromStop && !toStop) {
      const prefs = loadPrefs();
      if (prefs) {
        if (prefs.from) fromStop = allStops.find(s => s.id === prefs.from) || null;
        if (prefs.to) toStop = allStops.find(s => s.id === prefs.to) || null;
      }
    }

    // Set defaults if not from hash or prefs
    if (!fromStop) fromStop = allStops.find(s => s.id === 'calgary') || allStops[0];
    if (!toStop) toStop = allStops.find(s => s.id === 'seattle') || allStops[allStops.length - 1];

    updateRouteDisplay();
    updateRoute();

    // Start camera loading immediately — no RAF delay
    loadCameras();
  }

  function bindEvents() {
    // Route inputs
    dom.fromInput.addEventListener('click', () => openDropdown('from'));
    dom.toInput.addEventListener('click', () => openDropdown('to'));
    dom.swapBtn.addEventListener('click', swapStops);

    // Dropdown
    dom.dropdownOverlay.addEventListener('click', closeDropdown);
    dom.dropdownSearch.addEventListener('input', filterDropdown);

    // Map toggle
    dom.mapToggle.addEventListener('click', toggleMap);
    dom.centerMapBtn.addEventListener('click', centerMap);


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
        else if (dom.dropdown.classList.contains('active')) closeDropdown();
      }
    });

    // Online/offline
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // List scroll interactions (reveal + pull-to-refresh)
    initListScrollExpand();
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

    // Show "Current Location" option when geolocation is available
    if (userLocation && (!q || 'current location'.includes(q) ||
        userLocation.nearestStop.name.toLowerCase().includes(q))) {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.className = 'location-option';
      li.innerHTML = `<svg class="location-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg><span class="city-name">Current Location</span><span class="city-region ${userLocation.nearestStop.region}">${userLocation.nearestStop.name}</span>`;
      li.addEventListener('click', snapToCurrentLocation);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') snapToCurrentLocation(); });
      dom.dropdownList.appendChild(li);
    }

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
    currentRouteGeometry = null; // Reset until OSRM geometry loads
    _lastFilteredIds = ''; // Reset so filters re-render for new route
    TripMap.drawRoute(currentWaypoints);
    TripMap.fitToRoute(currentWaypoints);

    // Fetch precise OSRM road geometry for filtering
    TripMap.fetchRoadGeometry(currentWaypoints)
      .then(latlngs => {
        // Convert [lat, lon] arrays to {lat, lon} objects for cameras.js
        currentRouteGeometry = latlngs.map(p => ({ lat: p[0], lon: p[1] }));
        // Re-filter with precise geometry and tight buffer
        _lastFilteredIds = '';
        applyFilters();
      })
      .catch(e => {
        console.warn('Could not fetch route geometry for filtering:', e.message);
        // Keep using straight-line waypoints with wider buffer
      });
  }

  // ── Snap to Current Location ─────────────────────────────────

  function snapToCurrentLocation() {
    if (!userLocation) return;
    closeDropdown();

    // Find nearest camera in the current filtered list
    const { lat, lon } = userLocation;
    let nearestCard = null;
    let minDist = Infinity;

    const cards = dom.cameraList.querySelectorAll('.camera-card');
    for (const card of cards) {
      const cam = filteredCameras.find(c => c.id === card.dataset.id);
      if (!cam) continue;
      const d = Cameras.haversine(lat, lon, cam.lat, cam.lon);
      if (d < minDist) {
        minDist = d;
        nearestCard = card;
      }
    }

    if (nearestCard) {
      nearestCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      nearestCard.classList.add('highlighted');
      setTimeout(() => nearestCard.classList.remove('highlighted'), 2000);
      TripMap.panTo(userLocation.lat, userLocation.lon);
    }
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


  // ── Camera Loading ───────────────────────────────────────────

  async function loadCameras() {
    // Determine which regions the route passes through
    const neededRegions = new Set();
    if (currentWaypoints.length > 0) {
      for (const wp of currentWaypoints) {
        neededRegions.add(wp.region);
      }
    }

    // ── Instant render from cache (synchronous, no network wait) ──
    const cachedCameras = API.getCachedImmediate(neededRegions.size > 0 ? neededRegions : null);
    if (cachedCameras && cachedCameras.length > 0) {
      allCameras = cachedCameras;
      applyFilters();
    } else {
      // No cache: show skeleton loading state
      dom.skeletonList.classList.remove('hidden');
      removeCameraCards();
      allCameras = [];
    }

    // ── Background refresh: fetch fresh data and update in-place ──
    let anyFromCache = cachedCameras != null;
    const freshCameras = [];
    const hadCachedData = cachedCameras && cachedCameras.length > 0;

    await API.fetchProgressive((region, result) => {
      if (result.fromCache) anyFromCache = true;
      freshCameras.push(...(result.data || []));
      // Only re-render if we didn't have cached data, or if fresh data differs
      if (!hadCachedData) {
        allCameras = freshCameras.slice();
        applyFilters();
      }
    }, neededRegions.size > 0 ? neededRegions : null);

    // Final update with all fresh data (even if we showed cached)
    if (freshCameras.length > 0) {
      allCameras = freshCameras;
      applyFilters();
    }

    if (anyFromCache && !navigator.onLine) {
      dom.offlineBanner.classList.add('visible');
    }
    dom.skeletonList.classList.add('hidden');
  }

  let _lastFilteredIds = ''; // Track last rendered set to skip no-op re-renders

  function applyFilters() {
    // Use OSRM geometry with tight buffer when available, fall back to waypoints
    const useGeometry = currentRouteGeometry && currentRouteGeometry.length > 0;
    const filterPath = useGeometry ? currentRouteGeometry : currentWaypoints;
    const buffer = useGeometry ? 2 : (routeData?.corridorBuffer || 25);

    // Filter by corridor
    let cameras = filterPath.length > 0
      ? Cameras.filterByCorridor(allCameras, filterPath, buffer)
      : allCameras;

    // Sort by route order
    if (filterPath.length > 0) {
      cameras = Cameras.sortByRoute(cameras, filterPath);
    }

    // Skip re-render if the camera list hasn't changed
    const newIds = cameras.map(c => c.id).join(',');
    if (newIds === _lastFilteredIds) {
      return; // Same cameras in same order — no DOM work needed
    }
    _lastFilteredIds = newIds;

    filteredCameras = cameras;
    renderCameraList(cameras);
    TripMap.setMarkers(cameras, onMarkerClick);
  }

  // ── Camera List Rendering ────────────────────────────────────

  function formatAge(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function removeCameraCards() {
    const cards = dom.cameraList.querySelectorAll('.camera-card, .empty-state');
    cards.forEach(c => c.remove());
  }

  function buildCameraCard(cam, index, showRegion) {
    const card = document.createElement('div');
    card.dataset.id = cam.id;
    card.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

    const hasImage = cam.imageUrl && cam.status === 'active';
    const regionBadge = showRegion ? `<span class="thumb-region ${cam.region}">${cam.region}</span>` : '';

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
          <div class="thumb-overlay">
            ${regionBadge}
            <div class="camera-name">${cam.name}</div>
            <div class="camera-status">
              <span class="status-dot"></span>
              ${cam.lastUpdated ? formatAge(cam.lastUpdated) : ''}
            </div>
          </div>
        </div>
      `;
      card.addEventListener('click', () => openModal(cam));
    } else {
      card.className = 'camera-card camera-card-disabled';
      card.innerHTML = `
        ${regionBadge}
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

    // Only show region badges when cameras span multiple regions
    const regions = new Set(cameras.map(c => c.region));
    const showRegion = regions.size > 1;

    // Render first batch immediately for fast initial paint
    const firstBatch = cameras.slice(0, INITIAL_RENDER_BATCH);
    const restBatch = cameras.slice(INITIAL_RENDER_BATCH);

    const fragment = document.createDocumentFragment();
    firstBatch.forEach((cam, i) => fragment.appendChild(buildCameraCard(cam, i, showRegion)));
    dom.cameraList.appendChild(fragment);

    // Defer remaining cards to next frame so UI is interactive sooner
    if (restBatch.length > 0) {
      _pendingRenderRaf = requestAnimationFrame(() => {
        _pendingRenderRaf = null;
        const restFragment = document.createDocumentFragment();
        restBatch.forEach((cam, i) =>
          restFragment.appendChild(buildCameraCard(cam, INITIAL_RENDER_BATCH + i, showRegion))
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
            if (!img.dataset.src) { observer.unobserve(img); continue; }
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
  let _scrollTrackingHandler = null;
  let _hasZoomedForScroll = false;    // true once initial zoom-to-visible is done (one-time)

  function isWideLayout() {
    return window.matchMedia('(min-width: 769px)').matches;
  }

  function setupScrollTracking(cameras) {
    if (scrollTrackingObserver) scrollTrackingObserver.disconnect();
    if (_scrollTrackingHandler) {
      dom.cameraList.removeEventListener('scroll', _scrollTrackingHandler);
      _scrollTrackingHandler = null;
    }
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
    }, {
      root: dom.cameraList,
      rootMargin: '0px',
      threshold: 0.5,
    });

    const cards = dom.cameraList.querySelectorAll('.camera-card');
    cards.forEach(card => scrollTrackingObserver.observe(card));

    // Focused camera tracking: find the card closest to center and sync map.
    // On very first scroll, instantly zoom to fit visible cameras (no animation
    // to avoid Safari's CSS-transform scaling). After that, only ever pan.
    let focusDebounce = null;
    _scrollTrackingHandler = () => {
      if (_mapInitiatedScroll) return;
      if (!isWideLayout() && !sheetRevealed) return;

      if (!_hasZoomedForScroll) {
        _hasZoomedForScroll = true;
        // One-time: instantly zoom to fit cameras visible in the list
        const listRect = dom.cameraList.getBoundingClientRect();
        const visIds = new Set();
        for (const card of dom.cameraList.querySelectorAll('.camera-card')) {
          const rect = card.getBoundingClientRect();
          if (rect.top < listRect.bottom && rect.bottom > listRect.top) {
            visIds.add(card.dataset.id);
          }
        }
        if (visIds.size > 0) {
          TripMap.zoomToVisible(visIds);
        }
      }

      clearTimeout(focusDebounce);
      focusDebounce = setTimeout(() => {
        updateFocusedCamera();
      }, 150);
    };
    dom.cameraList.addEventListener('scroll', _scrollTrackingHandler, { passive: true });
  }

  function updateFocusedCamera() {
    if (_mapInitiatedScroll) return;
    // Only auto-pan on wide layout, or narrow with sheet expanded
    if (!isWideLayout() && !sheetRevealed) return;

    const listRect = dom.cameraList.getBoundingClientRect();
    const centerY = listRect.top + listRect.height / 2;
    const cards = dom.cameraList.querySelectorAll('.camera-card');

    let closestCard = null;
    let closestDist = Infinity;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.top + rect.height / 2;
      const dist = Math.abs(cardCenter - centerY);
      if (dist < closestDist) {
        closestDist = dist;
        closestCard = card;
      }
    }

    if (!closestCard) return;
    const camId = closestCard.dataset.id;
    if (camId === _focusedCameraId) return;

    // Update focused state
    const prevFocused = dom.cameraList.querySelector('.camera-card.focused');
    if (prevFocused) prevFocused.classList.remove('focused');
    closestCard.classList.add('focused');
    _focusedCameraId = camId;

    // Find the camera data and pan map to it (no zoom change)
    const cam = filteredCameras.find(c => c.id === camId);
    if (cam) {
      TripMap.highlightMarkerVisual(camId);
      TripMap.smoothPanTo(cam.lat, cam.lon);
    }
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
    const isSat = TripMap.toggleSatellite();
    dom.mapToggle.classList.toggle('active', isSat);
  }

  function centerMap() {
    if (currentWaypoints.length > 0) {
      TripMap.fitToRoute(currentWaypoints);
    }
  }

  // ── Sheet reveal / collapse ─────────────────────────────────

  function revealSheet() {
    if (sheetRevealed || isWideLayout()) return;
    sheetRevealed = true;
    dom.mapContainer.style.height = '20vh';
    dom.sheet.classList.add('revealed');
    document.body.classList.add('sheet-expanded');
    dom.cameraList.style.overflowY = '';
    TripMap.invalidateSize();
    // Zoom map to fit the cameras visible in the list
    setTimeout(() => {
      const visibleIds = new Set();
      for (const card of dom.cameraList.querySelectorAll('.camera-card')) {
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
  }

  function collapseSheet() {
    if (!sheetRevealed || isWideLayout()) return;
    sheetRevealed = false;
    dom.mapContainer.style.height = '';
    dom.sheet.classList.remove('revealed');
    document.body.classList.remove('sheet-expanded');
    dom.cameraList.style.overflowY = 'hidden';
    dom.cameraList.scrollTop = 0;
    TripMap.invalidateSize();
    setTimeout(() => TripMap.fitToRoute(currentWaypoints), 200);
  }

  // ── List scroll interactions (reveal, pull-to-refresh) ───────

  function initListScrollExpand() {
    const list = dom.cameraList;
    const ptr = dom.pullToRefresh;
    let touchStartY = 0;
    let touchStartScrollTop = 0;
    const THRESHOLD = 30;
    const PTR_MAX = 60;
    const PTR_TRIGGER = 48;
    let triggered = false;
    let isPulling = false;
    let isRefreshing = false;

    // ── Touch events ──
    // Document-level listeners for reveal/collapse so they work even when
    // the sheet is offscreen (Safari responsive mode converts trackpad to touch).
    // List-level listeners handle pull-to-refresh once revealed.

    document.addEventListener('touchstart', (e) => {
      if (isWideLayout()) return;
      touchStartY = e.touches[0].clientY;
      touchStartScrollTop = list.scrollTop;
      triggered = false;
      if (!isRefreshing && sheetRevealed && touchStartScrollTop <= 0) {
        isPulling = true;
        ptr.classList.add('pulling');
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (isWideLayout() || triggered) return;

      const y = e.touches[0].clientY;
      const delta = y - touchStartY; // positive = finger moving down

      if (!sheetRevealed) {
        // Collapsed: swipe up (finger moves up) reveals the sheet
        if (delta < -THRESHOLD) {
          triggered = true;
          revealSheet();
        }
        return;
      }

      // Revealed & at top: swipe down collapses, or pull-to-refresh
      if (touchStartScrollTop <= 0 && list.scrollTop <= 0) {
        if (delta > THRESHOLD && !isPulling) {
          // Swipe down at top without PTR active → collapse
          triggered = true;
          collapseSheet();
          return;
        }
        // Pull-to-refresh
        if (isPulling && !isRefreshing && delta > 0) {
          const pull = Math.min(delta, PTR_MAX);
          const progress = pull / PTR_MAX;
          ptr.style.height = pull + 'px';
          ptr.style.opacity = progress;
          ptr.querySelector('svg').style.transform = `rotate(${progress * 360}deg)`;
          if (pull >= PTR_TRIGGER) {
            triggered = true;
          }
        }
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!isPulling) return;
      ptr.classList.remove('pulling');

      if (triggered && !isRefreshing) {
        isRefreshing = true;
        ptr.style.height = '';
        ptr.style.opacity = '';
        ptr.querySelector('svg').style.transform = '';
        ptr.classList.add('refreshing');
        doRefresh().then(() => {
          ptr.classList.remove('refreshing');
          isRefreshing = false;
        });
      } else {
        resetPull();
      }
      isPulling = false;
    }, { passive: true });

    function resetPull() {
      isPulling = false;
      ptr.classList.remove('pulling');
      ptr.style.height = '';
      ptr.style.opacity = '';
      ptr.querySelector('svg').style.transform = '';
    }

    async function doRefresh() {
      _lastFilteredIds = '';
      await loadCameras();
    }

    // ── Wheel events (trackpad / mouse) ──
    // Use capture phase so we see the event before Leaflet's map zoom
    // handler calls stopPropagation(). This lets us intercept scroll-up
    // to reveal the sheet even when the cursor is over the map.
    let wheelAccum = 0;
    let wheelCooldown = false;
    const WHEEL_THRESHOLD = 60;
    const WHEEL_COOLDOWN_MS = 400;

    document.addEventListener('wheel', (e) => {
      if (isWideLayout()) return;

      // Sheet not yet revealed — scroll-up (deltaY < 0) anywhere reveals it
      if (!sheetRevealed) {
        if (e.deltaY < 0) {
          if (wheelCooldown) { e.preventDefault(); return; }
          wheelAccum += Math.abs(e.deltaY);
          e.preventDefault();
          e.stopPropagation(); // prevent Leaflet map zoom
          if (wheelAccum >= WHEEL_THRESHOLD) {
            wheelAccum = 0;
            wheelCooldown = true;
            revealSheet();
            setTimeout(() => { wheelCooldown = false; }, WHEEL_COOLDOWN_MS);
          }
        } else {
          wheelAccum = 0;
        }
        return;
      }

      // Sheet is revealed — handle scroll at the top of the list
      if (list.scrollTop <= 0) {
        if (e.deltaY > 0) {
          // Scrolling down at top → collapse sheet
          if (wheelCooldown) { e.preventDefault(); return; }
          wheelAccum += e.deltaY;
          e.preventDefault();
          e.stopPropagation();
          if (wheelAccum >= WHEEL_THRESHOLD) {
            wheelAccum = 0;
            wheelCooldown = true;
            collapseSheet();
            setTimeout(() => { wheelCooldown = false; }, WHEEL_COOLDOWN_MS);
          }
        } else if (e.deltaY < 0 && !isRefreshing) {
          // Scrolling up at top → pull-to-refresh
          if (wheelCooldown) { e.preventDefault(); return; }
          wheelAccum += Math.abs(e.deltaY);
          e.preventDefault();
          e.stopPropagation();
          if (wheelAccum >= WHEEL_THRESHOLD) {
            wheelAccum = 0;
            wheelCooldown = true;
            isRefreshing = true;
            ptr.classList.add('refreshing');
            doRefresh().then(() => {
              ptr.classList.remove('refreshing');
              isRefreshing = false;
            });
            setTimeout(() => { wheelCooldown = false; }, WHEEL_COOLDOWN_MS);
          }
        } else {
          wheelAccum = 0;
        }
      } else {
        // Scrolling mid-list — let native scroll handle it, reset accumulator
        wheelAccum = 0;
      }
    }, { capture: true, passive: false });
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
