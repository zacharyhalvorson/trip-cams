//
//  ContentView.swift
//  TripCams

import SwiftUI
import CoreLocation

struct ContentView: View {
    @StateObject private var viewModel = TripViewModel.shared
    @Namespace private var heroNamespace
    @State private var isSheetExpanded = false
    @State private var scrollOffset: CGFloat = 0
    @State private var baseScrollOffset: CGFloat?
    @State private var isRefreshing = false
    @State private var pullOffset: CGFloat = 0
    @State private var scrollToCameraId: String?

    private let peekHeight: CGFloat = 180
    private let collapseThreshold: CGFloat = 60
    private let expandThreshold: CGFloat = 40
    private let refreshTrigger: CGFloat = 48

    var body: some View {
        GeometryReader { geo in
            let sheetHeight = geo.size.height * 0.82
            let collapsedOffset = sheetHeight - peekHeight

            ZStack {
                // Layer 1: Full-screen map
                MapContainerView()
                    .ignoresSafeArea()

                // Layer 2: Route picker overlay at top
                VStack {
                    RoutePickerOverlay()
                    Spacer()
                }

                // Layer 3: Custom bottom sheet panel
                VStack(spacing: 0) {
                    dragHandle

                    // Pull-to-refresh indicator (collapsed state)
                    if !isSheetExpanded && (pullOffset > 0 || isRefreshing) {
                        pullToRefreshIndicator
                    }

                    ZStack {
                        CameraListView(
                            namespace: heroNamespace,
                            scrollOffset: $scrollOffset,
                            scrollToCameraId: $scrollToCameraId,
                            isSheetExpanded: isSheetExpanded
                        )

                        // Gesture overlay when collapsed — captures drags on the list area
                        if !isSheetExpanded {
                            Color.clear
                                .contentShape(Rectangle())
                                .gesture(collapsedContentGesture)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: sheetHeight, alignment: .top)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 12, y: -2)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .offset(y: isSheetExpanded ? 0 : collapsedOffset)
                .animation(.spring(response: 0.5, dampingFraction: 0.85), value: isSheetExpanded)
                .onChange(of: scrollOffset) { _, newOffset in
                    handleScrollOffsetChange(newOffset)
                }
                .onChange(of: isSheetExpanded) { _, expanded in
                    if expanded {
                        // Reset base offset so collapse detection recalibrates
                        baseScrollOffset = nil
                    }
                }

                // Layer 4: Camera detail modal overlay
                if let camera = viewModel.selectedCamera {
                    CameraDetailView(
                        camera: camera,
                        namespace: heroNamespace,
                        onDismiss: {
                            withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                                viewModel.selectedCamera = nil
                            }
                        }
                    )
                    .zIndex(10)
                    .transition(.opacity)
                }
            }
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: viewModel.selectedCamera?.id)
        }
        .ignoresSafeArea()
        .environmentObject(viewModel)
    }

    // MARK: - Drag Handle

    private var dragHandle: some View {
        Capsule()
            .fill(Color(.systemGray3))
            .frame(width: 36, height: 4)
            .padding(.top, 8)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .onTapGesture(count: 2) {
                handleDoubleTap()
            }
            .gesture(
                DragGesture(minimumDistance: 8)
                    .onEnded { value in
                        withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) {
                            if value.translation.height < -expandThreshold {
                                isSheetExpanded = true
                            } else if value.translation.height > expandThreshold {
                                isSheetExpanded = false
                            }
                        }
                    }
            )
    }

    // MARK: - Collapsed Content Gesture

    private var collapsedContentGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                if value.translation.height > 0 {
                    // Pulling down — build pull-to-refresh
                    pullOffset = min(value.translation.height, 80)
                }
            }
            .onEnded { value in
                if value.translation.height < -expandThreshold {
                    // Drag up → expand sheet
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) {
                        isSheetExpanded = true
                    }
                } else if pullOffset > refreshTrigger {
                    // Pulled past threshold → refresh
                    triggerRefresh()
                }
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    pullOffset = 0
                }
            }
    }

    // MARK: - Pull-to-Refresh Indicator

    private var pullToRefreshIndicator: some View {
        HStack(spacing: 6) {
            if isRefreshing {
                ProgressView()
                    .scaleEffect(0.8)
            } else {
                let triggered = pullOffset > refreshTrigger
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .rotationEffect(.degrees(triggered ? 360 : Double(pullOffset / refreshTrigger) * 270))
                    .animation(.easeOut(duration: 0.15), value: triggered)
            }
        }
        .frame(height: isRefreshing ? 32 : min(32, max(0, pullOffset * 0.4)))
        .frame(maxWidth: .infinity)
        .clipped()
    }

    // MARK: - Scroll Offset → Collapse Detection

    private func handleScrollOffsetChange(_ newOffset: CGFloat) {
        guard isSheetExpanded else { return }

        if baseScrollOffset == nil {
            baseScrollOffset = newOffset
        }

        guard let base = baseScrollOffset else { return }
        let pull = newOffset - base

        // User has pulled down past threshold while expanded at the top
        if pull > collapseThreshold {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) {
                isSheetExpanded = false
            }
        }
    }

    // MARK: - Double-Tap on Handle

    private func handleDoubleTap() {
        // Expand if collapsed
        if !isSheetExpanded {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) {
                isSheetExpanded = true
            }
        }

        // Scroll to nearest camera to user location, or top
        if let userLocation = LocationService.shared.currentLocation,
           let nearest = findNearestCamera(to: userLocation) {
            scrollToCameraId = nearest.id
        } else {
            scrollToCameraId = "top"
        }
    }

    private func findNearestCamera(to location: CLLocation) -> Camera? {
        guard !viewModel.cameras.isEmpty else { return nil }
        return viewModel.cameras.min { cam1, cam2 in
            let d1 = location.distance(from: CLLocation(latitude: cam1.lat, longitude: cam1.lon))
            let d2 = location.distance(from: CLLocation(latitude: cam2.lat, longitude: cam2.lon))
            return d1 < d2
        }
    }

    // MARK: - Refresh

    private func triggerRefresh() {
        guard !isRefreshing else { return }
        isRefreshing = true
        Task {
            await viewModel.refreshCameras()
            try? await Task.sleep(for: .milliseconds(400))
            isRefreshing = false
        }
    }
}

#Preview {
    ContentView()
}
