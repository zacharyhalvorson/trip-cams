//
//  TripViewModel.swift
//  TripCams
//

import Foundation
import CoreLocation
import SwiftUI
@MainActor
class TripViewModel: ObservableObject {
    static let shared = TripViewModel()

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

    // Route picker dropdown
    enum DropdownField { case none, from, to }
    @Published var activeDropdown: DropdownField = .none

    // Services
    private let routeService = RouteService.shared
    private let cameraAPI = CameraAPIService.shared
    private let locationService = LocationService.shared

    private var loadGeneration = 0

    init() {
        loadRouteData()
        loadDefaultRoute()
    }

    func loadRouteData() {
        routeService.loadBundledRoutes()
        if let data = routeService.routeData {
            routes = data.routes
            corridorBuffer = data.corridorBuffer
        }
    }

    func selectRoute(routeId: String, from: RouteStop, to: RouteStop) {
        selectedRouteId = routeId
        fromStop = from
        toStop = to

        if let stops = routeService.findStops(routeId: routeId, from: from.id, to: to.id) {
            routeWaypoints = stops.map { Waypoint(lat: $0.lat, lon: $0.lon) }
            Task { await loadCamerasForRoute() }
        }
    }

    func selectCustomRoute(from: Waypoint, to: Waypoint) {
        selectedRouteId = nil
        fromStop = nil
        toStop = nil
        routeWaypoints = [from, to]
        Task { await loadCamerasForRoute() }
    }

    func loadCamerasForRoute() async {
        loadGeneration += 1
        let gen = loadGeneration

        isLoadingCameras = true
        cameras = []
        clusters = []
        loadingProgress = "Fetching route..."

        let geometry = await routeService.fetchGeometry(for: routeWaypoints)
        guard gen == loadGeneration else { return }
        routeGeometry = geometry

        guard let regionBounds = routeService.loadRegionBounds() else {
            isLoadingCameras = false
            loadingProgress = "Could not load region data"
            return
        }

        let neededRegions = CorridorFilter.detectRegions(waypoints: geometry, bounds: regionBounds)
        guard !neededRegions.isEmpty, gen == loadGeneration else {
            isLoadingCameras = false
            loadingProgress = "No regions found along route"
            return
        }

        let bufferKm: Double
        if geometry.count > 50 {
            bufferKm = 1.0
        } else if routeWaypoints.count == 2 {
            bufferKm = 5.0
        } else {
            bufferKm = corridorBuffer
        }

        loadingProgress = "Loading cameras..."

        // Fetch all regions in parallel via CameraAPIService
        var allFiltered: [Camera] = []
        await cameraAPI.fetchCameras(regions: Array(neededRegions)) { [geometry] _, regionCameras in
            let filtered = CorridorFilter.filterCameras(regionCameras, waypoints: geometry, bufferKm: bufferKm)
            allFiltered.append(contentsOf: filtered)
        }

        guard gen == loadGeneration else { return }

        // Sort and cluster once after all regions are fetched
        cameras = CorridorFilter.sortByRoutePosition(allFiltered, waypoints: geometry)
        clusters = CorridorFilter.clusterCameras(cameras)

        isLoadingCameras = false
        if cameras.isEmpty {
            loadingProgress = "No cameras found along route"
        } else {
            loadingProgress = "\(cameras.count) cameras along route"
        }
    }

    func refreshCameras() async {
        guard !routeWaypoints.isEmpty else { return }
        await loadCamerasForRoute()
    }

    // MARK: - Default Route

    private func loadDefaultRoute() {
        guard let route = routes["northern"] else { return }
        let from = route.stops.first(where: { $0.id == "vancouver" }) ?? route.stops.first
        let to = route.stops.first(where: { $0.id == "calgary" }) ?? route.stops.last
        guard let from, let to else { return }
        selectRoute(routeId: "northern", from: from, to: to)
    }

    // MARK: - Route Picker

    func swapFromTo() {
        let oldFrom = fromStop
        fromStop = toStop
        toStop = oldFrom
        guard fromStop != nil, toStop != nil else { return }
        if let routeId = selectedRouteId {
            selectRoute(routeId: routeId, from: fromStop!, to: toStop!)
        } else {
            routeWaypoints = [
                Waypoint(lat: fromStop!.lat, lon: fromStop!.lon),
                Waypoint(lat: toStop!.lat, lon: toStop!.lon)
            ]
            Task { await loadCamerasForRoute() }
        }
    }

    var allStops: [RouteStop] {
        var seen = Set<String>()
        var result: [RouteStop] = []
        for route in routes.values.sorted(by: { $0.name < $1.name }) {
            for stop in route.stops {
                if seen.insert(stop.id).inserted {
                    result.append(stop)
                }
            }
        }
        return result
    }
}
