//
//  Region.swift
//  TripCams
//

import Foundation

struct RegionBounds: Codable {
    let name: String
    let lat: [Double]  // [min, max]
    let lon: [Double]  // [min, max]

    func contains(latitude: Double, longitude: Double) -> Bool {
        latitude >= lat[0] && latitude <= lat[1] &&
        longitude >= lon[0] && longitude <= lon[1]
    }
}

typealias RegionBoundsData = [String: [String: RegionBounds]]  // country -> region -> bounds
