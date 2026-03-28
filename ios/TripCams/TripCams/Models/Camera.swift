//
//  Camera.swift
//  TripCams
//

import Foundation
import CoreLocation

struct Camera: Identifiable, Codable, Equatable {
    let id: String           // region-{apiId} format, e.g. "ab-123"
    let name: String
    let highway: String
    let region: String       // 2-letter code (AB, BC, WA, etc.)
    let lat: Double
    let lon: Double
    let imageUrl: String
    let thumbnailUrl: String?
    let status: CameraStatus
    let direction: String
    let lastUpdated: String?
    let temperature: Double?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    enum CameraStatus: String, Codable {
        case active
        case inactive
    }
}
