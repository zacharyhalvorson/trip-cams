//
//  CameraCardView.swift
//  TripCams
//

import SwiftUI

struct CameraCardView: View {
    let camera: Camera

    var body: some View {
        HStack(spacing: 12) {
            // Camera thumbnail
            cameraImage
                .frame(width: 72, height: 54)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            // Camera info
            VStack(alignment: .leading, spacing: 4) {
                Text(camera.name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                    .foregroundStyle(.primary)

                HStack(spacing: 6) {
                    // Highway badge
                    if !camera.highway.isEmpty {
                        Label(camera.highway, systemImage: "road.lanes")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    // Direction badge
                    if !camera.direction.isEmpty {
                        Text(camera.direction)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(.blue, in: Capsule())
                    }
                }

                HStack(spacing: 6) {
                    // Region badge
                    Text(camera.region.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.tint)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(.tint.opacity(0.12), in: Capsule())

                    // Temperature
                    if let temp = camera.temperature {
                        Label(
                            String(format: "%.0f\u{00B0}C", temp),
                            systemImage: "thermometer.medium"
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }

                    Spacer()
                }
            }

            Spacer(minLength: 0)

            // Chevron
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.quaternary)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    // MARK: - Camera Image

    @ViewBuilder
    private var cameraImage: some View {
        let urlString = camera.thumbnailUrl ?? camera.imageUrl
        if let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    imagePlaceholder(systemName: "exclamationmark.triangle")
                case .empty:
                    imagePlaceholder(systemName: "camera")
                        .overlay {
                            ProgressView()
                                .controlSize(.small)
                        }
                @unknown default:
                    imagePlaceholder(systemName: "camera")
                }
            }
        } else {
            imagePlaceholder(systemName: "camera.fill")
        }
    }

    private func imagePlaceholder(systemName: String) -> some View {
        Rectangle()
            .fill(.fill.tertiary)
            .overlay {
                Image(systemName: systemName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
    }
}

#Preview {
    VStack(spacing: 0) {
        CameraCardView(camera: Camera(
            id: "ab-123",
            name: "Hwy 2 near Airdrie",
            highway: "Hwy 2",
            region: "ab",
            lat: 51.29,
            lon: -114.01,
            imageUrl: "https://example.com/camera.jpg",
            thumbnailUrl: nil,
            status: .active,
            direction: "NB",
            lastUpdated: "2024-01-15T12:00:00Z",
            temperature: -5.0
        ))
        Divider()
        CameraCardView(camera: Camera(
            id: "bc-456",
            name: "Trans-Canada Hwy at Rogers Pass Summit",
            highway: "Hwy 1",
            region: "bc",
            lat: 51.30,
            lon: -117.52,
            imageUrl: "https://example.com/camera2.jpg",
            thumbnailUrl: nil,
            status: .active,
            direction: "EB",
            lastUpdated: nil,
            temperature: nil
        ))
    }
}
