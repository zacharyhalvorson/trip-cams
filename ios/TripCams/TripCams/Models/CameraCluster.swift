//
//  CameraCluster.swift
//  TripCams
//

import Foundation
import CoreLocation

struct CameraCluster: Identifiable {
    let id: String
    let cameras: [Camera]
    let lat: Double
    let lon: Double

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    var primaryCamera: Camera {
        cameras[0]
    }

    var name: String {
        primaryCamera.name
    }
}
