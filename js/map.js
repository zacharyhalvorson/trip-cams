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

  const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

  function isDarkMode() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function init() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
    });

    const tileLayer = L.tileLayer(isDarkMode() ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTR,
      maxZoom: 18,
      subdomains: 'abcd',
    }).addTo(map);

    // Switch tiles when color scheme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      tileLayer.setUrl(e.matches ? TILE_DARK : TILE_LIGHT);
    });

    // Zoom control on the right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Attribution bottom-right
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

    // Marker cluster group
    markerCluster = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div>${count}</div>`,
          className: 'marker-cluster',
          iconSize: L.point(36, 36),
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

  const ROUTE_STYLE = {
    color: '#2DB84B',
    weight: 3,
    opacity: 0.5,
    dashArray: '8, 8',
    lineCap: 'round',
  };

  function drawRouteLine(latlngs) {
    if (routeLine) {
      map.removeLayer(routeLine);
    }
    routeLine = L.polyline(latlngs, ROUTE_STYLE).addTo(map);
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
    if (!waypoints || waypoints.length < 2) return;

    // Draw straight-line immediately as placeholder
    const straight = waypoints.map(w => [w.lat, w.lon]);
    drawRouteLine(straight);

    // Then fetch and replace with actual road geometry
    try {
      const roadPath = await fetchRoadGeometry(waypoints);
      drawRouteLine(roadPath);
    } catch (e) {
      // Keep the straight-line fallback already drawn
      console.warn('Could not fetch road geometry, using straight line:', e.message);
    }
  }

  function fitToRoute(waypoints) {
    if (!waypoints || waypoints.length < 2) return;
    const latlngs = waypoints.map(w => [w.lat, w.lon]);
    _markProgrammatic();
    map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 10 });
  }

  function createMarkerIcon(region) {
    return L.divIcon({
      className: `camera-marker ${region}`,
      iconSize: [14, 14],
    });
  }

  function setMarkers(cameras, onMarkerClick) {
    markerCluster.clearLayers();
    markers.clear();
    activeMarkerId = null;

    for (const cam of cameras) {
      if (cam.status === 'inactive') continue;

      const marker = L.marker([cam.lat, cam.lon], {
        icon: createMarkerIcon(cam.region),
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
    if (activeMarkerId && markers.has(activeMarkerId)) {
      const prev = markers.get(activeMarkerId);
      const prevEl = prev.getElement?.();
      if (prevEl) prevEl.classList.remove('active');
    }

    activeMarkerId = camId;
    if (!markers.has(camId)) return;

    const marker = markers.get(camId);
    // Ensure the marker is visible (uncluster if needed)
    _markProgrammatic();
    markerCluster.zoomToShowLayer(marker, () => {
      const el = marker.getElement?.();
      if (el) el.classList.add('active');
    });
  }

  let activeVisibleIds = new Set();

  function highlightVisible(visibleIds) {
    // Remove old highlights
    for (const id of activeVisibleIds) {
      if (!visibleIds.has(id) && markers.has(id)) {
        const el = markers.get(id).getElement?.();
        if (el) el.classList.remove('active');
      }
    }
    // Add new highlights
    for (const id of visibleIds) {
      if (markers.has(id)) {
        const el = markers.get(id).getElement?.();
        if (el) el.classList.add('active');
      }
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

  function showUserLocation(lat, lon) {
    if (userLocationMarker) {
      userLocationMarker.setLatLng([lat, lon]);
    } else {
      userLocationMarker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'user-location-marker',
          iconSize: [16, 16],
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

  function getMap() {
    return map;
  }

  return {
    init,
    drawRoute,
    fitToRoute,
    setMarkers,
    highlightMarker,
    highlightVisible,
    fitToVisible,
    panTo,
    showUserLocation,
    invalidateSize,
    onViewportChange,
    getMap,
  };
})();
