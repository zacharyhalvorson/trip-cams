//
//  CameraListView.swift
//  TripCams
//

import SwiftUI

struct CameraListView: View {
    @EnvironmentObject private var viewModel: TripViewModel
    var namespace: Namespace.ID?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                if viewModel.cameras.isEmpty && !viewModel.isLoadingCameras {
                    emptyState
                } else if viewModel.isLoadingCameras && viewModel.cameras.isEmpty {
                    // Skeleton loading cards
                    ForEach(0..<3, id: \.self) { _ in
                        skeletonCard
                    }
                } else {
                    ForEach(viewModel.clusters) { cluster in
                        ForEach(cluster.cameras) { camera in
                            // Hide card while its modal is open (matchedGeometryEffect source)
                            if camera.id != viewModel.selectedCamera?.id {
                                CameraCardView(camera: camera)
                                    .applyMatchedGeometry(id: camera.id, namespace: namespace)
                                    .contentShape(Rectangle())
                                    .onTapGesture {
                                        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                                            viewModel.selectedCamera = camera
                                        }
                                    }
                            } else {
                                // Placeholder to maintain scroll position
                                Color.clear
                                    .aspectRatio(16.0 / 9.0, contentMode: .fit)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 20)
        }
        .refreshable {
            await viewModel.refreshCameras()
        }
    }

    // MARK: - Skeleton Card

    private var skeletonCard: some View {
        RoundedRectangle(cornerRadius: 16)
            .fill(Color(.tertiarySystemFill))
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .overlay {
                ShimmerView()
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera")
                .font(.system(size: 36))
                .foregroundStyle(.secondary.opacity(0.5))

            Text("No cameras found")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.secondary)

            Text("Select a route using the picker above to see highway cameras.")
                .font(.system(size: 13))
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 48)
    }
}
