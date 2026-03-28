//
//  TripViewModel.swift
//  TripCams
//

import Foundation
import CoreLocation
import SwiftUI

@MainActor
class TripViewModel: ObservableObject {
    // Route state
    @Published var routes: [String: Route] = [:]
    @Published var corridorBuffer: Double = 25
    @Published var selectedRouteId: String?
    @Published var fromStop: RouteStop?
    @Published var toStop: RouteStop?

    // Camera state
    @Published var cameras: [Camera] = []
    @Published var clusters: [CameraCluster] = []
    @Published var isLoadingCameras: Bool = false
    @Published var loadingProgress: String = ""

    // Route geometry
    @Published var routeWaypoints: [Waypoint] = []
    @Published var routeGeometry: [Waypoint] = []  // OSRM geometry

    // Selection
    @Published var selectedCamera: Camera?
    @Published var selectedCluster: CameraCluster?

    // Services
    private let routeService = RouteService.shared
    private let cameraAPI = CameraAPIService.shared
    private let locationService = LocationService.shared

    private var loadGeneration = 0

    init() {
        loadRouteData()
    }

    func loadRouteData() {
        routeService.loadBundledRoutes()
        if let data = routeService.routeData {
            routes = data.routes
            corridorBuffer = data.corridorBuffer
        }
    }

    /// Select a predefined route segment between two stops
    func selectRoute(routeId: String, from: RouteStop, to: RouteStop) {
        selectedRouteId = routeId
        fromStop = from
        toStop = to

        if let stops = routeService.findStops(routeId: routeId, from: from.id, to: to.id) {
            routeWaypoints = stops.map { Waypoint(lat: $0.lat, lon: $0.lon) }
            Task { await loadCamerasForRoute() }
        }
    }

    /// Select a custom origin/destination pair
    func selectCustomRoute(from: Waypoint, to: Waypoint) {
        selectedRouteId = nil
        fromStop = nil
        toStop = nil
        routeWaypoints = [from, to]
        Task { await loadCamerasForRoute() }
    }

    /// Main camera loading pipeline: geometry -> regions -> fetch -> filter -> cluster
    func loadCamerasForRoute() async {
        loadGeneration += 1
        let gen = loadGeneration

        isLoadingCameras = true
        cameras = []
        clusters = []
        loadingProgress = "Fetching route..."

        // Get OSRM geometry
        let geometry = await routeService.fetchGeometry(for: routeWaypoints)
        guard gen == loadGeneration else { return }
        routeGeometry = geometry

        // Determine needed regions
        guard let regionBounds = routeService.loadRegionBounds() else {
            isLoadingCameras = false
            loadingProgress = "Could not load region data"
            return
        }

        let neededRegions = detectRegions(waypoints: geometry, bounds: regionBounds)
        guard !neededRegions.isEmpty, gen == loadGeneration else {
            isLoadingCameras = false
            loadingProgress = "No regions found along route"
            return
        }

        // Determine buffer distance based on geometry precision
        let bufferKm: Double
        if geometry.count > 50 {
            bufferKm = 1.0  // OSRM precision
        } else if routeWaypoints.count == 2 {
            bufferKm = 5.0  // straight line
        } else {
            bufferKm = corridorBuffer  // predefined waypoints
        }

        loadingProgress = "Loading cameras from \(neededRegions.count) region\(neededRegions.count == 1 ? "" : "s")..."

        // Fetch cameras from each region
        for region in neededRegions.sorted() {
            guard gen == loadGeneration else { return }
            loadingProgress = "Loading \(region.uppercased())..."

            let regionCameras = await fetchCamerasForRegion(region)
            guard gen == loadGeneration else { return }

            // Filter cameras to the route corridor
            let filtered = filterCameras(regionCameras, waypoints: geometry, bufferKm: bufferKm)
            guard !filtered.isEmpty else { continue }

            cameras.append(contentsOf: filtered)
            // Re-sort by route position and re-cluster
            cameras = sortByRoutePosition(cameras, waypoints: geometry)
            clusters = clusterCameras(cameras)
            loadingProgress = "\(cameras.count) cameras found"
        }

        if gen == loadGeneration {
            isLoadingCameras = false
            if cameras.isEmpty {
                loadingProgress = "No cameras found along route"
            } else {
                loadingProgress = "\(cameras.count) cameras along route"
            }
        }
    }

