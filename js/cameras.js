/* =============================================================
   cameras.js — Data normalization, corridor filtering, sorting
   ============================================================= */

const Cameras = (() => {
  const EARTH_RADIUS_KM = 6371;

  function toRad(deg) {
    return deg * Math.PI / 180;
  }

  // Haversine distance between two points in km
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Minimum distance from a point to a line segment (A-B) in km
  function pointToSegmentDistance(pLat, pLon, aLat, aLon, bLat, bLon) {
    const dAB = haversine(aLat, aLon, bLat, bLon);
    if (dAB < 0.001) return haversine(pLat, pLon, aLat, aLon);

    // Project point onto segment using dot product approximation.
    // Scale longitude by cos(midLat) so 1° lon ≈ 1° lat in distance,
    // correcting for longitude convergence at higher latitudes.
    const midLat = (aLat + bLat) / 2;
    const cosLat = Math.cos(toRad(midLat));
    const dx = (bLon - aLon) * cosLat;
    const dy = bLat - aLat;
    const t = Math.max(0, Math.min(1,
      ((pLon - aLon) * cosLat * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy)
    ));
    const projLat = aLat + t * (bLat - aLat);
    const projLon = aLon + t * (bLon - aLon);
    return haversine(pLat, pLon, projLat, projLon);
  }

  // Minimum distance from a point to a polyline in km.
  // For dense polylines (OSRM geometry), uses a generous bounding-box pre-filter
  // to skip segments that are clearly far away (> ~220km). This is purely a
  // performance optimization and must never affect the computed distance.
  function pointToPolylineDistance(lat, lon, waypoints) {
    let minDist = Infinity;
    // 2 degrees ≈ 220km — generous enough to never cause false skips
    const useBbox = waypoints.length > 50;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const aLat = waypoints[i].lat, aLon = waypoints[i].lon;
      const bLat = waypoints[i + 1].lat, bLon = waypoints[i + 1].lon;
      if (useBbox &&
          (lat < (aLat < bLat ? aLat : bLat) - 2 || lat > (aLat > bLat ? aLat : bLat) + 2 ||
           lon < (aLon < bLon ? aLon : bLon) - 2 || lon > (aLon > bLon ? aLon : bLon) + 2)) continue;
      const d = pointToSegmentDistance(lat, lon, aLat, aLon, bLat, bLon);
      if (d < minDist) {
        minDist = d;
        if (minDist < 0.1) return minDist; // on the road
      }
    }
    return minDist;
  }

  // Find the closest waypoint index for a camera (for sorting by route order)
  function routePosition(lat, lon, waypoints) {
    let minDist = Infinity;
    let bestIdx = 0;
    let bestT = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const aLat = waypoints[i].lat, aLon = waypoints[i].lon;
      const bLat = waypoints[i + 1].lat, bLon = waypoints[i + 1].lon;
      const midLat = (aLat + bLat) / 2;
      const cosLat = Math.cos(toRad(midLat));
      const dx = (bLon - aLon) * cosLat;
      const dy = bLat - aLat;
      const len2 = dx * dx + dy * dy;
      const t = len2 < 0.000001 ? 0 : Math.max(0, Math.min(1,
        ((lon - aLon) * cosLat * dx + (lat - aLat) * dy) / len2
      ));
      const projLat = aLat + t * (bLat - aLat);
      const projLon = aLon + t * (bLon - aLon);
      const d = haversine(lat, lon, projLat, projLon);
      if (d < minDist) {
        minDist = d;
        bestIdx = i;
        bestT = t;
      }
    }
    return bestIdx + bestT;
  }

  function normalizeAlberta(data) {
    return normalizeIBI(data, 'AB');
  }

  // Normalize DriveBC camera data
  // API returns GeoJSON coordinates [lon, lat], image paths are relative to https://www.drivebc.ca
  const DRIVEBC_BASE = 'https://www.drivebc.ca';

  function normalizeBC(data) {
    if (!Array.isArray(data) && data?.webcams) {
      data = data.webcams;
    }
    if (!Array.isArray(data)) return [];
    return data.filter(cam => {
        // GeoJSON: coordinates = [longitude, latitude]
        const coords = cam.location?.coordinates;
        return coords && coords.length >= 2;
      })
      .filter(cam => cam.should_appear !== false)
      .map(cam => {
        const coords = cam.location.coordinates;
        const imgPath = cam.links?.imageDisplay || '';
        const imageUrl = imgPath.startsWith('http') ? imgPath : (imgPath ? DRIVEBC_BASE + imgPath : '');
        return {
          id: `bc-${cam.id}`,
          name: cam.name || cam.caption || 'Unknown',
          highway: cam.highway_display || cam.highway || '',
          region: 'BC',
          lat: coords[1],
          lon: coords[0],
          imageUrl: imageUrl.split('?')[0], // strip cache-bust param, we add our own
          thumbnailUrl: imageUrl.split('?')[0],
          status: cam.is_on ? 'active' : 'inactive',
          direction: cam.orientation || '',
          lastUpdated: cam.last_update_modified || null,
          temperature: cam.temperature ?? cam.currentWeather?.temperature ?? null,
        };
      });
  }

  // Normalize WSDOT camera data — handles multiple API response formats.
  // Logs diagnostics when normalization produces unexpected results.
  function normalizeWA(data) {
    if (!data) {
      console.warn('[WA] normalizeWA called with falsy data:', data);
      return [];
    }

    // Reject HTML error pages (API sometimes returns these on failure)
    if (typeof data === 'string') {
      console.warn('[WA] Received string instead of JSON (likely HTML error page)');
      return [];
    }

    // Reject error wrapper objects (e.g. { error: { code: 500, ... } })
    if (data.error && !data.features && !Array.isArray(data)) {
      console.warn('[WA] Received error response:', data.error);
      return [];
    }

    let cameras = [];

    // Format 1: REST API — array of objects with CameraID
    // Used by /mobile/Cameras.json and HighwayCamerasREST.svc
    if (Array.isArray(data) && data.length > 0 && data[0].CameraID !== undefined) {
      cameras = normalizeWA_REST(data);
    }
    // Format 2: ArcGIS FeatureServer — { features: [...] }
    else if (data?.features && Array.isArray(data.features)) {
      cameras = normalizeArcGIS(data, 'WA');
    }
    // Format 3: Mobile endpoint — { cameras: { items: [...] } }
    else if (data?.cameras?.items) {
      cameras = normalizeWA_Mobile(data.cameras.items);
    }
    // Format 4: Unwrapped array (mobile endpoint, plain array of lowercase objects)
    else if (Array.isArray(data) && data.length > 0 && (data[0].lat || data[0].latitude)) {
      cameras = normalizeWA_Mobile(data);
    }
    else {
      // Unknown format — log the shape to help debug future API changes
      const keys = typeof data === 'object' ? Object.keys(data).slice(0, 10) : [];
      const isArr = Array.isArray(data);
      const sample = isArr && data.length > 0 ? Object.keys(data[0]).slice(0, 10) : [];
      console.warn(`[WA] Unknown response format. Type: ${typeof data}, isArray: ${isArr}, keys: [${keys}], sample item keys: [${sample}]`);
      return [];
    }

    if (cameras.length === 0 && (Array.isArray(data) ? data.length > 0 : data?.features?.length > 0)) {
      console.warn(`[WA] Normalization returned 0 cameras from non-empty input (${Array.isArray(data) ? data.length : data?.features?.length} raw items)`);
    }

    return cameras;
  }

  // WSDOT REST API format (CameraID-based objects)
  function normalizeWA_REST(data) {
    return data
      .filter(cam => {
        const lat = cam.DisplayLatitude || cam.CameraLocation?.Latitude;
        const lon = cam.DisplayLongitude || cam.CameraLocation?.Longitude;
        return lat && lon;
      })
      .map(cam => ({
        id: `wa-${cam.CameraID}`,
        name: cam.Title || cam.Description || 'Unknown',
        highway: cam.CameraLocation?.RoadName || '',
        region: 'WA',
        lat: cam.DisplayLatitude || cam.CameraLocation?.Latitude,
        lon: cam.DisplayLongitude || cam.CameraLocation?.Longitude,
        imageUrl: cam.ImageURL || cam.CameraImageURL || '',
        status: cam.IsActive !== false ? 'active' : 'inactive',
        direction: cam.CameraLocation?.Direction || '',
        lastUpdated: null,
        temperature: cam.Temperature ?? cam.CurrentTemperature ?? null,
      }));
  }

  // WSDOT mobile endpoint format (lowercase field names)
  function normalizeWA_Mobile(items) {
    return items
      .filter(cam => (cam.lat || cam.latitude) && (cam.lon || cam.longitude))
      .map(cam => ({
        id: `wa-${cam.id || cam.cameraId || `${cam.lat || cam.latitude}-${cam.lon || cam.longitude}`}`,
        name: cam.title || cam.name || cam.description || 'Unknown',
        highway: cam.roadName || cam.road || cam.route || '',
        region: 'WA',
        lat: cam.lat || cam.latitude,
        lon: cam.lon || cam.longitude,
        imageUrl: cam.url || cam.imageUrl || cam.imageURL || '',
        status: cam.isActive !== false ? 'active' : 'inactive',
        direction: cam.direction || '',
        lastUpdated: null,
        temperature: cam.temperature ?? cam.temp ?? null,
      }));
  }

  // Unwrap IBI 511 responses — some deployments return a raw array, others wrap
  // it in an object under keys like 'body', 'cameras', or 'data'.
  function unwrapIBI(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      for (const key of ['body', 'cameras', 'data', 'results', 'items']) {
        if (Array.isArray(data[key])) return data[key];
      }
    }
    return [];
  }

  // Generic IBI 511 normalizer — same format as Alberta but with configurable region code
  function normalizeIBI(data, region) {
    const items = unwrapIBI(data);
    if (items.length === 0) return [];
    const prefix = region.toLowerCase();
    const cameras = [];
    for (const cam of items) {
      if (!cam.Latitude || !cam.Longitude) continue;
      const views = cam.Views || [];
      for (const view of views) {
        cameras.push({
          id: `${prefix}-${cam.Id}-${view.Id || 0}`,
          name: cam.Location || 'Unknown',
          highway: cam.Roadway || '',
          region,
          lat: cam.Latitude,
          lon: cam.Longitude,
          imageUrl: view.Url || '',
          status: (view.Status || '').toLowerCase() === 'disabled' ? 'inactive' : 'active',
          direction: cam.Direction || view.Description || '',
          lastUpdated: view.LastUpdated || null,
          temperature: cam.Temperature ?? null,
        });
      }
      if (views.length === 0) {
        cameras.push({
          id: `${prefix}-${cam.Id}`,
          name: cam.Location || 'Unknown',
          highway: cam.Roadway || '',
          region,
          lat: cam.Latitude,
          lon: cam.Longitude,
          imageUrl: '',
          status: 'inactive',
          direction: cam.Direction || '',
          lastUpdated: null,
          temperature: cam.Temperature ?? null,
        });
      }
    }
    return cameras;
  }

  // Normalize Quebec camera data (WFS GeoJSON)
  function normalizeQC(data) {
    const features = data?.features || (Array.isArray(data) ? data : []);
    return features
      .filter(f => f.geometry?.coordinates?.length >= 2)
      .map(f => {
        const coords = f.geometry.coordinates;
        const p = f.properties || {};
        const imgUrl = p.url_image_en || p.url_image_fr || p.url_image || '';
        return {
          id: `qc-${p.id || p.id_camera || Math.random().toString(36).slice(2, 8)}`,
          name: p.nom || p.description || p.name || 'Unknown',
          highway: p.route || p.roadway || '',
          region: 'QC',
          lat: coords[1],
          lon: coords[0],
          imageUrl: imgUrl,
          status: 'active',
          direction: p.direction || '',
          lastUpdated: null,
          temperature: p.temperature ?? p.Temperature ?? null,
        };
      });
  }

  // Normalize Maryland camera data
  function normalizeMD(data) {
    if (!Array.isArray(data)) return [];
    return data
      .filter(cam => cam.lat && cam.lon)
      .map(cam => ({
        id: `md-${cam.cameraId || cam.id || Math.random().toString(36).slice(2, 8)}`,
        name: cam.description || cam.name || cam.location || 'Unknown',
        highway: cam.roadName || cam.road || '',
        region: 'MD',
        lat: parseFloat(cam.lat),
        lon: parseFloat(cam.lon),
        imageUrl: cam.imageUrl || cam.url || '',
        status: cam.isActive !== false ? 'active' : 'inactive',
        direction: cam.direction || '',
        lastUpdated: cam.lastUpdated || null,
        temperature: cam.temperature ?? cam.Temperature ?? null,
      }));
  }

  // Normalize Ohio camera data
  function normalizeOH(data) {
    const items = data?.results || (Array.isArray(data) ? data : []);
    return items
      .filter(cam => cam.latitude && cam.longitude)
      .map(cam => ({
        id: `oh-${cam.id || Math.random().toString(36).slice(2, 8)}`,
        name: cam.description || cam.location || 'Unknown',
        highway: cam.routeName || cam.route || '',
        region: 'OH',
        lat: parseFloat(cam.latitude),
        lon: parseFloat(cam.longitude),
        imageUrl: cam.smallImageUrl || cam.largeImageUrl || cam.imageUrl || '',
        status: cam.status === 'active' || cam.isActive !== false ? 'active' : 'inactive',
        direction: cam.direction || '',
        lastUpdated: cam.lastUpdated || null,
        temperature: cam.temperature ?? cam.Temperature ?? null,
      }));
  }

  // Normalize North Dakota camera data (GeoJSON)
  function normalizeND(data) {
    const features = data?.features || (Array.isArray(data) ? data : []);
    return features
      .filter(f => f.geometry?.coordinates?.length >= 2)
      .map(f => {
        const coords = f.geometry.coordinates;
        const p = f.properties || {};
        return {
          id: `nd-${p.id || p.ID || Math.random().toString(36).slice(2, 8)}`,
          name: p.title || p.name || p.description || 'Unknown',
          highway: p.route || p.road || '',
          region: 'ND',
          lat: coords[1],
          lon: coords[0],
          imageUrl: p.imageUrl || p.image_url || p.url || '',
          status: 'active',
          direction: p.direction || '',
          lastUpdated: null,
          temperature: p.temperature ?? p.Temperature ?? null,
        };
      });
  }

  // Normalize ArcGIS Feature Service response
  function normalizeArcGIS(data, region) {
    const features = data?.features || [];
    const prefix = region.toLowerCase();
    return features
      .filter(f => {
        const g = f.geometry;
        const a = f.attributes;
        // ArcGIS can return coordinates in geometry or attributes
        return (g?.y && g?.x) || (a?.latitude && a?.longitude) || (a?.Latitude && a?.Longitude);
      })
      .map(f => {
        const a = f.attributes || {};
        const g = f.geometry || {};
        const lat = g.y || parseFloat(a.latitude || a.Latitude || a.LAT || 0);
        const lon = g.x || parseFloat(a.longitude || a.Longitude || a.LON || 0);
        const imgUrl = a.CameraImageURL || a.CameraImag || a.imageurl || a.ImageUrl || a.ImageURL || a.image_url || a.URL || a.url || '';
        return {
          id: `${prefix}-${a.OBJECTID || a.objectid || a.FID || a.id || a.CameraID || Math.random().toString(36).slice(2, 8)}`,
          name: a.title || a.Title || a.CameraTitle || a.CameraTitl || a.description || a.Description || a.NAME || a.Name || 'Unknown',
          highway: a.route || a.Route || a.road || a.Road || a.RoadName || a.StateRoute || '',
          region,
          lat,
          lon,
          imageUrl: imgUrl,
          status: 'active',
          direction: a.direction || a.Direction || a.CompassDirection || '',
          lastUpdated: null,
          temperature: a.Temperature ?? a.temperature ?? a.AirTemperature ?? a.airTemperature ?? a.Temp ?? null,
        };
      });
  }

  // Normalize California Caltrans camera data (per-district JSON)
  // Format: { data: [{ cctv: { index, location: { latitude, longitude, locationName, route, ... },
  //   inService, imageData: { static: { currentImageURL } } } }] }
  function normalizeCA(data) {
    // Unwrap: API returns { data: [...] }, but merged array may be flat
    let items = [];
    if (Array.isArray(data)) {
      // Could be array of { cctv: ... } objects (from data array) or already flattened
      items = data;
    } else if (data?.data && Array.isArray(data.data)) {
      items = data.data;
    } else {
      return [];
    }

    return items
      .filter(item => {
        const cctv = item.cctv || item;
        const loc = cctv.location || {};
        return loc.latitude && loc.longitude;
      })
      .map(item => {
        const cctv = item.cctv || item;
        const loc = cctv.location || {};
        const imgData = cctv.imageData || {};
        const staticImg = imgData.static || {};
        const imgUrl = staticImg.currentImageURL || cctv.imageUrl || '';
        return {
          id: `ca-${cctv.index || cctv.id || Math.random().toString(36).slice(2, 8)}`,
          name: loc.locationName || cctv.name || 'Unknown',
          highway: loc.route || '',
          region: 'CA',
          lat: parseFloat(loc.latitude),
          lon: parseFloat(loc.longitude),
          imageUrl: imgUrl.startsWith('http') ? imgUrl : (imgUrl ? `https://cwwp2.dot.ca.gov${imgUrl}` : ''),
          status: cctv.inService === 'true' || cctv.inService === true ? 'active' : 'inactive',
          direction: loc.direction || '',
          lastUpdated: null,
          temperature: cctv.temperature ?? cctv.Temperature ?? loc.temperature ?? null,
        };
      });
  }

  // Alberta highway keywords — filter out urban intersection cameras
  const AB_HIGHWAY_KEYWORDS = [
    'highway', 'hwy', 'qe2', 'qeii', 'trans-canada', 'trans canada',
    'yellowhead', 'icefields', 'crowsnest',
  ];

  // Regions that use IBI 511 and may include urban intersection cameras
  const IBI_REGIONS = new Set(['AB', 'SK', 'MB', 'ON', 'NB', 'NS', 'PE', 'NL', 'YT',
    'NY', 'NJ', 'PA', 'CT', 'MA', 'VT', 'NH', 'ME',
    'GA', 'FL', 'SC', 'NC', 'VA', 'WV',
    'WI', 'IL', 'IN', 'MI', 'MN', 'IA', 'MO', 'NE', 'KS', 'SD',
    'LA', 'TX', 'OK', 'AR', 'MS', 'AL', 'TN',
    'AZ', 'CO', 'NM', 'MT', 'ID', 'AK', 'UT', 'NV']);

  function isHighwayCamera(cam) {
    // For IBI 511 regions, apply highway keyword filtering to reduce urban cameras
    if (IBI_REGIONS.has(cam.region)) {
      const text = (cam.name + ' ' + cam.highway).toLowerCase();
      if (AB_HIGHWAY_KEYWORDS.some(kw => text.includes(kw))) return true;
      if (/\bhwy\s*\d|highway\s*\d|interstate|i-\d|\bi\d{2,3}\b|us-?\d|route\s*\d|sr\s*\d|state\s*route/i.test(cam.highway || cam.name)) return true;
      // If the camera has a highway/roadway field with content, assume it's a highway camera
      if (cam.highway && cam.highway.trim().length > 0) return true;
      return false;
    }
    // All other regions: cameras are pre-filtered or highway-only
    return true;
  }

  // Cache corridor distance results to avoid recomputing for same camera+route
  let _corridorCache = { waypointKey: '', distances: new Map() };

  function getCorridorCacheKey(waypoints) {
    // For dense geometry (OSRM), sample a subset of points for the cache key
    // to avoid serializing thousands of coordinates
    if (waypoints.length > 50) {
      const step = Math.floor(waypoints.length / 20);
      const samples = [];
      for (let i = 0; i < waypoints.length; i += step) {
        samples.push(`${waypoints[i].lat.toFixed(3)},${waypoints[i].lon.toFixed(3)}`);
      }
      // Always include the last point
      const last = waypoints[waypoints.length - 1];
      samples.push(`${last.lat.toFixed(3)},${last.lon.toFixed(3)}`);
      return `dense:${waypoints.length}:${samples.join('|')}`;
    }
    return waypoints.map(w => `${w.lat.toFixed(3)},${w.lon.toFixed(3)}`).join('|');
  }

  // Downsample a dense polyline to reduce segment count for filtering/sorting.
  // Keeps every Nth point so that spacing is roughly `targetSpacingKm`.
  function downsamplePolyline(waypoints, targetSpacingKm) {
    if (waypoints.length <= 100) return waypoints;
    const n = waypoints.length;
    // Straight-line distance × 1.3 to approximate road sinuosity
    const totalKm = haversine(waypoints[0].lat, waypoints[0].lon,
      waypoints[n - 1].lat, waypoints[n - 1].lon) * 1.3;
    const avgSpacing = totalKm / n;
    const step = Math.max(1, Math.round(targetSpacingKm / avgSpacing));
    if (step <= 1) return waypoints;
    const result = [];
    for (let i = 0; i < n; i += step) result.push(waypoints[i]);
    if (result[result.length - 1] !== waypoints[n - 1]) result.push(waypoints[n - 1]);
    return result;
  }

  // Filter cameras to those within the route corridor.
  // Uses segment projection for precision, then verifies with direct haversine
  // to sampled route points as a safety net against projection edge cases.
  function filterByCorridor(cameras, waypoints, bufferKm) {
    const wpKey = getCorridorCacheKey(waypoints);
    if (_corridorCache.waypointKey !== wpKey) {
      _corridorCache = { waypointKey: wpKey, distances: new Map() };
    }
    const distCache = _corridorCache.distances;

    // Pre-sample route points for haversine verification
    const verifySamples = _buildRouteSamples(waypoints, bufferKm);

    return cameras.filter(cam => {
      if (!isHighwayCamera(cam)) return false;
      let dist = distCache.get(cam.id);
      if (dist === undefined) {
        dist = pointToPolylineDistance(cam.lat, cam.lon, waypoints);
        distCache.set(cam.id, dist);
      }
      if (dist > bufferKm) return false;
      // Verify: camera must be within maxDist of a sampled route point
      if (verifySamples) {
        for (const s of verifySamples.pts) {
          if (haversine(cam.lat, cam.lon, s.lat, s.lon) <= verifySamples.maxDist) return true;
        }
        return false;
      }
      return true;
    });
  }

  // Build sampled route points for haversine verification.
  // Only used for dense geometry (> 50 waypoints) where segment projection
  // edge cases are most likely.
  function _buildRouteSamples(waypoints, bufferKm) {
    if (waypoints.length <= 50) return null;
    const step = Math.max(1, Math.floor(waypoints.length / 200));
    const pts = [];
    for (let i = 0; i < waypoints.length; i += step) pts.push(waypoints[i]);
    pts.push(waypoints[waypoints.length - 1]);
    return { pts, maxDist: bufferKm * 3 };
  }

  // Sort cameras by their position along the route
  function sortByRoute(cameras, waypoints) {
    // Pre-compute positions to avoid repeated O(segments) work per comparison
    const posMap = new Map();
    for (const cam of cameras) {
      posMap.set(cam.id, routePosition(cam.lat, cam.lon, waypoints));
    }
    return cameras.slice().sort((a, b) => posMap.get(a.id) - posMap.get(b.id));
  }

  // Get subset of waypoints between two named stops
  function getWaypointsBetween(allStops, fromId, toId) {
    const fromIdx = allStops.findIndex(s => s.id === fromId);
    const toIdx = allStops.findIndex(s => s.id === toId);
    if (fromIdx === -1 || toIdx === -1) return allStops;

    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    return allStops.slice(start, end + 1);
  }

  // Get all unique city stops from route data
  function getAllStops(routeData) {
    const seen = new Set();
    const stops = [];
    for (const route of Object.values(routeData.routes)) {
      for (const stop of route.stops) {
        if (!seen.has(stop.id)) {
          seen.add(stop.id);
          stops.push(stop);
        }
      }
    }
    return stops;
  }

  // Find the best route between two stops
  // When both stops exist in multiple routes, pick the one with fewest intermediate stops
  function findRoute(routeData, fromId, toId) {
    let bestSegment = null;
    for (const route of Object.values(routeData.routes)) {
      const fromIdx = route.stops.findIndex(s => s.id === fromId);
      const toIdx = route.stops.findIndex(s => s.id === toId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        const segment = route.stops.slice(start, end + 1);
        if (!bestSegment || segment.length < bestSegment.length) {
          bestSegment = segment;
        }
      }
    }
    if (bestSegment) {
      return bestSegment;
    }
    // Fallback: use northern route
    const northern = routeData.routes.northern.stops;
    return getWaypointsBetween(northern, fromId, toId);
  }

  // Find nearest stop to a lat/lon
  function nearestStop(lat, lon, stops) {
    let minDist = Infinity;
    let nearest = stops[0];
    for (const stop of stops) {
      const d = haversine(lat, lon, stop.lat, stop.lon);
      if (d < minDist) {
        minDist = d;
        nearest = stop;
      }
    }
    return nearest;
  }

  // ── Clustering ────────────────────────────────────────────────

  // Group route-sorted cameras within `thresholdKm` of each other.
  // Because cameras are already sorted by route position, nearby cameras
  // in the same physical location will be adjacent in the array.
  function clusterCameras(cameras, thresholdKm = 0.1) {
    if (cameras.length === 0) return [];
    const clusters = [];
    let current = { cameras: [cameras[0]], lat: cameras[0].lat, lon: cameras[0].lon };

    for (let i = 1; i < cameras.length; i++) {
      const cam = cameras[i];
      const dist = haversine(current.lat, current.lon, cam.lat, cam.lon);
      if (dist <= thresholdKm) {
        current.cameras.push(cam);
      } else {
        clusters.push(current);
        current = { cameras: [cam], lat: cam.lat, lon: cam.lon };
      }
    }
    clusters.push(current);
    return clusters;
  }

  // ── Direction Parsing ─────────────────────────────────────────

  // Map cardinal/intercardinal direction strings to bearings (degrees from north)
  const DIRECTION_BEARINGS = {
    'n': 0, 'north': 0, 'northbound': 0,
    'ne': 45, 'northeast': 45, 'northeastbound': 45,
    'e': 90, 'east': 90, 'eastbound': 90,
    'se': 135, 'southeast': 135, 'southeastbound': 135,
    's': 180, 'south': 180, 'southbound': 180,
    'sw': 225, 'southwest': 225, 'southwestbound': 225,
    'w': 270, 'west': 270, 'westbound': 270,
    'nw': 315, 'northwest': 315, 'northwestbound': 315,
  };

  function directionToBearing(dirStr) {
    if (!dirStr) return null;
    const key = dirStr.trim().toLowerCase();
    return DIRECTION_BEARINGS[key] ?? null;
  }

  // Bearing from point A to point B (degrees 0-360, 0 = north)
  function bearingBetween(lat1, lon1, lat2, lon2) {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  // Smallest angular difference between two bearings (0-180)
  function angleDiff(a, b) {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  // Compute the route's travel bearing at a given position along the waypoints.
  // Uses the two waypoints bracketing the cluster to determine forward direction.
  function travelBearingAt(lat, lon, waypoints) {
    if (waypoints.length < 2) return 0;
    const pos = routePosition(lat, lon, waypoints);
    const idx = Math.floor(pos);
    const safeIdx = Math.min(idx, waypoints.length - 2);
    const a = waypoints[safeIdx];
    const b = waypoints[safeIdx + 1];
    return bearingBetween(a.lat, a.lon, b.lat, b.lon);
  }

  // Sort cameras within a cluster so the one facing the travel direction comes first.
  // Cameras with unknown direction are pushed to the end.
  // When `reversed` is true, the user is traveling opposite to waypoint order.
  function sortClusterByTravelDirection(cluster, waypoints, reversed) {
    if (cluster.cameras.length <= 1) return;
    let bearing = travelBearingAt(cluster.lat, cluster.lon, waypoints);
    if (reversed) bearing = (bearing + 180) % 360;
    cluster.cameras.sort((a, b) => {
      const aBearing = directionToBearing(a.direction);
      const bBearing = directionToBearing(b.direction);
      // Unknown directions go last
      if (aBearing === null && bBearing === null) return 0;
      if (aBearing === null) return 1;
      if (bBearing === null) return -1;
      // Sort by closest to travel bearing
      return angleDiff(aBearing, bearing) - angleDiff(bBearing, bearing);
    });
  }

  return {
    normalizeAlberta,
    normalizeBC,
    normalizeWA,
    normalizeIBI,
    normalizeQC,
    normalizeMD,
    normalizeOH,
    normalizeND,
    normalizeArcGIS,
    normalizeCA,
    pointToPolylineDistance,
    downsamplePolyline,
    filterByCorridor,
    sortByRoute,
    clusterCameras,
    sortClusterByTravelDirection,
    findRoute,
    getAllStops,
    nearestStop,
    haversine,
  };
})();
