//
//  CarPlayMapViewController.swift
//  TripCams
//

import MapKit
import UIKit

@MainActor
class CarPlayMapViewController: UIViewController, MKMapViewDelegate {
    private let mapView = MKMapView()
    private var routeOverlay: MKPolyline?
    private static var markerImageCache: [String: UIImage] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        mapView.frame = view.bounds
        mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        mapView.delegate = self
        mapView.showsUserLocation = true
        mapView.pointOfInterestFilter = .excludingAll
        view.addSubview(mapView)
    }

    // MARK: - Route

    func updateRoute(geometry: [Waypoint]) {
        if let old = routeOverlay {
            mapView.removeOverlay(old)
        }
        guard geometry.count >= 2 else { return }

        let coords = geometry.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
        let polyline = MKPolyline(coordinates: coords, count: coords.count)
        routeOverlay = polyline
        mapView.addOverlay(polyline, level: .aboveRoads)
    }

    // MARK: - Camera Markers

    func updateMarkers(clusters: [CameraCluster]) {
        let existing = mapView.annotations.filter { $0 is CarPlayCameraAnnotation }
        mapView.removeAnnotations(existing)

        for cluster in clusters {
            let annotation = CarPlayCameraAnnotation(cluster: cluster)
            mapView.addAnnotation(annotation)
        }
    }

    // MARK: - Map Navigation

    func fitToRoute(geometry: [Waypoint], animated: Bool = true) {
        guard let region = geometry.boundingRegion() else { return }
        mapView.setRegion(region, animated: animated)
    }

    func zoomTo(coordinate: CLLocationCoordinate2D, spanDelta: Double) {
        mapView.setRegion(
            MKCoordinateRegion(
                center: coordinate,
                span: MKCoordinateSpan(latitudeDelta: spanDelta, longitudeDelta: spanDelta)
            ),
            animated: true
        )
    }

    // MARK: - MKMapViewDelegate

    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        if let polyline = overlay as? MKPolyline {
            let renderer = MKPolylineRenderer(polyline: polyline)
            renderer.strokeColor = .tripGreen
            renderer.lineWidth = 4
            return renderer
        }
        return MKOverlayRenderer(overlay: overlay)
    }

    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        guard let cameraAnnotation = annotation as? CarPlayCameraAnnotation else { return nil }

        let id = "CameraMarker"
        let view = mapView.dequeueReusableAnnotationView(withIdentifier: id) ?? MKAnnotationView(annotation: annotation, reuseIdentifier: id)
        view.annotation = annotation

        let count = cameraAnnotation.cluster.cameras.count
        let size: CGFloat = count > 1 ? 32 : 28
        view.image = Self.cachedMarkerImage(count: count, size: size)
        view.centerOffset = CGPoint(x: 0, y: -size / 2)
        view.canShowCallout = false

        return view
    }

    // MARK: - Marker Rendering

    private static func cachedMarkerImage(count: Int, size: CGFloat) -> UIImage {
        let key = "\(count)-\(Int(size))"
        if let cached = markerImageCache[key] { return cached }
        let image = renderMarkerImage(count: count, size: size)
        markerImageCache[key] = image
        return image
    }

    private static func renderMarkerImage(count: Int, size: CGFloat) -> UIImage {
        let totalHeight = size + 6
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: totalHeight))
        return renderer.image { ctx in
            let fillColor: UIColor = count > 1 ? .tripGreen : .white
            let iconColor: UIColor = count > 1 ? .white : .tripGreen

            let circleRect = CGRect(x: 0, y: 0, width: size, height: size)

            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1), blur: 2, color: UIColor.black.withAlphaComponent(0.25).cgColor)
            fillColor.setFill()
            ctx.cgContext.fillEllipse(in: circleRect)
            ctx.cgContext.setShadow(offset: .zero, blur: 0)

            let triPath = UIBezierPath()
            triPath.move(to: CGPoint(x: size / 2 - 5, y: size - 2))
            triPath.addLine(to: CGPoint(x: size / 2, y: totalHeight))
            triPath.addLine(to: CGPoint(x: size / 2 + 5, y: size - 2))
            triPath.close()
            fillColor.setFill()
            triPath.fill()

            if count > 1 {
                let text = "\(count)" as NSString
                let font = UIFont.boldSystemFont(ofSize: size * 0.4)
                let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: iconColor]
                let textSize = text.size(withAttributes: attrs)
                text.draw(at: CGPoint(x: (size - textSize.width) / 2, y: (size - textSize.height) / 2), withAttributes: attrs)
            } else {
                let config = UIImage.SymbolConfiguration(pointSize: size * 0.38, weight: .medium)
                if let symbol = UIImage(systemName: "camera.fill", withConfiguration: config) {
                    let symbolSize = symbol.size
                    let tinted = symbol.withTintColor(iconColor, renderingMode: .alwaysOriginal)
                    tinted.draw(at: CGPoint(x: (size - symbolSize.width) / 2, y: (size - symbolSize.height) / 2))
                }
            }
        }
    }
}

// MARK: - Annotation

class CarPlayCameraAnnotation: NSObject, MKAnnotation {
    let cluster: CameraCluster

    init(cluster: CameraCluster) {
        self.cluster = cluster
        super.init()
    }

    var coordinate: CLLocationCoordinate2D { cluster.coordinate }
    var title: String? { cluster.name }
    var subtitle: String? { cluster.summary }
}

// MARK: - Waypoint Bounding Region

extension Array where Element == Waypoint {
    func boundingRegion(padding: Double = 1.3) -> MKCoordinateRegion? {
        guard !isEmpty else { return nil }
        var minLat = self[0].lat, maxLat = self[0].lat
        var minLon = self[0].lon, maxLon = self[0].lon
        for wp in self.dropFirst() {
            if wp.lat < minLat { minLat = wp.lat }
            if wp.lat > maxLat { maxLat = wp.lat }
            if wp.lon < minLon { minLon = wp.lon }
            if wp.lon > maxLon { maxLon = wp.lon }
        }
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
            span: MKCoordinateSpan(
                latitudeDelta: max((maxLat - minLat) * padding, 0.05),
                longitudeDelta: max((maxLon - minLon) * padding, 0.05)
            )
        )
    }
}