    /// Refresh cameras for the current route
    func refreshCameras() async {
        guard !routeWaypoints.isEmpty else { return }
        await loadCamerasForRoute()
    }

    // MARK: - Region Detection

    private func detectRegions(waypoints: [Waypoint], bounds: RegionBoundsData) -> Set<String> {
        var regions = Set<String>()
        let step = max(1, waypoints.count / 50)
        for i in stride(from: 0, to: waypoints.count, by: step) {
            let wp = waypoints[i]
            for (_, regionMap) in bounds {
                for (code, bound) in regionMap {
                    if bound.contains(latitude: wp.lat, longitude: wp.lon) {
                        regions.insert(code)
                    }
                }
            }
        }
        // Always check last point
        if let last = waypoints.last {
            for (_, regionMap) in bounds {
                for (code, bound) in regionMap {
                    if bound.contains(latitude: last.lat, longitude: last.lon) {
                        regions.insert(code)
                    }
                }
            }
        }
        return regions
    }

    // MARK: - Camera Fetching

    private func fetchCamerasForRegion(_ region: String) async -> [Camera] {
        var result: [Camera] = []
        await cameraAPI.fetchCameras(regions: [region]) { _, cameras in
            result.append(contentsOf: cameras)
        }
        return result
    }

    // MARK: - Corridor Filtering

    private func filterCameras(_ cameras: [Camera], waypoints: [Waypoint], bufferKm: Double) -> [Camera] {
        cameras.filter { camera in
            for wp in waypoints {
                let dist = haversineDistance(
                    lat1: camera.lat, lon1: camera.lon,
                    lat2: wp.lat, lon2: wp.lon
                )
                if dist <= bufferKm {
                    return true
                }
            }
            return false
        }
    }

    private func sortByRoutePosition(_ cameras: [Camera], waypoints: [Waypoint]) -> [Camera] {
        cameras.sorted { a, b in
            nearestIndex(for: a, in: waypoints) < nearestIndex(for: b, in: waypoints)
        }
    }

    private func nearestIndex(for camera: Camera, in waypoints: [Waypoint]) -> Int {
        var bestIdx = 0
        var bestDist = Double.greatestFiniteMagnitude
        let step = max(1, waypoints.count / 100)
        for i in stride(from: 0, to: waypoints.count, by: step) {
            let d = haversineDistance(
                lat1: camera.lat, lon1: camera.lon,
                lat2: waypoints[i].lat, lon2: waypoints[i].lon
            )
            if d < bestDist {
                bestDist = d
                bestIdx = i
            }
        }
        return bestIdx
    }

    // MARK: - Clustering

    private func clusterCameras(_ cameras: [Camera], thresholdKm: Double = 0.5) -> [CameraCluster] {
        guard !cameras.isEmpty else { return [] }
        var clusters: [CameraCluster] = []
        var currentGroup: [Camera] = [cameras[0]]

        for i in 1..<cameras.count {
            let prev = cameras[i - 1]
            let curr = cameras[i]
            let dist = haversineDistance(lat1: prev.lat, lon1: prev.lon, lat2: curr.lat, lon2: curr.lon)

            if dist <= thresholdKm {
                currentGroup.append(curr)
            } else {
                clusters.append(makeCluster(from: currentGroup))
                currentGroup = [curr]
            }
        }
        if !currentGroup.isEmpty {
            clusters.append(makeCluster(from: currentGroup))
        }
        return clusters
    }

    private func makeCluster(from cameras: [Camera]) -> CameraCluster {
        let avgLat = cameras.map(\.lat).reduce(0, +) / Double(cameras.count)
        let avgLon = cameras.map(\.lon).reduce(0, +) / Double(cameras.count)
        return CameraCluster(
            id: cameras.map(\.id).joined(separator: "+"),
            cameras: cameras,
            lat: avgLat,
            lon: avgLon
        )
    }

    // MARK: - Haversine

    private func haversineDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let R = 6371.0 // Earth radius in km
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) +
                cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) *
                sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return R * c
    }
}
