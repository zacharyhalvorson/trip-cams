//
//  Route.swift
//  TripCams
//

import Foundation
import CoreLocation

struct RouteData: Codable {
    let routes: [String: Route]
    let corridorBuffer: Double
}

struct Route: Codable, Identifiable {
    var id: String = ""  // set from dictionary key
    let name: String
    let stops: [RouteStop]

    enum CodingKeys: String, CodingKey {
        case name, stops
    }
}

struct RouteStop: Codable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let region: String
    let lat: Double
    let lon: Double

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

struct Waypoint: Equatable, Codable {
    let lat: Double
    let lon: Double

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}
