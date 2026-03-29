//
//  CameraCardView.swift
//  TripCams
//

import SwiftUI

struct CameraCardView: View {
    let camera: Camera
    var showOverlay = true

    var body: some View {
        if camera.status == .inactive || camera.imageUrl.isEmpty {
            disabledCard
        } else {
            imageCard
        }
    }

    // MARK: - Image Card

    private var imageCard: some View {
        ZStack(alignment: .bottom) {
            CameraImageView(urlString: camera.thumbnailUrl ?? camera.imageUrl)
                .frame(maxWidth: .infinity)
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .clipped()

            if showOverlay {
                // Gradient + info only after layout
                LinearGradient(
                    colors: [.black.opacity(0.75), .clear],
                    startPoint: .bottom,
                    endPoint: .top
                )
                .frame(height: 70)
                .allowsHitTesting(false)

                HStack(alignment: .bottom, spacing: 8) {
                    Text(camera.region.uppercased())
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.regionBadge(camera.region).opacity(0.85), in: Capsule())

                    Text(camera.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .shadow(color: .black.opacity(0.5), radius: 2, y: 1)

                    Spacer(minLength: 0)

                    if let temp = camera.temperature {
                        Text(String(format: "%.0f\u{00B0}", temp))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 8)
                .allowsHitTesting(false)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color(.separator).opacity(0.15), lineWidth: 1)
        )
    }

    // MARK: - Disabled Card

    private var disabledCard: some View {
        HStack(spacing: 8) {
            Text(camera.region.uppercased())
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.regionBadge(camera.region).opacity(0.5), in: Capsule())

            Text(camera.name)
                .font(.system(size: 12, weight: .medium))
                .lineLimit(1)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            if camera.status == .inactive {
                Text("Offline")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        .opacity(0.55)
    }
}

// MARK: - Matched Geometry Helper

extension View {
    @ViewBuilder
    func applyMatchedGeometry(id: String, namespace: Namespace.ID?) -> some View {
        if let namespace {
            self.matchedGeometryEffect(id: id, in: namespace)
        } else {
            self
        }
    }
}
