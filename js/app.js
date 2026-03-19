/* =============================================================
   app.js — Main application init, UI rendering, interactions
   ============================================================= */

const App = (() => {
  let routeData = null;
  let allStops = [];
  let allCameras = [];
  let filteredCameras = [];
  let filteredClusters = []; // Array of { cameras: [...], lat, lon } cluster objects
  let _clusterByCamId = new Map(); // camera id -> cluster index for quick lookup
  let currentWaypoints = [];
  let currentRouteGeometry = null; // Dense OSRM road geometry for precise filtering
  let fromStop = null;
  let toStop = null;
  let dropdownTarget = null; // 'from' or 'to'
  let currentModalCamera = null;
  let sheetRevealed = false; // true once the sheet has been revealed (one-way)
  let _mapInitiatedScroll = false; // true when map viewport change is scrolling the list
  let _userHasInteractedWithMap = false; // true after first user pan/zoom on the map
  let _focusedCameraId = null; // the camera card currently centered in the list
  let _topCameraId = null; // the camera card at the top of the visible list
  let _hoveredCameraId = null; // camera card the user is hovering over
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
    dom.modalClose = $('#modalClose');
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
          // Focus this camera's marker on the map
          _topCameraId = card.dataset.id;
          TripMap.focusMarker(card.dataset.id);
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

    // Browser back/forward for camera hash
    window.addEventListener('popstate', () => {
      const camId = _getCameraIdFromHash();
      if (camId && !dom.modalOverlay.classList.contains('active')) {
        _openCameraFromHash();
      } else if (!camId && dom.modalOverlay.classList.contains('active')) {
        // Back button pressed while modal is open — close visually (hash already gone)
        _closeModalVisual();
      }
    });

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
      let hash = `from=${fromStop.id}&to=${toStop.id}`;
      // Preserve camera param if modal is open
      const camId = _getCameraIdFromHash();
      if (camId) hash += `&camera=${camId}`;
      window.location.hash = hash;
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

    // Auto-open camera from URL hash (e.g. #camera=ab-123)
    requestAnimationFrame(() => _openCameraFromHash());
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

    // Cluster nearby cameras and sort each cluster by travel direction
    const sortPath = filterPath.length > 0 ? filterPath : currentWaypoints;
    // Detect if user is traveling opposite to the waypoint order.
    // Waypoints are always in geographic route order; if fromStop is closer
    // to the end of the waypoints, the travel direction is reversed.
    let reversed = false;
    if (fromStop && sortPath.length >= 2) {
      const first = sortPath[0];
      const last = sortPath[sortPath.length - 1];
      const dFromFirst = Cameras.haversine(fromStop.lat, fromStop.lon, first.lat, first.lon);
      const dFromLast = Cameras.haversine(fromStop.lat, fromStop.lon, last.lat, last.lon);
      reversed = dFromLast < dFromFirst;
    }
    filteredClusters = Cameras.clusterCameras(cameras);
    _clusterByCamId = new Map();
    filteredClusters.forEach((cluster, idx) => {
      if (sortPath.length >= 2) {
        Cameras.sortClusterByTravelDirection(cluster, sortPath, reversed);
      }
      cluster.cameras.forEach(cam => _clusterByCamId.set(cam.id, idx));
    });

    renderCameraList(filteredClusters);
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
      card.addEventListener('click', () => openModal(cam, null, card));
      card.addEventListener('mouseenter', () => {
        _hoveredCameraId = cam.id;
        TripMap.focusMarker(cam.id);
        TripMap.hoverMarker(cam.id);
      });
      card.addEventListener('mouseleave', () => {
        _hoveredCameraId = null;
        TripMap.unhoverMarker();
        if (_topCameraId) TripMap.focusMarker(_topCameraId);
      });
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

  // Build a paginated cluster card with scroll-snap slides for each camera
  function buildClusterCard(cluster, index, showRegion) {
    const cams = cluster.cameras;
    const firstCam = cams[0];
    const card = document.createElement('div');
    card.className = 'camera-card cluster-card';
    card.dataset.id = firstCam.id; // primary camera id for map sync
    card.dataset.clusterIds = cams.map(c => c.id).join(',');
    card.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

    const regionBadge = showRegion ? `<span class="thumb-region ${firstCam.region}">${firstCam.region}</span>` : '';

    // Build slides HTML
    const slidesHtml = cams.map((cam, i) => {
      const imgSrc = cam.thumbnailUrl || cam.imageUrl;
      // Only show direction label if meaningful and not already in the camera name
      const dir = cam.direction || '';
      const nameLower = cam.name.toLowerCase();
      const showDir = dir && dir.toLowerCase() !== 'unknown' && !nameLower.includes(dir.toLowerCase());
      return `
        <div class="cluster-slide" data-cam-id="${cam.id}" data-slide-idx="${i}">
          <img src="img/placeholder.svg"
               data-src="${imgSrc}"
               alt="${cam.name}"
               width="640" height="360"
               loading="lazy">
          <div class="thumb-overlay">
            ${i === 0 ? regionBadge : (showRegion ? `<span class="thumb-region ${cam.region}">${cam.region}</span>` : '')}
            <div class="camera-name">${cam.name}${showDir ? ` <span class="cluster-direction">${dir}</span>` : ''}</div>
            <div class="camera-status">
              <span class="status-dot"></span>
              ${cam.lastUpdated ? formatAge(cam.lastUpdated) : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Dot indicators
    const dotsHtml = cams.map((_, i) =>
      `<button class="cluster-dot${i === 0 ? ' active' : ''}" data-idx="${i}" aria-label="Camera ${i + 1} of ${cams.length}"></button>`
    ).join('');

    card.innerHTML = `
      <div class="camera-thumb cluster-thumb">
        <div class="cluster-track">${slidesHtml}</div>
        <button class="cluster-arrow cluster-arrow-prev" aria-label="Previous camera" style="display:none">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button class="cluster-arrow cluster-arrow-next" aria-label="Next camera">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <div class="cluster-dots">${dotsHtml}</div>
      </div>
    `;

    // ── Pagination state & logic ──
    const track = card.querySelector('.cluster-track');
    const dots = card.querySelectorAll('.cluster-dot');
    const prevBtn = card.querySelector('.cluster-arrow-prev');
    const nextBtn = card.querySelector('.cluster-arrow-next');
    let currentPage = 0;

    function goToPage(page) {
      if (page < 0 || page >= cams.length) return;
      currentPage = page;
      track.style.transform = `translateX(-${page * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('active', i === page));
      prevBtn.style.display = page === 0 ? 'none' : '';
      nextBtn.style.display = page === cams.length - 1 ? 'none' : '';
      // Update card's primary data-id for map sync
      card.dataset.id = cams[page].id;
    }

    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); goToPage(currentPage - 1); });
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); goToPage(currentPage + 1); });
    dots.forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        goToPage(parseInt(dot.dataset.idx));
      });
    });

    // ── Trackpad two-finger horizontal swipe ──
    // Page once per gesture, then hard-lock until 500ms of silence so
    // macOS trackpad inertia never triggers a second page change.
    let wheelAccumX = 0;
    let wheelLockUntil = 0; // timestamp — ignore all events before this
    let wheelResetTimer = null;
    const clusterThumb = card.querySelector('.cluster-thumb');

    clusterThumb.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (now < wheelLockUntil) return;

      wheelAccumX += e.deltaX;

      // Reset accumulator if gesture pauses (new swipe)
      clearTimeout(wheelResetTimer);
      wheelResetTimer = setTimeout(() => { wheelAccumX = 0; }, 150);

      if (Math.abs(wheelAccumX) >= 60) {
        const dir = wheelAccumX > 0 ? 1 : -1;
        const targetPage = currentPage + dir;
        wheelAccumX = 0;

        if (targetPage < 0 || targetPage >= cams.length) {
          // Rubber band — shift track slightly then spring back
          const rubberPx = dir * -30;
          track.style.transition = 'none';
          track.style.transform = `translateX(calc(-${currentPage * 100}% + ${rubberPx}px))`;
          requestAnimationFrame(() => {
            track.style.transition = 'transform 0.35s var(--spring-bounce)';
            track.style.transform = `translateX(-${currentPage * 100}%)`;
          });
        } else {
          goToPage(targetPage);
        }

        // Hard lock — ignore everything for 500ms
        wheelLockUntil = now + 500;
      }
    }, { passive: false });

    // ── Touch swipe ──
    let touchStartX = 0;
    let touchStartY = 0;
    let swiping = false;

    track.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      swiping = false;
    }, { passive: true });

    track.addEventListener('touchmove', (e) => {
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      // Lock to horizontal if mostly horizontal
      if (!swiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        swiping = true;
      }
      if (swiping) {
        e.preventDefault();
      }
    }, { passive: false });

    track.addEventListener('touchend', (e) => {
      if (!swiping) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (dx < -40) goToPage(currentPage + 1);
      else if (dx > 40) goToPage(currentPage - 1);
    }, { passive: true });

    // ── Click opens modal for current page camera ──
    card.addEventListener('click', () => {
      openModal(cams[currentPage], cluster, card);
    });

    // ── Hover / focus map sync ──
    card.addEventListener('mouseenter', () => {
      _hoveredCameraId = cams[currentPage].id;
      TripMap.focusMarker(cams[currentPage].id);
      TripMap.hoverMarker(cams[currentPage].id);
    });
    card.addEventListener('mouseleave', () => {
      _hoveredCameraId = null;
      TripMap.unhoverMarker();
      if (_topCameraId) TripMap.focusMarker(_topCameraId);
    });

    return card;
  }

  let _pendingRenderRaf = null;

  function renderCameraList(clusters) {
    removeCameraCards();
    if (_pendingRenderRaf) { cancelAnimationFrame(_pendingRenderRaf); _pendingRenderRaf = null; }

    // Flatten for counting / empty check
    const totalCameras = clusters.reduce((n, cl) => n + cl.cameras.length, 0);

    if (totalCameras === 0) {
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
    const regions = new Set(filteredCameras.map(c => c.region));
    const showRegion = regions.size > 1;

    // Render first batch immediately for fast initial paint
    const firstBatch = clusters.slice(0, INITIAL_RENDER_BATCH);
    const restBatch = clusters.slice(INITIAL_RENDER_BATCH);

    const fragment = document.createDocumentFragment();
    firstBatch.forEach((cluster, i) => {
      if (cluster.cameras.length === 1) {
        fragment.appendChild(buildCameraCard(cluster.cameras[0], i, showRegion));
      } else {
        fragment.appendChild(buildClusterCard(cluster, i, showRegion));
      }
    });
    dom.cameraList.appendChild(fragment);

    // Defer remaining cards to next frame so UI is interactive sooner
    if (restBatch.length > 0) {
      _pendingRenderRaf = requestAnimationFrame(() => {
        _pendingRenderRaf = null;
        const restFragment = document.createDocumentFragment();
        restBatch.forEach((cluster, i) => {
          const idx = INITIAL_RENDER_BATCH + i;
          if (cluster.cameras.length === 1) {
            restFragment.appendChild(buildCameraCard(cluster.cameras[0], idx, showRegion));
          } else {
            restFragment.appendChild(buildClusterCard(cluster, idx, showRegion));
          }
        });
        dom.cameraList.appendChild(restFragment);

        // Re-setup observers for the new cards
        setupLazyLoading();
        setupScrollTracking(filteredCameras);
        prefetchUpcoming(filteredCameras);
      });
    }

    // Setup observers for first batch immediately
    setupLazyLoading();
    setupScrollTracking(filteredCameras);
    prefetchUpcoming(filteredCameras);
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

      // Update top camera marker immediately for responsiveness
      updateTopCamera();

      clearTimeout(focusDebounce);
      focusDebounce = setTimeout(() => {
        updateFocusedCamera();
      }, 150);
    };
    dom.cameraList.addEventListener('scroll', _scrollTrackingHandler, { passive: true });
  }

  // Find the card at the top of the visible scroll area and focus its marker.
  function updateTopCamera() {
    const listRect = dom.cameraList.getBoundingClientRect();
    const topEdge = listRect.top;
    const cards = dom.cameraList.querySelectorAll('.camera-card');

    let topCard = null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      // First card whose bottom is below the list top (i.e. it's visible)
      if (rect.bottom > topEdge + 10) {
        topCard = card;
        break;
      }
    }

    if (!topCard) return;
    const camId = topCard.dataset.id;
    if (camId === _topCameraId) return;
    _topCameraId = camId;

    // Only set map focus if user isn't hovering a card
    if (!_hoveredCameraId) {
      TripMap.focusMarker(camId);
    }
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
    // Find cluster card — check both data-id and data-cluster-ids
    let card = dom.cameraList.querySelector(`[data-id="${cam.id}"]`);
    if (!card) {
      // Camera might be a non-primary member of a cluster
      const cards = dom.cameraList.querySelectorAll('.cluster-card');
      for (const c of cards) {
        const ids = (c.dataset.clusterIds || '').split(',');
        if (ids.includes(cam.id)) { card = c; break; }
      }
    }
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('highlighted');
      setTimeout(() => card.classList.remove('highlighted'), 2000);
    }

    // Find cluster for modal navigation
    const clusterIdx = _clusterByCamId.get(cam.id);
    const cluster = clusterIdx !== undefined ? filteredClusters[clusterIdx] : null;
    openModal(cam, cluster, card);
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

  let _modalCluster = null; // cluster object when viewing a clustered camera
  let _modalClusterPage = 0;
  let _modalSourceCardEl = null; // reference to the card element that opened the modal
  let _flipClone = null; // the floating image clone used during FLIP animation
  let _modalOpenedViaHistory = false; // true when opened from popstate / URL parse

  // Prefer reduced motion?
  function _prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Find the source card element for a given camera id
  function _findSourceCard(camId) {
    let card = dom.cameraList.querySelector(`[data-id="${camId}"]`);
    if (!card) {
      const cards = dom.cameraList.querySelectorAll('.cluster-card');
      for (const c of cards) {
        const ids = (c.dataset.clusterIds || '').split(',');
        if (ids.includes(camId)) { card = c; break; }
      }
    }
    return card;
  }

  // Get the thumbnail image element from a card
  function _getCardThumbImg(card) {
    if (!card) return null;
    // For cluster cards, find the currently visible slide's image
    const activeSlide = card.querySelector('.cluster-slide');
    if (activeSlide) return activeSlide.querySelector('img');
    // For single camera cards
    return card.querySelector('.camera-thumb img');
  }

  // Check if an element is visible within the camera list viewport
  function _isCardVisible(card) {
    if (!card) return false;
    const listRect = dom.cameraList.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return cardRect.bottom > listRect.top && cardRect.top < listRect.bottom;
  }

  function openModal(cam, cluster, sourceCard) {
    currentModalCamera = cam;
    _modalCluster = cluster && cluster.cameras.length > 1 ? cluster : null;
    _modalClusterPage = _modalCluster ? _modalCluster.cameras.indexOf(cam) : 0;
    if (_modalClusterPage < 0) _modalClusterPage = 0;

    // Find the source card if not provided
    if (!sourceCard) sourceCard = _findSourceCard(cam.id);
    _modalSourceCardEl = sourceCard;

    // Build modal image content (single image or carousel)
    _buildModalImageContent();
    dom.modalName.textContent = cam.name;

    // ── FLIP animation ──
    const thumbImg = _getCardThumbImg(sourceCard);
    const canFlip = thumbImg && _isCardVisible(sourceCard) && !_prefersReducedMotion();

    if (canFlip) {
      const firstRect = thumbImg.getBoundingClientRect();
      dom.modal.style.opacity = '0';
      dom.modal.style.transform = 'translateY(20px)';
      dom.modalOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';

      const clone = document.createElement('img');
      clone.className = 'modal-transition-clone';
      clone.src = thumbImg.src || thumbImg.dataset.src || 'img/placeholder.svg';
      clone.style.top = firstRect.top + 'px';
      clone.style.left = firstRect.left + 'px';
      clone.style.width = firstRect.width + 'px';
      clone.style.height = firstRect.height + 'px';
      clone.style.borderRadius = '16px';
      document.body.appendChild(clone);
      _flipClone = clone;

      requestAnimationFrame(() => {
        const modalImgContainer = dom.modal.querySelector('.modal-image-container');
        const lastRect = modalImgContainer.getBoundingClientRect();
        clone.classList.add('to-modal');
        clone.style.top = lastRect.top + 'px';
        clone.style.left = lastRect.left + 'px';
        clone.style.width = lastRect.width + 'px';
        clone.style.height = lastRect.height + 'px';

        const cleanup = () => {
          dom.modal.style.opacity = '';
          dom.modal.style.transform = '';
          if (_flipClone) { _flipClone.remove(); _flipClone = null; }
        };
        clone.addEventListener('transitionend', function onEnd(e) {
          if (e.propertyName !== 'top' && e.propertyName !== 'width') return;
          clone.removeEventListener('transitionend', onEnd);
          cleanup();
        }, { once: false });
        setTimeout(cleanup, 600);
      });
    } else {
      dom.modalOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    TripMap.highlightMarker(cam.id);
    TripMap.panTo(cam.lat, cam.lon);
    _pushCameraHash(cam.id);
  }

  // Build the modal image area — single image or carousel with dots/arrows
  function _buildModalImageContent() {
    const container = dom.modal.querySelector('.modal-image-container');
    // Clear previous content
    container.innerHTML = '';

    if (_modalCluster) {
      const cams = _modalCluster.cameras;

      // Build slides
      const slidesHtml = cams.map((c) =>
        `<div class="cluster-slide"><img src="${cacheBustUrl(c.imageUrl || 'img/placeholder.svg')}" alt="${c.name}"></div>`
      ).join('');

      // Dots
      const dotsHtml = cams.map((_, i) =>
        `<button class="cluster-dot${i === _modalClusterPage ? ' active' : ''}" data-idx="${i}" aria-label="Camera ${i + 1} of ${cams.length}"></button>`
      ).join('');

      container.innerHTML = `
        <div class="cluster-track" style="transform:translateX(-${_modalClusterPage * 100}%)">${slidesHtml}</div>
        <button class="cluster-arrow cluster-arrow-prev" aria-label="Previous camera" ${_modalClusterPage === 0 ? 'style="display:none"' : ''}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button class="cluster-arrow cluster-arrow-next" aria-label="Next camera" ${_modalClusterPage === cams.length - 1 ? 'style="display:none"' : ''}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <div class="cluster-dots">${dotsHtml}</div>
        <div class="modal-loading" id="modalLoading"><div class="spinner"></div></div>
      `;

      // Wire up carousel controls
      const track = container.querySelector('.cluster-track');
      const dots = container.querySelectorAll('.cluster-dot');
      const prevBtn = container.querySelector('.cluster-arrow-prev');
      const nextBtn = container.querySelector('.cluster-arrow-next');

      function goToPage(page) {
        if (page < 0 || page >= cams.length) return;
        _modalClusterPage = page;
        track.style.transform = `translateX(-${page * 100}%)`;
        dots.forEach((d, i) => d.classList.toggle('active', i === page));
        prevBtn.style.display = page === 0 ? 'none' : '';
        nextBtn.style.display = page === cams.length - 1 ? 'none' : '';
        // Update state
        currentModalCamera = cams[page];
        dom.modalName.textContent = cams[page].name;
        _replaceCameraHash(cams[page].id);
        TripMap.highlightMarker(cams[page].id);
        TripMap.panTo(cams[page].lat, cams[page].lon);
      }

      prevBtn.addEventListener('click', () => goToPage(_modalClusterPage - 1));
      nextBtn.addEventListener('click', () => goToPage(_modalClusterPage + 1));
      dots.forEach(dot => dot.addEventListener('click', () => goToPage(parseInt(dot.dataset.idx))));

      // Touch swipe on modal carousel
      let touchStartX = 0, swiping = false;
      track.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; swiping = false; }, { passive: true });
      track.addEventListener('touchmove', (e) => {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - (e.touches[0]._startY || e.touches[0].clientY);
        if (!swiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) swiping = true;
        if (swiping) e.preventDefault();
      }, { passive: false });
      track.addEventListener('touchend', (e) => {
        if (!swiping) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (dx < -40) goToPage(_modalClusterPage + 1);
        else if (dx > 40) goToPage(_modalClusterPage - 1);
      }, { passive: true });

      // Trackpad two-finger horizontal swipe
      // Page once per gesture, then lock until inertia dies.
      // Uses a short cooldown (250ms) so deliberate back-and-forth swiping feels snappy.
      let wheelAccumX = 0;
      let wheelLocked = false;
      let wheelIdleTimer = null;

      container.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        e.stopPropagation();

        // Every event resets the idle timer; unlock after 250ms of silence
        clearTimeout(wheelIdleTimer);
        wheelIdleTimer = setTimeout(() => { wheelAccumX = 0; wheelLocked = false; }, 250);

        if (wheelLocked) return;

        wheelAccumX += e.deltaX;

        if (Math.abs(wheelAccumX) >= 60) {
          const dir = wheelAccumX > 0 ? 1 : -1;
          const targetPage = _modalClusterPage + dir;

          // Lock immediately — all subsequent inertia events are ignored
          wheelAccumX = 0;
          wheelLocked = true;

          if (targetPage < 0 || targetPage >= cams.length) {
            const rubberPx = dir * -30;
            track.style.transition = 'none';
            track.style.transform = `translateX(calc(-${_modalClusterPage * 100}% + ${rubberPx}px))`;
            requestAnimationFrame(() => {
              track.style.transition = 'transform 0.35s var(--spring-bounce)';
              track.style.transform = `translateX(-${_modalClusterPage * 100}%)`;
            });
          } else {
            goToPage(targetPage);
          }
        }
      }, { passive: false });

    } else {
      // Single camera — just an image
      const cam = currentModalCamera;
      container.innerHTML = `
        <img id="modalImage" alt="${cam.name}" src="${cacheBustUrl(cam.imageUrl || 'img/placeholder.svg')}">
        <div class="modal-loading" id="modalLoading"><div class="spinner"></div></div>
      `;
    }

    // Setup loading state for all images in the container
    const imgs = container.querySelectorAll('img');
    const loading = container.querySelector('.modal-loading');
    let pending = imgs.length;
    if (loading) loading.classList.add('active');
    imgs.forEach(img => {
      if (img.complete) {
        pending--;
        if (pending <= 0 && loading) loading.classList.remove('active');
      } else {
        img.onload = () => { pending--; if (pending <= 0 && loading) loading.classList.remove('active'); };
        img.onerror = () => { pending--; img.src = 'img/placeholder.svg'; if (pending <= 0 && loading) loading.classList.remove('active'); };
      }
    });
  }

  function closeModal() {
    if (!dom.modalOverlay.classList.contains('active')) return;
    _closeModalVisual();
    _clearCameraHash();
  }

  // Visual close with reverse FLIP animation (also used by popstate)
  function _closeModalVisual() {
    if (!dom.modalOverlay.classList.contains('active')) return;

    const sourceCard = _modalSourceCardEl;
    const thumbImg = _getCardThumbImg(sourceCard);
    const canFlip = thumbImg && _isCardVisible(sourceCard) && !_prefersReducedMotion();

    if (canFlip) {
      // Measure positions while modal is still visible
      const modalImgContainer = dom.modal.querySelector('.modal-image-container');
      const visibleImg = modalImgContainer.querySelector('.cluster-slide img, :scope > img');
      const modalRect = modalImgContainer.getBoundingClientRect();
      const cardRect = thumbImg.getBoundingClientRect();

      // Create clone at the modal's exact position (on top of the real image)
      const clone = document.createElement('img');
      clone.className = 'modal-transition-clone to-modal';
      clone.src = (visibleImg && visibleImg.src) || 'img/placeholder.svg';
      clone.style.top = modalRect.top + 'px';
      clone.style.left = modalRect.left + 'px';
      clone.style.width = modalRect.width + 'px';
      clone.style.height = modalRect.height + 'px';
      document.body.appendChild(clone);

      // NOW hide the modal (clone is covering the image so it's seamless)
      dom.modal.style.opacity = '0';
      // Start fading the overlay backdrop (CSS transition handles the fade)
      dom.modalOverlay.classList.remove('active');

      // Animate clone from modal position → card position
      requestAnimationFrame(() => {
        clone.classList.remove('to-modal');
        clone.style.top = cardRect.top + 'px';
        clone.style.left = cardRect.left + 'px';
        clone.style.width = cardRect.width + 'px';
        clone.style.height = cardRect.height + 'px';
        clone.style.borderRadius = '16px';
      });

      // Clean up after animation completes
      let cleaned = false;
      const done = () => {
        if (cleaned) return;
        cleaned = true;
        clone.remove();
        _resetModalState();
      };
      clone.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'top' || e.propertyName === 'width') done();
      });
      setTimeout(done, 600);
    } else {
      // No FLIP — just fade out
      dom.modalOverlay.classList.remove('active');
      _resetModalState();
    }
  }

  function _resetModalState() {
    dom.modal.style.opacity = '';
    dom.modal.style.transform = '';
    document.body.style.overflow = '';
    currentModalCamera = null;
    _modalSourceCardEl = null;
  }

  // ── URL Hash Routing for Shareable Cameras ──────────────────

  function _pushCameraHash(camId) {
    // Preserve existing route hash params, add camera
    const base = _getRouteHashBase();
    const newHash = base ? `${base}&camera=${camId}` : `camera=${camId}`;
    if (window.location.hash !== '#' + newHash) {
      history.pushState({ camera: camId }, '', '#' + newHash);
    }
  }

  function _replaceCameraHash(camId) {
    const base = _getRouteHashBase();
    const newHash = base ? `${base}&camera=${camId}` : `camera=${camId}`;
    history.replaceState({ camera: camId }, '', '#' + newHash);
  }

  function _clearCameraHash() {
    const base = _getRouteHashBase();
    if (base) {
      history.replaceState(null, '', '#' + base);
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function _getRouteHashBase() {
    // Extract from/to params from current hash, excluding camera
    const hash = window.location.hash.slice(1);
    if (!hash) return '';
    const params = new URLSearchParams(hash);
    params.delete('camera');
    return params.toString();
  }

  function _getCameraIdFromHash() {
    const hash = window.location.hash.slice(1);
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    return params.get('camera') || null;
  }

  function _openCameraFromHash() {
    const camId = _getCameraIdFromHash();
    if (!camId) return;
    const cam = filteredCameras.find(c => c.id === camId) ||
                allCameras.find(c => c.id === camId);
    if (!cam) return;

    // Find cluster
    const clusterIdx = _clusterByCamId.get(cam.id);
    const cluster = clusterIdx !== undefined ? filteredClusters[clusterIdx] : null;
    const sourceCard = _findSourceCard(cam.id);

    _modalOpenedViaHistory = true;
    openModal(cam, cluster, sourceCard);
    _modalOpenedViaHistory = false;
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
