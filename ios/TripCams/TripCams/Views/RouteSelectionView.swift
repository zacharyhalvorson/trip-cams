//
//  RouteSelectionView.swift
//  TripCams
//

import SwiftUI

struct RouteSelectionView: View {
    @EnvironmentObject private var viewModel: TripViewModel

    // Predefined route selection
    @State private var expandedRouteId: String?
    @State private var selectedFrom: RouteStop?
    @State private var selectedTo: RouteStop?

    // Custom route
    @State private var originQuery: String = ""
    @State private var destinationQuery: String = ""
    @State private var originResults: [GeocodingResult] = []
    @State private var destinationResults: [GeocodingResult] = []
    @State private var selectedOrigin: GeocodingResult?
    @State private var selectedDestination: GeocodingResult?
    @State private var isSearchingOrigin = false
    @State private var isSearchingDestination = false

    var body: some View {
        List {
            // Current route summary
            if viewModel.selectedRouteId != nil || !viewModel.routeWaypoints.isEmpty {
                currentRouteSection
            }

            // Predefined routes
            predefinedRoutesSection

            // Custom route
            customRouteSection
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Current Route Summary

    private var currentRouteSection: some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: "road.lanes")
                    .font(.title2)
                    .foregroundStyle(.tint)
                    .frame(width: 36)

                VStack(alignment: .leading, spacing: 4) {
                    if let routeId = viewModel.selectedRouteId,
                       let route = viewModel.routes[routeId] {
                        Text(route.name)
                            .font(.headline)
                    } else {
                        Text("Custom Route")
                            .font(.headline)
                    }

                    if let from = viewModel.fromStop, let to = viewModel.toStop {
                        Text("\(from.name) \u{2192} \(to.name)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    Text(viewModel.loadingProgress)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if viewModel.isLoadingCameras {
                    ProgressView()
                } else if !viewModel.cameras.isEmpty {
                    Text("\(viewModel.cameras.count)")
                        .font(.title3.bold())
                        .foregroundStyle(.tint)
                }
            }
            .padding(.vertical, 4)
        } header: {
            Text("Current Route")
        }
    }

    // MARK: - Predefined Routes

    private var predefinedRoutesSection: some View {
        Section {
            let sortedRoutes = viewModel.routes.sorted(by: { $0.key < $1.key })
            ForEach(sortedRoutes, id: \.key) { key, route in
                predefinedRouteCard(routeId: key, route: route)
            }
        } header: {
            Text("Predefined Routes")
        } footer: {
            Text("Select a route and choose origin/destination stops.")
        }
    }

