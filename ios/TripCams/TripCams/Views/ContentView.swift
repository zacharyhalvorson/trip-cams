//
//  ContentView.swift
//  TripCams
//

import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = TripViewModel.shared
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                MapContainerView()
                    .navigationTitle("Trip Cams")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem {
                Label("Map", systemImage: "map")
            }
            .tag(0)

            NavigationStack {
                CameraListView()
                    .navigationTitle("Cameras")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem {
                Label("Cameras", systemImage: "camera")
            }
            .tag(1)

            NavigationStack {
                RouteSelectionView()
                    .navigationTitle("Route")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem {
                Label("Route", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
            }
            .tag(2)
        }
        .environmentObject(viewModel)
        .sheet(item: $viewModel.selectedCamera) { camera in
            CameraDetailView(camera: camera)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }
}

#Preview {
    ContentView()
}
