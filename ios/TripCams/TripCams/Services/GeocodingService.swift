//
//  GeocodingService.swift
//  TripCams
//

import Foundation
import CoreLocation

class GeocodingService {
    static let shared = GeocodingService()

    private var cache: [String: [GeocodedPlace]] = [:]

    // MARK: - Models

    struct GeocodedPlace: Identifiable {
        let id: String
        let name: String
        let region: String   // state or province
        let country: String
        let lat: Double
        let lon: Double

        var coordinate: CLLocationCoordinate2D {
            CLLocationCoordinate2D(latitude: lat, longitude: lon)
        }

        var displayName: String {
            if region.isEmpty { return name }
            return "\(name), \(region)"
        }
    }

    // MARK: - Forward Geocoding

    /// Search for places using Photon/Komoot, filtered to North America.
    func search(query: String, near: CLLocationCoordinate2D? = nil) async -> [GeocodedPlace] {
        let cacheKey = query.lowercased()
        if let cached = cache[cacheKey] { return cached }

        var components = URLComponents(string: "https://photon.komoot.io/api/")!
        var queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: "5"),
            URLQueryItem(name: "lang", value: "en")
        ]
        if let near {
            queryItems.append(URLQueryItem(name: "lat", value: "\(near.latitude)"))
            queryItems.append(URLQueryItem(name: "lon", value: "\(near.longitude)"))
        }
        components.queryItems = queryItems

        guard let url = components.url else { return [] }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let places = parseFeatures(data: data)
            cache[cacheKey] = places
            return places
        } catch {
            return []
        }
    }

    // MARK: - Reverse Geocoding

    /// Reverse geocode a coordinate to find the nearest named place.
    func reverseGeocode(coordinate: CLLocationCoordinate2D) async -> GeocodedPlace? {
        var components = URLComponents(string: "https://photon.komoot.io/reverse")!
        components.queryItems = [
            URLQueryItem(name: "lat", value: "\(coordinate.latitude)"),
            URLQueryItem(name: "lon", value: "\(coordinate.longitude)"),
            URLQueryItem(name: "limit", value: "1"),
            URLQueryItem(name: "lang", value: "en")
        ]

        guard let url = components.url else { return nil }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            return parseFeatures(data: data).first
        } catch {
            return nil
        }
    }

    // MARK: - Parsing

    private func parseFeatures(data: Data) -> [GeocodedPlace] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]] else { return [] }

        return features.compactMap { feature -> GeocodedPlace? in
            guard let properties = feature["properties"] as? [String: Any],
                  let geometry = feature["geometry"] as? [String: Any],
                  let coordinates = geometry["coordinates"] as? [Double],
                  coordinates.count >= 2 else { return nil }

            let lon = coordinates[0]
            let lat = coordinates[1]

            // Filter to North America bounding box
            guard lat >= 24.5, lat <= 72.0, lon >= -170.0, lon <= -50.0 else { return nil }

            let name = properties["name"] as? String
                    ?? properties["city"] as? String
                    ?? "Unknown"
            let state = properties["state"] as? String ?? ""
            let country = properties["country"] as? String ?? ""
            let osmId = properties["osm_id"] as? Int ?? Int.random(in: 0..<Int.max)

            return GeocodedPlace(
                id: "\(osmId)",
                name: name,
                region: state,
                country: country,
                lat: lat,
                lon: lon
            )
        }
    }
}
