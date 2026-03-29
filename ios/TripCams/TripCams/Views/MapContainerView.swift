//
//  MapContainerView.swift
//  TripCams
//

import SwiftUI
import MapKit

struct MapContainerView: View {
    @EnvironmentObject private var viewModel: TripViewModel
    @StateObject private var locationService = LocationService.shared

    @State private var cameraPosition: MapCameraPosition = .automatic
    @State private var selectedCameraId: String?

    var body: some View {
        ZStack(alignment: .trailing) {
            mapContent

            // Position controls in the vertical middle-right area, above the sheet
            VStack {
                Spacer()
                overlayControls
                Spacer()
                    .frame(height: 220)
            }
        }
        .onChange(of: viewModel.routeGeometry) {
            fitMapToRoute()
        }
    }

    // MARK: - Map Content

    private var mapContent: some View {
        Map(position: $cameraPosition, selection: $selectedCameraId) {
            // Route polyline
            if viewModel.routeGeometry.count >= 2 {
                MapPolyline(coordinates: viewModel.routeGeometry.map(\.coordinate))
                    .stroke(Color.tripGreen, lineWidth: 4)
            }

            // Camera markers
            ForEach(viewModel.clusters) { cluster in
                if cluster.cameras.count == 1 {
                    let camera = cluster.primaryCamera
                    Annotation(
                        camera.name,
                        coordinate: camera.coordinate,
                        anchor: .bottom
                    ) {
                        cameraMarker()
                    }
                    .tag(camera.id)
                } else {
                    Annotation(
                        "\(cluster.cameras.count) cameras",
                        coordinate: cluster.coordinate,
                        anchor: .bottom
                    ) {
                        clusterMarker(cluster: cluster)
                    }
                    .tag(cluster.primaryCamera.id)
                }
            }

            UserAnnotation()
        }
        .mapStyle(.standard(elevation: .realistic, pointsOfInterest: .excludingAll))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .onChange(of: selectedCameraId) { _, newValue in
            guard let id = newValue else { return }
            for cluster in viewModel.clusters {
                if let camera = cluster.cameras.first(where: { $0.id == id }) {
                    viewModel.selectedCamera = camera
                    selectedCameraId = nil
                    break
                }
                if cluster.primaryCamera.id == id && cluster.cameras.count > 1 {
                    viewModel.selectedCluster = cluster
                    viewModel.selectedCamera = cluster.primaryCamera
                    selectedCameraId = nil
                    break
                }
            }
        }
    }

    // MARK: - Camera Marker

    private func cameraMarker() -> some View {
        VStack(spacing: 0) {
            ZStack {
                Circle()
                    .fill(.white)
                    .frame(width: 32, height: 32)
                    .shadow(color: .black.opacity(0.2), radius: 2, y: 1)

                Image(systemName: "camera.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.tripGreen)
            }

            Triangle()
                .fill(.white)
                .frame(width: 10, height: 6)
                .shadow(color: .black.opacity(0.15), radius: 1, y: 1)
        }
    }

    // MARK: - Cluster Marker

    private func clusterMarker(cluster: CameraCluster) -> some View {
        VStack(spacing: 0) {
            ZStack {
                Circle()
                    .fill(Color.tripGreen)
                    .frame(width: 36, height: 36)
                    .shadow(color: .black.opacity(0.25), radius: 3, y: 1)

                Text("\(cluster.cameras.count)")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
            }

            Triangle()
                .fill(Color.tripGreen)
                .frame(width: 10, height: 6)
                .shadow(color: .black.opacity(0.15), radius: 1, y: 1)
        }
    }

    // MARK: - Overlay Controls

    private var overlayControls: some View {
        VStack(spacing: 10) {
            Button {
                locationService.requestPermission()
                locationService.startUpdating()
                if let location = locationService.currentLocation {
                    withAnimation {
                        cameraPosition = .region(
                            MKCoordinateRegion(
                                center: location.coordinate,
                                span: MKCoordinateSpan(latitudeDelta: 0.5, longitudeDelta: 0.5)
                            )
                        )
                    }
                }
            } label: {
                Image(systemName: "location.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.primary)
                    .frame(width: 40, height: 40)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .shadow(color: .black.opacity(0.1), radius: 2, y: 1)
            }

            if !viewModel.routeGeometry.isEmpty {
                Button {
                    fitMapToRoute()
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 16))
                        .foregroundStyle(.primary)
                        .frame(width: 40, height: 40)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                        .shadow(color: .black.opacity(0.1), radius: 2, y: 1)
                }
            }
        }
        .padding(.trailing, 12)
    }

    // MARK: - Helpers

    private func fitMapToRoute() {
        let points = viewModel.routeGeometry
        guard !points.isEmpty else { return }

        let lats = points.map(\.lat)
        let lons = points.map(\.lon)

        guard let minLat = lats.min(),
              let maxLat = lats.max(),
              let minLon = lons.min(),
              let maxLon = lons.max() else { return }

        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLon + maxLon) / 2
        )

        let latDelta = (maxLat - minLat) * 1.3
        let lonDelta = (maxLon - minLon) * 1.3

        withAnimation(.easeInOut(duration: 0.5)) {
            cameraPosition = .region(
                MKCoordinateRegion(
                    center: center,
                    span: MKCoordinateSpan(
                        latitudeDelta: max(latDelta, 0.05),
                        longitudeDelta: max(lonDelta, 0.05)
                    )
                )
            )
        }
    }
}

// MARK: - Triangle Shape (for marker pins)

struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

#Preview {
    MapContainerView()
        .environmentObject(TripViewModel())
}