    private func predefinedRouteCard(routeId: String, route: Route) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Route header
            Button {
                withAnimation(.snappy) {
                    if expandedRouteId == routeId {
                        expandedRouteId = nil
                    } else {
                        expandedRouteId = routeId
                        selectedFrom = route.stops.first
                        selectedTo = route.stops.last
                    }
                }
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(route.name)
                            .font(.headline)
                            .foregroundStyle(.primary)

                        Text(route.stops.map(\.name).joined(separator: " \u{2022} "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }

                    Spacer()

                    Image(systemName: expandedRouteId == routeId ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            // Expanded: stop pickers
            if expandedRouteId == routeId {
                VStack(spacing: 12) {
                    // Origin picker
                    HStack {
                        Image(systemName: "circle.fill")
                            .font(.caption2)
                            .foregroundStyle(.green)
                        Text("From")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(width: 44, alignment: .leading)
                        Picker("Origin", selection: $selectedFrom) {
                            ForEach(route.stops) { stop in
                                Text(stop.name).tag(Optional(stop))
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(.primary)
                    }

                    // Destination picker
                    HStack {
                        Image(systemName: "mappin.circle.fill")
                            .font(.caption2)
                            .foregroundStyle(.red)
                        Text("To")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(width: 44, alignment: .leading)
                        Picker("Destination", selection: $selectedTo) {
                            ForEach(route.stops) { stop in
                                Text(stop.name).tag(Optional(stop))
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(.primary)
                    }

                    // Load button
                    Button {
                        if let from = selectedFrom, let to = selectedTo, from != to {
                            viewModel.selectRoute(routeId: routeId, from: from, to: to)
                        }
                    } label: {
                        HStack {
                            Image(systemName: "camera.viewfinder")
                            Text("Load Cameras")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(selectedFrom == nil || selectedTo == nil || selectedFrom == selectedTo)
                }
                .padding(.top, 4)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Custom Route

    private var customRouteSection: some View {
        Section {
            // Origin search
            VStack(alignment: .leading, spacing: 6) {
                Label("Origin", systemImage: "circle.fill")
                    .font(.subheadline.bold())
                    .foregroundStyle(.green)

                HStack {
                    TextField("Search city or address", text: $originQuery)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .onSubmit { searchOrigin() }

                    if isSearchingOrigin {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Button {
                            searchOrigin()
                        } label: {
                            Image(systemName: "magnifyingglass")
                        }
                        .disabled(originQuery.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }

                if let origin = selectedOrigin {
                    selectedPlaceBadge(name: origin.name, onClear: {
                        selectedOrigin = nil
                    })
                }

                if !originResults.isEmpty && selectedOrigin == nil {
                    ForEach(originResults) { result in
                        Button {
                            selectedOrigin = result
                            originQuery = result.name
                            originResults = []
                        } label: {
                            HStack {
                                Image(systemName: "mappin")
                                    .foregroundStyle(.secondary)
                                Text(result.name)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Destination search
            VStack(alignment: .leading, spacing: 6) {
                Label("Destination", systemImage: "mappin.circle.fill")
                    .font(.subheadline.bold())
                    .foregroundStyle(.red)

                HStack {
                    TextField("Search city or address", text: $destinationQuery)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .onSubmit { searchDestination() }

                    if isSearchingDestination {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Button {
                            searchDestination()
                        } label: {
                            Image(systemName: "magnifyingglass")
                        }
                        .disabled(destinationQuery.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }

                if let dest = selectedDestination {
                    selectedPlaceBadge(name: dest.name, onClear: {
                        selectedDestination = nil
                    })
                }

                if !destinationResults.isEmpty && selectedDestination == nil {
                    ForEach(destinationResults) { result in
                        Button {
                            selectedDestination = result
                            destinationQuery = result.name
                            destinationResults = []
                        } label: {
                            HStack {
                                Image(systemName: "mappin")
                                    .foregroundStyle(.secondary)
                                Text(result.name)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Load button
            Button {
                if let origin = selectedOrigin, let dest = selectedDestination {
                    viewModel.selectCustomRoute(
                        from: Waypoint(lat: origin.lat, lon: origin.lon),
                        to: Waypoint(lat: dest.lat, lon: dest.lon)
                    )
                }
            } label: {
                HStack {
                    Image(systemName: "camera.viewfinder")
                    Text("Load Cameras")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(selectedOrigin == nil || selectedDestination == nil)
        } header: {
            Text("Custom Route")
        } footer: {
            Text("Search for any two locations to find highway cameras along the route.")
        }
    }

    // MARK: - Helpers

    private func selectedPlaceBadge(name: String, onClear: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
            Text(name)
                .font(.caption)
                .lineLimit(1)
            Spacer()
            Button(action: onClear) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Geocoding

    private func searchOrigin() {
        let query = originQuery.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return }
        isSearchingOrigin = true
        Task {
            originResults = await geocode(query: query)
            isSearchingOrigin = false
        }
    }

    private func searchDestination() {
        let query = destinationQuery.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return }
        isSearchingDestination = true
        Task {
            destinationResults = await geocode(query: query)
            isSearchingDestination = false
        }
    }

    /// Geocode using Photon/Komoot API
    private func geocode(query: String) async -> [GeocodingResult] {
        guard let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://photon.komoot.io/api/?q=\(encoded)&limit=5") else {
            return []
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let features = json?["features"] as? [[String: Any]] else { return [] }

            return features.compactMap { feature -> GeocodingResult? in
                guard let geometry = feature["geometry"] as? [String: Any],
                      let coords = geometry["coordinates"] as? [Double],
                      coords.count >= 2,
                      let properties = feature["properties"] as? [String: Any] else {
                    return nil
                }
                let name = properties["name"] as? String ?? "Unknown"
                let state = properties["state"] as? String
                let country = properties["country"] as? String
                let displayParts = [name, state, country].compactMap { $0 }
                return GeocodingResult(
                    id: UUID().uuidString,
                    name: displayParts.joined(separator: ", "),
                    lat: coords[1],
                    lon: coords[0]
                )
            }
        } catch {
            return []
        }
    }
}

// MARK: - Geocoding Result Model

struct GeocodingResult: Identifiable {
    let id: String
    let name: String
    let lat: Double
    let lon: Double
}

#Preview {
    NavigationStack {
        RouteSelectionView()
            .navigationTitle("Route")
    }
    .environmentObject(TripViewModel())
}
