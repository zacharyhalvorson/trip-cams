//
//  CameraImageView.swift
//  TripCams
//

import SwiftUI

// MARK: - Image View using AsyncImage with URLRequest

struct CameraImageView: View {
    let urlString: String

    var body: some View {
        let cleaned = cleanUrl(urlString)
        if let url = URL(string: cleaned), !cleaned.isEmpty {
            AsyncImage(url: url, transaction: Transaction(animation: .easeIn(duration: 0.2))) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    Color(.tertiarySystemFill)
                        .overlay {
                            Image(systemName: "photo")
                                .font(.title3)
                                .foregroundStyle(.secondary.opacity(0.5))
                        }
                case .empty:
                    ShimmerView()
                @unknown default:
                    ShimmerView()
                }
            }
        } else {
            Color(.tertiarySystemFill)
        }
    }

    private func cleanUrl(_ urlString: String) -> String {
        var url = urlString
        if url.contains("corsproxy.io/?") {
            url = url.components(separatedBy: "corsproxy.io/?").last ?? url
        }
        if url.contains("%3A") || url.contains("%2F") {
            url = url.removingPercentEncoding ?? url
        }
        return url
    }
}

// MARK: - Shimmer Animation

struct ShimmerView: View {
    @State private var phase: CGFloat = -1

    var body: some View {
        GeometryReader { geo in
            Color(.tertiarySystemFill)
                .overlay {
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [.clear, .white.opacity(0.12), .clear],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .offset(x: phase * geo.size.width)
                }
                .clipped()
        }
        .onAppear {
            withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                phase = 1
            }
        }
    }
}
