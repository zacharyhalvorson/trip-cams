/* =============================================================
   map.js — Leaflet map, markers, route polyline, geolocation
   ============================================================= */

const TripMap = (() => {
  let map = null;
  let markerCluster = null;
  let routeLine = null;
  let markers = new Map(); // camera id -> marker
  let userLocationMarker = null;
  let activeMarkerId = null;
  let _viewportCallback = null;
  let _lastProgrammaticMove = 0;
  let tileLayer = null;
  let isSatellite = false;
  let trafficLines = []; // layered polylines for traffic coloring

  const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
  const TILE_SAT_ATTR = '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics';

  function isDarkMode() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function init() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
    });

    tileLayer = L.tileLayer(isDarkMode() ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTR,
      maxZoom: 18,
      subdomains: 'abcd',
    }).addTo(map);

    // Switch tiles when color scheme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!isSatellite) {
        tileLayer.setUrl(e.matches ? TILE_DARK : TILE_LIGHT);
      }
      // Re-apply traffic coloring with updated theme colors
      if (trafficLines.length > 0) {
        const points = trafficLines.flatMap(l => l.getLatLngs());
        if (points.length > 1) loadTrafficAsync(points);
      }
    });

    // Zoom control on the right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Attribution bottom-right
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

    // Marker cluster group
    markerCluster = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: () => {
        return L.divIcon({
          html: '',
          className: 'marker-cluster',
          iconSize: L.point(10, 10),
        });
      },
    });
    map.addLayer(markerCluster);

    // Default view: Calgary to Seattle extent
    _markProgrammatic();
    map.fitBounds([
      [47.5, -123.5],
      [51.2, -113.5],
    ], { padding: [20, 20] });
  }

  const ROUTE_STYLE_FALLBACK = {
    color: '#2DB84B',
    weight: 3,
    opacity: 0.5,
    dashArray: '8, 8',
    lineCap: 'round',
  };

  const ROUTE_STYLE_PRECISE = {
    color: '#2DB84B',
    weight: 4,
    opacity: 0.7,
    lineCap: 'round',
    lineJoin: 'round',
  };

  function drawRouteLine(latlngs, style) {
    if (routeLine) {
      map.removeLayer(routeLine);
    }
    routeLine = L.polyline(latlngs, style || ROUTE_STYLE_FALLBACK).addTo(map);
  }

  const ROUTE_CACHE_KEY = 'tripcams_route_geo';
  const ROUTE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  function getRouteCache(cacheKey) {
    try {
      const stored = localStorage.getItem(`${ROUTE_CACHE_KEY}_${cacheKey}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Date.now() - parsed.ts < ROUTE_CACHE_DURATION) {
          return parsed.data;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function setRouteCache(cacheKey, data) {
    try {
      localStorage.setItem(`${ROUTE_CACHE_KEY}_${cacheKey}`, JSON.stringify({ data, ts: Date.now() }));
    } catch (e) { /* quota exceeded, ignore */ }
  }

  async function fetchRoadGeometry(waypoints) {
    // Build a cache key from waypoint coordinates
    const cacheKey = waypoints.map(w => `${w.lat.toFixed(3)},${w.lon.toFixed(3)}`).join('|');
    const cached = getRouteCache(cacheKey);
    if (cached) return cached;

    // OSRM expects coordinates as lon,lat pairs separated by semicolons
    const coords = waypoints.map(w => `${w.lon},${w.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`OSRM request failed: ${resp.status}`);
    const data = await resp.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route found');
    // GeoJSON coordinates are [lon, lat], Leaflet needs [lat, lon]
    const latlngs = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    setRouteCache(cacheKey, latlngs);
    return latlngs;
  }

  async function drawRoute(waypoints) {
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    clearTrafficLines();
    if (!waypoints || waypoints.length < 2) return;

    // Draw straight-line immediately as dashed placeholder
    const straight = waypoints.map(w => [w.lat, w.lon]);
    drawRouteLine(straight, ROUTE_STYLE_FALLBACK);

    // Then fetch and replace with actual road geometry (solid line)
    try {
      const roadPath = await fetchRoadGeometry(waypoints);
      drawRouteLine(roadPath, ROUTE_STYLE_PRECISE);
      // Layer traffic coloring on top in the background
      loadTrafficAsync(roadPath);
    } catch (e) {
      // Keep the straight-line fallback already drawn
      console.warn('Could not fetch road geometry, using straight line:', e.message);
    }
  }

  // ── Traffic coloring ──────────────────────────────────────────

  function getTrafficColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      clear: style.getPropertyValue('--traffic-clear').trim() || '#2DB84B',
      mild: style.getPropertyValue('--traffic-mild').trim() || '#E5A100',
      heavy: style.getPropertyValue('--traffic-heavy').trim() || '#DC2626',
    };
  }

  // Simulate traffic segments along the route. Each segment gets a
  // condition: 'clear', 'mild', or 'heavy'. Uses a seeded random based
  // on the coordinate so the pattern is stable per route but refreshes
  // each hour.
  function generateTrafficSegments(latlngs) {
    const SEGMENT_SIZE = 40; // points per segment
    const segments = [];
    const hourSeed = Math.floor(Date.now() / (60 * 60 * 1000));

    for (let i = 0; i < latlngs.length; i += SEGMENT_SIZE) {
      const slice = latlngs.slice(i, i + SEGMENT_SIZE + 1); // overlap by 1 for continuity
      if (slice.length < 2) continue;

      // Deterministic "random" per segment based on position + hour
      const lat = slice[0][0] || slice[0].lat || 0;
      const lon = slice[0][1] || slice[0].lng || slice[0][1] || 0;
      const hash = Math.abs(Math.sin(lat * 1000 + lon * 2000 + hourSeed) * 10000);
      const roll = hash % 100;

      let condition = 'clear';
      if (roll < 10) condition = 'heavy';       // 10% heavy
      else if (roll < 25) condition = 'mild';    // 15% mild

      segments.push({ points: slice, condition });
    }
    return segments;
  }

  function clearTrafficLines() {
    for (const line of trafficLines) {
      map.removeLayer(line);
    }
    trafficLines = [];
  }

  // Linearly interpolate between two hex colors. t is 0–1.
  function lerpColor(a, b, t) {
    const parse = (hex) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const ca = parse(a), cb = parse(b);
    const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
  }

  function applyTrafficColoring(latlngs) {
    clearTrafficLines();
    const colors = getTrafficColors();
    const segments = generateTrafficSegments(latlngs);
    const BLEND_STEPS = 4; // number of gradient sub-segments at each boundary

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const color = colors[seg.condition];
      const opacity = seg.condition === 'clear' ? 0.7 : 0.85;

      const line = L.polyline(seg.points, {
        color,
        weight: 5,
        opacity,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
      trafficLines.push(line);

      // Add a gradient transition to the next segment if the color changes
      const next = segments[s + 1];
      if (next && next.condition !== seg.condition) {
        const fromColor = colors[seg.condition];
        const toColor = colors[next.condition];
        const fromOpacity = opacity;
        const toOpacity = next.condition === 'clear' ? 0.7 : 0.85;
        // Use the last few points of this segment + first few of next
        const tailCount = Math.min(3, seg.points.length);
        const headCount = Math.min(3, next.points.length);
        const blendPts = [
          ...seg.points.slice(-tailCount),
          ...next.points.slice(0, headCount),
        ];
        if (blendPts.length >= 2) {
          for (let i = 0; i < BLEND_STEPS; i++) {
            const t = i / BLEND_STEPS;
            const tNext = (i + 1) / BLEND_STEPS;
            const startIdx = Math.floor(t * (blendPts.length - 1));
            const endIdx = Math.min(Math.floor(tNext * (blendPts.length - 1)) + 1, blendPts.length);
            const slice = blendPts.slice(startIdx, endIdx + 1);
            if (slice.length < 2) continue;
            const blendLine = L.polyline(slice, {
              color: lerpColor(fromColor, toColor, (t + tNext) / 2),
              weight: 5,
              opacity: fromOpacity + (toOpacity - fromOpacity) * ((t + tNext) / 2),
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(map);
            trafficLines.push(blendLine);
          }
        }
      }
    }
  }

  // Load traffic coloring in the background via requestIdleCallback
  // (or setTimeout fallback) so it doesn't block initial render.
  function loadTrafficAsync(latlngs) {
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
    schedule(() => applyTrafficColoring(latlngs));
  }

  function fitToRoute(waypoints, opts) {
    if (!waypoints || waypoints.length < 2) return;
    const latlngs = waypoints.map(w => [w.lat, w.lon]);
    _markProgrammatic();
    const paddingBottom = (opts && opts.paddingBottom) || 40;
    map.fitBounds(latlngs, {
      paddingTopLeft: [40, 40],
      paddingBottomRight: [40, paddingBottom],
      maxZoom: 10,
    });
  }

  // Shared icon instance — all camera markers look identical.
  // Leaflet clones the icon internally, so reuse is safe.
  let _cameraIcon = null;
  function getCameraIcon() {
    if (!_cameraIcon) {
      _cameraIcon = L.divIcon({ className: 'camera-marker', iconSize: [10, 10] });
    }
    return _cameraIcon;
  }

  function setMarkers(cameras, onMarkerClick) {
    markerCluster.clearLayers();
    markers.clear();
    activeMarkerId = null;
    hoveredMarkerId = null;

    for (const cam of cameras) {
      if (cam.status === 'inactive') continue;

      const marker = L.marker([cam.lat, cam.lon], {
        icon: getCameraIcon(),
      });

      // Popup with thumbnail
      const thumbUrl = cam.thumbnailUrl || cam.imageUrl;
      const popupHtml = `
        <div class="popup-content">
          ${thumbUrl ? `<img src="${thumbUrl}" alt="${cam.name}" loading="lazy" width="200" height="150" onerror="this.style.display='none'">` : ''}
          <div class="popup-name">${cam.name}</div>
          <div class="popup-highway">${cam.highway}${cam.direction ? ' · ' + cam.direction : ''}</div>
        </div>
      `;
      marker.bindPopup(popupHtml, {
        maxWidth: 220,
        className: 'camera-popup',
      });

      marker.on('click', () => {
        if (onMarkerClick) onMarkerClick(cam);
      });

      markers.set(cam.id, marker);
      markerCluster.addLayer(marker);
    }
  }

  function highlightMarker(camId) {
    // Remove previous highlight
    if (activeMarkerId) {
      const prevEl = _getVisibleEl(activeMarkerId);
      if (prevEl) prevEl.classList.remove('active');
    }
    activeMarkerId = camId;
    if (!markers.has(camId)) return;

    const marker = markers.get(camId);
    // Ensure the marker is visible (uncluster if needed)
    _markProgrammatic();
    markerCluster.zoomToShowLayer(marker, () => {
      const el = _getVisibleEl(camId);
      if (el) el.classList.add('active');
    });
  }

  let activeVisibleIds = new Set();
  let hoveredMarkerId = null;

  // Get the visible DOM element for a marker — if the marker is inside a
  // cluster, return the cluster's icon element instead.
  function _getVisibleEl(camId) {
    if (!markers.has(camId)) return null;
    const marker = markers.get(camId);
    const parent = markerCluster.getVisibleParent(marker);
    if (!parent) return null;
    return parent.getElement?.() ?? null;
  }

  function hoverMarker(camId) {
    if (camId === hoveredMarkerId) return;
    unhoverMarker();
    hoveredMarkerId = camId;
    const el = _getVisibleEl(camId);
    if (el) el.classList.add('map-hovered');
  }

  function unhoverMarker() {
    if (hoveredMarkerId) {
      const el = _getVisibleEl(hoveredMarkerId);
      if (el) el.classList.remove('map-hovered');
    }
    hoveredMarkerId = null;
  }

  function highlightVisible(visibleIds) {
    // Remove old highlights from markers and their parent clusters
    for (const id of activeVisibleIds) {
      if (!visibleIds.has(id)) {
        const el = _getVisibleEl(id);
        if (el) el.classList.remove('active');
      }
    }
    // Add new highlights — applies to cluster icon if marker is clustered
    for (const id of visibleIds) {
      const el = _getVisibleEl(id);
      if (el) el.classList.add('active');
    }
    activeVisibleIds = new Set(visibleIds);
  }

  // Fit map to show the visible cameras with enough context
  let fitDebounceTimer = null;

  function fitToVisible(visibleIds) {
    if (!visibleIds || visibleIds.size === 0) return;

    clearTimeout(fitDebounceTimer);
    fitDebounceTimer = setTimeout(() => {
      const latlngs = [];
      for (const id of visibleIds) {
        if (markers.has(id)) {
          const m = markers.get(id);
          latlngs.push(m.getLatLng());
        }
      }
      if (latlngs.length === 0) return;

      _markProgrammatic();
      if (latlngs.length === 1) {
        map.flyTo(latlngs[0], 10, { duration: 0.6 });
      } else {
        const bounds = L.latLngBounds(latlngs);
        map.flyToBounds(bounds, {
          padding: [40, 40],
          maxZoom: 11,
          duration: 0.6,
        });
      }
    }, 250);
  }

  function panTo(lat, lon, zoom) {
    _markProgrammatic();
    map.flyTo([lat, lon], zoom || 12, {
      duration: 0.8,
      easeLinearity: 0.25,
    });
  }

  // Pan without changing zoom — for scroll-tracking so we avoid the
  // flyTo zoom-out-then-zoom-in arc animation on every camera change.
  function smoothPanTo(lat, lon) {
    _markProgrammatic();
    map.panTo([lat, lon], { animate: true, duration: 0.3 });
  }

  // Highlight a marker visually (CSS class only) without calling
  // zoomToShowLayer, which would change zoom during scroll tracking.
  function highlightMarkerVisual(camId) {
    if (activeMarkerId) {
      const prevEl = _getVisibleEl(activeMarkerId);
      if (prevEl) prevEl.classList.remove('active');
    }
    activeMarkerId = camId;
    const el = _getVisibleEl(camId);
    if (el) el.classList.add('active');
  }

  // Zoom to fit visible cameras instantly (no animation) so Safari
  // doesn't show a CSS-transform scale effect while the user scrolls.
  function zoomToVisible(visibleIds) {
    if (!visibleIds || visibleIds.size === 0) return;
    const latlngs = [];
    for (const id of visibleIds) {
      if (markers.has(id)) {
        latlngs.push(markers.get(id).getLatLng());
      }
    }
    if (latlngs.length === 0) return;
    _markProgrammatic();
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 10, { animate: false });
    } else {
      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11, animate: false });
    }
  }

  function showUserLocation(lat, lon) {
    if (userLocationMarker) {
      userLocationMarker.setLatLng([lat, lon]);
    } else {
      userLocationMarker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'user-location-marker',
          iconSize: [12, 12],
        }),
        zIndexOffset: 10000,
      }).addTo(map);
    }
  }

  function _markProgrammatic() {
    _lastProgrammaticMove = Date.now();
  }

  function onViewportChange(callback) {
    _viewportCallback = callback;
    map.on('moveend', () => {
      if (!_viewportCallback) return;
      // Skip if this move was triggered programmatically (within last 1s)
      if (Date.now() - _lastProgrammaticMove < 1000) return;

      const bounds = map.getBounds();
      const visibleIds = [];
      for (const [id, marker] of markers) {
        if (bounds.contains(marker.getLatLng())) {
          visibleIds.push(id);
        }
      }
      _viewportCallback(visibleIds);
    });
  }

  function invalidateSize() {
    if (map) {
      setTimeout(() => map.invalidateSize(), 100);
    }
  }

  function toggleSatellite() {
    isSatellite = !isSatellite;
    if (isSatellite) {
      tileLayer.setUrl(TILE_SATELLITE);
      tileLayer.options.subdomains = 'abc';
    } else {
      tileLayer.setUrl(isDarkMode() ? TILE_DARK : TILE_LIGHT);
      tileLayer.options.subdomains = 'abcd';
    }
    return isSatellite;
  }

  function getMap() {
    return map;
  }

  return {
    init,
    drawRoute,
    fetchRoadGeometry,
    fitToRoute,
    setMarkers,
    highlightMarker,
    highlightMarkerVisual,
    highlightVisible,
    hoverMarker,
    unhoverMarker,
    fitToVisible,
    zoomToVisible,
    panTo,
    smoothPanTo,
    showUserLocation,
    invalidateSize,
    onViewportChange,
    toggleSatellite,
    getMap,
  };
})();
