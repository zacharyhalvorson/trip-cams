//
//  CameraDetailView.swift
//  TripCams
//

import SwiftUI

struct CameraDetailView: View {
    let camera: Camera

    @Environment(\.dismiss) private var dismiss
    @State private var imageRefreshId = UUID()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    // Large camera image
                    cameraImage

                    // Camera details
                    VStack(alignment: .leading, spacing: 16) {
                        // Name and highway
                        VStack(alignment: .leading, spacing: 6) {
                            Text(camera.name)
                                .font(.title3.bold())

                            if !camera.highway.isEmpty {
                                Label(camera.highway, systemImage: "road.lanes")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Divider()

                        // Info grid
                        infoGrid

                        Divider()

                        // Action buttons
                        actionButtons
                    }
                    .padding()
                }
            }
            .navigationTitle("Camera Detail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }

    // MARK: - Camera Image

    @ViewBuilder
    private var cameraImage: some View {
        if let url = URL(string: camera.imageUrl) {
            AsyncImage(url: url, transaction: Transaction(animation: .easeInOut)) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                case .failure:
                    imageErrorState
                case .empty:
                    imageLoadingState
                @unknown default:
                    imageLoadingState
                }
            }
            .id(imageRefreshId)
            .frame(maxWidth: .infinity)
            .background(Color(.secondarySystemBackground))
        } else {
            imageErrorState
        }
    }

    private var imageLoadingState: some View {
        Rectangle()
            .fill(Color(.secondarySystemBackground))
            .aspectRatio(4.0 / 3.0, contentMode: .fit)
            .overlay {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Loading image...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
    }

    private var imageErrorState: some View {
        Rectangle()
            .fill(Color(.secondarySystemBackground))
            .aspectRatio(4.0 / 3.0, contentMode: .fit)
            .overlay {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text("Image unavailable")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
    }

    // MARK: - Info Grid

    private var infoGrid: some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible())
        ], alignment: .leading, spacing: 14) {
            // Region
            infoItem(
                icon: "globe.americas",
                title: "Region",
                value: camera.region.uppercased()
            )

            // Direction
            if !camera.direction.isEmpty {
                infoItem(
                    icon: "arrow.triangle.turn.up.right.diamond",
                    title: "Direction",
                    value: camera.direction
                )
            }

            // Temperature
            if let temp = camera.temperature {
                infoItem(
                    icon: "thermometer.medium",
                    title: "Temperature",
                    value: String(format: "%.0f\u{00B0}C", temp)
                )
            }

            // Status
            infoItem(
                icon: camera.status == .active ? "checkmark.circle" : "xmark.circle",
                title: "Status",
                value: camera.status == .active ? "Active" : "Inactive"
            )

            // Coordinates
            infoItem(
                icon: "location",
                title: "Coordinates",
                value: String(format: "%.4f, %.4f", camera.lat, camera.lon)
            )

            // Last updated
            if let lastUpdated = camera.lastUpdated, !lastUpdated.isEmpty {
                infoItem(
                    icon: "clock",
                    title: "Last Updated",
                    value: formatTimestamp(lastUpdated)
                )
            }
        }
    }

    private func infoItem(icon: String, title: String, value: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(.tint)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline.weight(.medium))
            }
        }
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        HStack(spacing: 12) {
            // Refresh button
            Button {
                imageRefreshId = UUID()
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(.blue)

            // Share button
            ShareLink(
                item: camera.imageUrl,
                subject: Text(camera.name),
                message: Text("\(camera.name) - \(camera.highway)")
            ) {
                Label("Share", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(.blue)
        }
    }

    // MARK: - Helpers

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoFormatterNoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    private func formatTimestamp(_ timestamp: String) -> String {
        let date = Self.isoFormatter.date(from: timestamp)
            ?? Self.isoFormatterNoFrac.date(from: timestamp)
        guard let date else { return timestamp }
        return Self.relativeFormatter.localizedString(for: date, relativeTo: Date())
    }
}

#Preview {
    CameraDetailView(camera: Camera(
        id: "ab-123",
        name: "Hwy 2 near Airdrie - Southbound",
        highway: "Hwy 2",
        region: "ab",
        lat: 51.2927,
        lon: -114.0143,
        imageUrl: "https://example.com/camera.jpg",
        thumbnailUrl: nil,
        status: .active,
        direction: "SB",
        lastUpdated: "2024-01-15T12:30:00Z",
        temperature: -12.0
    ))
}
