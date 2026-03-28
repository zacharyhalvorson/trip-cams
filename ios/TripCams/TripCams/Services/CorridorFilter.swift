//
//  CorridorFilter.swift
//  TripCams
//

import Foundation
import CoreLocation

enum CorridorFilter {
    static let earthRadiusKm: Double = 6371
    static let defaultClusterThresholdKm: Double = 0.1  // 100 meters

    // MARK: - Distance Calculations

    static func haversineDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) +
                cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) *
                sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return earthRadiusKm * c
    }

    static func pointToPolylineDistance(lat: Double, lon: Double, waypoints: [Waypoint]) -> Double {
        guard waypoints.count >= 2 else {
            guard let wp = waypoints.first else { return .infinity }
            return haversineDistance(lat1: lat, lon1: lon, lat2: wp.lat, lon2: wp.lon)
        }
        var minDist = Double.infinity
        for i in 0..<(waypoints.count - 1) {
            let dist = pointToSegmentDistance(
                lat: lat, lon: lon,
                lat1: waypoints[i].lat, lon1: waypoints[i].lon,
                lat2: waypoints[i + 1].lat, lon2: waypoints[i + 1].lon
            )
            minDist = min(minDist, dist)
            if minDist < 0.1 { return minDist }  // Early exit for very close points
        }
        return minDist
    }

    private static func pointToSegmentDistance(
        lat: Double, lon: Double,
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ) -> Double {
        let A = lat - lat1
        let B = lon - lon1
        let C = lat2 - lat1
        let D = lon2 - lon1
        let dot = A * C + B * D
        let lenSq = C * C + D * D
        var param: Double = -1
        if lenSq != 0 { param = dot / lenSq }

        let nearLat: Double
        let nearLon: Double
        if param < 0 {
            nearLat = lat1; nearLon = lon1
        } else if param > 1 {
            nearLat = lat2; nearLon = lon2
        } else {
            nearLat = lat1 + param * C
            nearLon = lon1 + param * D
        }
        return haversineDistance(lat1: lat, lon1: lon, lat2: nearLat, lon2: nearLon)
    }

    // MARK: - Filtering

    static func filterCameras(_ cameras: [Camera], waypoints: [Waypoint], bufferKm: Double) -> [Camera] {
        let sampled = downsampleWaypoints(waypoints, targetSpacingKm: 0.5)
        return cameras.filter { camera in
            camera.status == .active &&
            pointToPolylineDistance(lat: camera.lat, lon: camera.lon, waypoints: sampled) <= bufferKm
        }
    }

    static func downsampleWaypoints(_ waypoints: [Waypoint], targetSpacingKm: Double) -> [Waypoint] {
        guard waypoints.count > 50 else { return waypoints }
        var totalDist = 0.0
        for i in 0..<(waypoints.count - 1) {
            totalDist += haversineDistance(
                lat1: waypoints[i].lat, lon1: waypoints[i].lon,
                lat2: waypoints[i + 1].lat, lon2: waypoints[i + 1].lon
            )
        }
        let avgSpacing = totalDist / Double(waypoints.count - 1)
        let step = max(1, Int(targetSpacingKm / avgSpacing))
        var result: [Waypoint] = []
        for i in stride(from: 0, to: waypoints.count, by: step) {
            result.append(waypoints[i])
        }
        if let last = waypoints.last, result.last != last {
            result.append(last)
        }
        return result
    }

    // MARK: - Sorting

    static func sortByRoutePosition(_ cameras: [Camera], waypoints: [Waypoint]) -> [Camera] {
        let positions = cameras.map { camera -> (Camera, Double) in
            let pos = routePosition(lat: camera.lat, lon: camera.lon, waypoints: waypoints)
            return (camera, pos)
        }
        return positions.sorted { $0.1 < $1.1 }.map { $0.0 }
    }

    static func routePosition(lat: Double, lon: Double, waypoints: [Waypoint]) -> Double {
        guard waypoints.count >= 2 else { return 0 }
        var bestDist = Double.infinity
        var bestIdx = 0
        for i in 0..<waypoints.count {
            let dist = haversineDistance(lat1: lat, lon1: lon, lat2: waypoints[i].lat, lon2: waypoints[i].lon)
            if dist < bestDist {
                bestDist = dist
                bestIdx = i
            }
        }
        return Double(bestIdx) / Double(waypoints.count - 1)
    }

    // MARK: - Clustering

    static func clusterCameras(_ cameras: [Camera], thresholdKm: Double = defaultClusterThresholdKm) -> [CameraCluster] {
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
        // Flush the last group
        clusters.append(makeCluster(from: currentGroup))

        return clusters
    }

    private static func makeCluster(from cameras: [Camera]) -> CameraCluster {
        let avgLat = cameras.map(\.lat).reduce(0, +) / Double(cameras.count)
        let avgLon = cameras.map(\.lon).reduce(0, +) / Double(cameras.count)
        return CameraCluster(
            id: cameras[0].id,
            cameras: cameras,
            lat: avgLat,
            lon: avgLon
        )
    }

    // MARK: - Region Detection

    static func detectRegions(waypoints: [Waypoint], bounds: RegionBoundsData) -> Set<String> {
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

    // MARK: - Bearing

    static func bearing(from: Waypoint, to: Waypoint) -> Double {
        let lat1 = from.lat * .pi / 180
        let lat2 = to.lat * .pi / 180
        let dLon = (to.lon - from.lon) * .pi / 180
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        return atan2(y, x) * 180 / .pi
    }
}
