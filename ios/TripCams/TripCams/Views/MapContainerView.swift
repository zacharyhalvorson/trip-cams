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

            // Position controls above the bottom sheet peek area
            VStack {
                Spacer()
                overlayControls
            }
            .padding(.bottom, 192)
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
                        anchor: .center
                    ) {
                        cameraMarker()
                    }
                    .tag(camera.id)
                } else {
                    Annotation(
                        "\(cluster.cameras.count) cameras",
                        coordinate: cluster.coordinate,
                        anchor: .center
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
        Circle()
            .fill(Color.tripGreen)
            .frame(width: 10, height: 10)
            .overlay(
                Circle()
                    .stroke(.white, lineWidth: 2)
            )
            .shadow(color: .black.opacity(0.2), radius: 1, y: 1)
    }

    // MARK: - Cluster Marker

    private func clusterMarker(cluster: CameraCluster) -> some View {
        Circle()
            .fill(Color.tripGreen)
            .frame(width: 10, height: 10)
            .overlay(
                Circle()
                    .stroke(.white, lineWidth: 2)
            )
            .shadow(color: .black.opacity(0.2), radius: 1, y: 1)
    }

    // MARK: - Overlay Controls

    private var overlayControls: some View {
        VStack(spacing: 4) {
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
                    .foregroundStyle(.black)
                    .frame(width: 40, height: 40)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .shadow(color: .black.opacity(0.1), radius: 2, y: 1)
            }

            if !viewModel.routeGeometry.isEmpty {
                Button {
                    fitMapToRoute()
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 16))
                        .foregroundStyle(.black)
                        .frame(width: 40, height: 40)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                        .shadow(color: .black.opacity(0.1), radius: 2, y: 1)
                }
            }
        }
        .padding(.trailing, 12)
    }

    // MARK: - Helpers

    private func fitMapToRoute() {
        guard let region = viewModel.routeGeometry.boundingRegion() else { return }
        withAnimation(.easeInOut(duration: 0.5)) {
            cameraPosition = .region(region)
        }
    }
}

#Preview {
    MapContainerView()
        .environmentObject(TripViewModel())
}
