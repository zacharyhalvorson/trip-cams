//
//  CameraDetailView.swift
//  TripCams
//

import SwiftUI

struct CameraDetailView: View {
    let camera: Camera
    let namespace: Namespace.ID
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            // Dark blurred backdrop — tap to dismiss
            Color.black.opacity(0.65)
                .background(.ultraThinMaterial.opacity(0.3))
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)

            // Modal card — animates from card position via matchedGeometryEffect
            VStack(spacing: 0) {
                ZStack(alignment: .top) {
                    CameraImageView(urlString: camera.imageUrl)
                        .frame(maxWidth: .infinity)
                        .aspectRatio(16.0 / 9.0, contentMode: .fit)

                    headerOverlay
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: .black.opacity(0.4), radius: 20, y: 8)
            .padding(.horizontal, 16)
            .matchedGeometryEffect(id: camera.id, in: namespace)
        }
    }

    // MARK: - Header Overlay

    private var headerOverlay: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(camera.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .shadow(color: .black.opacity(0.6), radius: 3, y: 1)

                if !camera.highway.isEmpty {
                    Text(camera.highway)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.8))
                        .shadow(color: .black.opacity(0.4), radius: 2, y: 1)
                }
            }

            Spacer()

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(.black.opacity(0.45), in: Circle())
            }
        }
        .padding(12)
        .background(
            LinearGradient(
                colors: [.black.opacity(0.6), .clear],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}
