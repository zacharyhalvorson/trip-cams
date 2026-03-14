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

    // Project point onto segment using dot product approximation
    const dx = bLon - aLon;
    const dy = bLat - aLat;
    const t = Math.max(0, Math.min(1,
      ((pLon - aLon) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy)
    ));
    const projLat = aLat + t * dy;
    const projLon = aLon + t * dx;
    return haversine(pLat, pLon, projLat, projLon);
  }

  // Minimum distance from a point to a polyline in km
  function pointToPolylineDistance(lat, lon, waypoints) {
    let minDist = Infinity;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const d = pointToSegmentDistance(
        lat, lon,
        waypoints[i].lat, waypoints[i].lon,
        waypoints[i + 1].lat, waypoints[i + 1].lon
      );
      if (d < minDist) minDist = d;
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
      const dx = bLon - aLon;
      const dy = bLat - aLat;
      const len2 = dx * dx + dy * dy;
      const t = len2 < 0.000001 ? 0 : Math.max(0, Math.min(1,
        ((lon - aLon) * dx + (lat - aLat) * dy) / len2
      ));
      const projLat = aLat + t * dy;
      const projLon = aLon + t * dx;
      const d = haversine(lat, lon, projLat, projLon);
      if (d < minDist) {
        minDist = d;
        bestIdx = i;
        bestT = t;
      }
    }
    return bestIdx + bestT;
  }

  // Normalize Alberta 511 camera data
  function normalizeAlberta(data) {
    if (!Array.isArray(data)) return [];
    const cameras = [];
    for (const cam of data) {
      if (!cam.Latitude || !cam.Longitude) continue;
      const views = cam.Views || [];
      for (const view of views) {
        cameras.push({
          id: `ab-${cam.Id}-${view.Id || 0}`,
          name: cam.Location || 'Unknown',
          highway: cam.Roadway || '',
          region: 'AB',
          lat: cam.Latitude,
          lon: cam.Longitude,
          imageUrl: view.Url || '',
          status: (view.Status || '').toLowerCase() === 'disabled' ? 'inactive' : 'active',
          direction: cam.Direction || view.Description || '',
          lastUpdated: view.LastUpdated || null,
        });
      }
      if (views.length === 0) {
        cameras.push({
          id: `ab-${cam.Id}`,
          name: cam.Location || 'Unknown',
          highway: cam.Roadway || '',
          region: 'AB',
          lat: cam.Latitude,
          lon: cam.Longitude,
          imageUrl: '',
          status: 'inactive',
          direction: cam.Direction || '',
          lastUpdated: null,
        });
      }
    }
    return cameras;
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
        };
      });
  }

  // Normalize WSDOT camera data
  function normalizeWA(data) {
    if (!Array.isArray(data)) return [];
    return data.filter(cam => cam.CameraLocation?.Latitude && cam.CameraLocation?.Longitude)
      .map(cam => ({
        id: `wa-${cam.CameraID}`,
        name: cam.Title || cam.CameraLocation?.Description || 'Unknown',
        highway: cam.CameraLocation?.RoadName || '',
        region: 'WA',
        lat: cam.CameraLocation.Latitude,
        lon: cam.CameraLocation.Longitude,
        imageUrl: cam.ImageURL || '',
        status: cam.IsActive ? 'active' : 'inactive',
        direction: cam.CameraLocation?.Direction || '',
        lastUpdated: null,
      }));
  }

  // Alberta highway keywords — filter out urban intersection cameras
  const AB_HIGHWAY_KEYWORDS = [
    'highway', 'hwy', 'qe2', 'qeii', 'trans-canada', 'trans canada',
    'yellowhead', 'icefields', 'crowsnest',
  ];

  function isHighwayCamera(cam) {
    // BC and WA cameras are already highway cameras
    if (cam.region !== 'AB') return true;
    const name = (cam.name + ' ' + cam.highway).toLowerCase();
    // Check for highway keywords
    if (AB_HIGHWAY_KEYWORDS.some(kw => name.includes(kw))) return true;
    // Check for numbered highway pattern (e.g., "Hwy 1", "Highway 2")
    if (/\bhwy\s*\d|highway\s*\d|\b(ab-)?[12]\s/i.test(name)) return true;
    // Filter out cameras clearly in urban Calgary/Edmonton (named after streets)
    const urbanPatterns = /\b(ave|avenue|street|st|drive|dr|boulevard|blvd|trail|road|rd|way|crescent|gate)\b/i;
    if (urbanPatterns.test(cam.highway) && !/(highway|hwy)/i.test(cam.highway)) return false;
    return true;
  }

  // Filter cameras to those within the route corridor
  function filterByCorridor(cameras, waypoints, bufferKm) {
    return cameras.filter(cam =>
      isHighwayCamera(cam) &&
      pointToPolylineDistance(cam.lat, cam.lon, waypoints) <= bufferKm
    );
  }

  // Sort cameras by their position along the route
  function sortByRoute(cameras, waypoints) {
    return cameras.slice().sort((a, b) => {
      const posA = routePosition(a.lat, a.lon, waypoints);
      const posB = routePosition(b.lat, b.lon, waypoints);
      return posA - posB;
    });
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

  return {
    normalizeAlberta,
    normalizeBC,
    normalizeWA,
    filterByCorridor,
    sortByRoute,
    findRoute,
    getAllStops,
    nearestStop,
    haversine,
  };
})();
