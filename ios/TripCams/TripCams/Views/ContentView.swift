//
//  ContentView.swift
//  TripCams
//

import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = TripViewModel.shared
    @Namespace private var heroNamespace
    @State private var isSheetExpanded = false

    private let peekHeight: CGFloat = 180

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
                    // Drag handle
                    Capsule()
                        .fill(Color(.systemGray3))
                        .frame(width: 36, height: 4)
                        .padding(.top, 8)
                        .padding(.bottom, 4)
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 8)
                                .onEnded { value in
                                    withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) {
                                        if value.translation.height < -40 {
                                            isSheetExpanded = true
                                        } else if value.translation.height > 40 {
                                            isSheetExpanded = false
                                        }
                                    }
                                }
                        )

                    CameraListView(namespace: heroNamespace)
                }
                .frame(maxWidth: .infinity)
                .frame(height: sheetHeight, alignment: .top)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 12, y: -2)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .offset(y: isSheetExpanded ? 0 : collapsedOffset)
                .animation(.spring(response: 0.5, dampingFraction: 0.85), value: isSheetExpanded)

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
}

#Preview {
    ContentView()
}
