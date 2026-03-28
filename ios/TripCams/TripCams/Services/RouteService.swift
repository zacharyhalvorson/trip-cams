//
//  RouteService.swift
//  TripCams
//

import Foundation
import CoreLocation

class RouteService: ObservableObject {
    static let shared = RouteService()

    private let routeCacheDuration: TimeInterval = 86400 // 24 hours

    @Published var routeData: RouteData?

    private var cachedRegionBounds: RegionBoundsData?

    // MARK: - Bundled Data

    /// Load bundled route.json and assign route IDs from dictionary keys
    func loadBundledRoutes() {
        guard let url = Bundle.main.url(forResource: "route", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(RouteData.self, from: data) else {
            return
        }
        var routes = decoded.routes
        for (key, var route) in routes {
            route.id = key
            routes[key] = route
        }
        self.routeData = RouteData(routes: routes, corridorBuffer: decoded.corridorBuffer)
    }

    /// Find the ordered list of stops between two stop IDs on a given route
    func findStops(routeId: String, from fromId: String, to toId: String) -> [RouteStop]? {
        guard let route = routeData?.routes[routeId] else { return nil }
        guard let fromIdx = route.stops.firstIndex(where: { $0.id == fromId }),
              let toIdx = route.stops.firstIndex(where: { $0.id == toId }) else { return nil }
        let range = fromIdx <= toIdx ? fromIdx...toIdx : toIdx...fromIdx
        var stops = Array(route.stops[range])
        if fromIdx > toIdx { stops.reverse() }
        return stops
    }

    // MARK: - OSRM Geometry

    /// Fetch OSRM road geometry for a set of waypoints.
    /// Uses 24h UserDefaults cache. Falls back to straight-line waypoints on failure.
    func fetchGeometry(for waypoints: [Waypoint]) async -> [Waypoint] {
        guard waypoints.count >= 2 else { return waypoints }

        let cacheKey = routeCacheKey(for: waypoints)
        if let cached = loadCachedGeometry(key: cacheKey) {
            return cached
        }

        // OSRM has practical limits; sample down to ~25 waypoints
        let sampled = sampleWaypoints(waypoints, maxCount: 25)
        let coords = sampled.map { "\($0.lon),\($0.lat)" }.joined(separator: ";")
        guard let url = URL(string: "https://router.project-osrm.org/route/v1/driving/\(coords)?overview=full&geometries=geojson") else {
            return waypoints
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let routes = json?["routes"] as? [[String: Any]],
                  let first = routes.first,
                  let geometry = first["geometry"] as? [String: Any],
                  let coordinates = geometry["coordinates"] as? [[Double]] else {
                return waypoints
            }

            let result = coordinates.map { Waypoint(lat: $0[1], lon: $0[0]) }
            saveCachedGeometry(key: cacheKey, waypoints: result)
            return result
        } catch {
            return waypoints
        }
    }

    // MARK: - Region Bounds

    func loadRegionBounds() -> RegionBoundsData? {
        if let cached = cachedRegionBounds { return cached }
        guard let url = Bundle.main.url(forResource: "region-bounds", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(RegionBoundsData.self, from: data) else { return nil }
        cachedRegionBounds = decoded
        return decoded
    }

    // MARK: - Private Helpers

    private func routeCacheKey(for waypoints: [Waypoint]) -> String {
        let samples = sampleWaypoints(waypoints, maxCount: 5)
        return samples
            .map { "\(String(format: "%.3f", $0.lat)),\(String(format: "%.3f", $0.lon))" }
            .joined(separator: "_")
    }

    private func sampleWaypoints(_ waypoints: [Waypoint], maxCount: Int) -> [Waypoint] {
        guard waypoints.count > maxCount else { return waypoints }
        let step = Double(waypoints.count - 1) / Double(maxCount - 1)
        return (0..<maxCount).map { i in
            waypoints[min(Int(Double(i) * step), waypoints.count - 1)]
        }
    }

    private func loadCachedGeometry(key: String) -> [Waypoint]? {
        let storageKey = "tripcams_route_geo_\(key)"
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let wrapper = try? JSONDecoder().decode(CachedGeometry.self, from: data),
              Date().timeIntervalSince(wrapper.timestamp) < routeCacheDuration else {
            return nil
        }
        return wrapper.waypoints
    }

    private func saveCachedGeometry(key: String, waypoints: [Waypoint]) {
        let wrapper = CachedGeometry(waypoints: waypoints, timestamp: Date())
        if let data = try? JSONEncoder().encode(wrapper) {
            UserDefaults.standard.set(data, forKey: "tripcams_route_geo_\(key)")
        }
    }
}

private struct CachedGeometry: Codable {
    let waypoints: [Waypoint]
    let timestamp: Date
}
