//
//  CameraListView.swift
//  TripCams
//

import SwiftUI

struct CameraListView: View {
    @EnvironmentObject private var viewModel: TripViewModel

    var body: some View {
        Group {
            if viewModel.cameras.isEmpty && !viewModel.isLoadingCameras {
                emptyState
            } else {
                cameraList
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No Cameras", systemImage: "camera.badge.ellipsis")
        } description: {
            Text("Select a route to see highway cameras along the way.")
        } actions: {
            NavigationLink {
                RouteSelectionView()
                    .navigationTitle("Route")
            } label: {
                Text("Choose a Route")
            }
            .buttonStyle(.borderedProminent)
        }
    }

    // MARK: - Camera List

    private var cameraList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                // Loading / status header
                statusHeader

                // Cluster sections
                ForEach(viewModel.clusters) { cluster in
                    clusterSection(cluster)
                }
            }
        }
        .refreshable {
            await viewModel.refreshCameras()
        }
    }

    // MARK: - Status Header

    private var statusHeader: some View {
        HStack(spacing: 8) {
            if viewModel.isLoadingCameras {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: "camera.fill")
                    .foregroundStyle(.secondary)
            }

            Text(viewModel.loadingProgress)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }

    // MARK: - Cluster Section

    private func clusterSection(_ cluster: CameraCluster) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Cluster header for multi-camera clusters
            if cluster.cameras.count > 1 {
                HStack(spacing: 6) {
                    Image(systemName: "camera.on.rectangle.fill")
                        .font(.caption)
                        .foregroundStyle(.tint)
                    Text(cluster.name)
                        .font(.subheadline.bold())
                    Text("\(cluster.cameras.count) cameras")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.top, 16)
                .padding(.bottom, 6)
            }

            // Camera cards
            ForEach(cluster.cameras) { camera in
                CameraCardView(camera: camera)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        viewModel.selectedCamera = camera
                    }

                if camera.id != cluster.cameras.last?.id {
                    Divider()
                        .padding(.leading, 88)
                }
            }

            Divider()
        }
    }
}

#Preview {
    NavigationStack {
        CameraListView()
            .navigationTitle("Cameras")
    }
    .environmentObject(TripViewModel())
}
