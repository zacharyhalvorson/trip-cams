//
//  StopPickerSheet.swift
//  TripCams
//

import SwiftUI

struct StopPickerSheet: View {
    @EnvironmentObject private var viewModel: TripViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var searchQuery = ""
    @State private var geocodeResults: [GeocodingService.GeocodedPlace] = []
    @State private var isSearching = false

    private let geocoder = GeocodingService.shared

    private var fieldLabel: String {
        viewModel.activeDropdown == .from ? "Origin" : "Destination"
    }

    var body: some View {
        NavigationStack {
            List {
                // Search results from geocoding
                if !geocodeResults.isEmpty {
                    Section("Search Results") {
                        ForEach(geocodeResults) { place in
                            Button {
                                selectGeocodedPlace(place)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "mappin.circle.fill")
                                        .foregroundStyle(Color.tripGreen)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(place.name)
                                            .font(.system(size: 14, weight: .medium))
                                            .foregroundStyle(.primary)
                                        if !place.region.isEmpty {
                                            Text(place.region)
                                                .font(.system(size: 12))
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Predefined route stops
                ForEach(viewModel.routes.sorted(by: { $0.key < $1.key }), id: \.key) { routeId, route in
                    Section(route.name) {
                        ForEach(route.stops) { stop in
                            Button {
                                selectStop(stop, routeId: routeId)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "circle.fill")
                                        .font(.system(size: 6))
                                        .foregroundStyle(Color.tripGreen)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(stop.name)
                                            .font(.system(size: 14, weight: .medium))
                                            .foregroundStyle(.primary)
                                        Text(stop.region)
                                            .font(.system(size: 12))
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Select \(fieldLabel)")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchQuery, prompt: "Search city or address")
            .onSubmit(of: .search) {
                performSearch()
            }
            .onChange(of: searchQuery) {
                if searchQuery.isEmpty {
                    geocodeResults = []
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    // MARK: - Selection

    private func selectStop(_ stop: RouteStop, routeId: String) {
        let field = viewModel.activeDropdown
        if field == .from {
            viewModel.fromStop = stop
        } else {
            viewModel.toStop = stop
        }
        viewModel.activeDropdown = .none

        // Auto-load if both are set
        if let from = viewModel.fromStop, let to = viewModel.toStop {
            viewModel.selectRoute(routeId: routeId, from: from, to: to)
        }
    }

    private func selectGeocodedPlace(_ place: GeocodingService.GeocodedPlace) {
        let stop = RouteStop(
            id: place.id,
            name: place.displayName,
            region: place.region,
            lat: place.lat,
            lon: place.lon
        )
        let field = viewModel.activeDropdown
        if field == .from {
            viewModel.fromStop = stop
        } else {
            viewModel.toStop = stop
        }
        viewModel.activeDropdown = .none

        // Auto-load custom route if both are set
        if let from = viewModel.fromStop, let to = viewModel.toStop {
            viewModel.selectCustomRoute(
                from: Waypoint(lat: from.lat, lon: from.lon),
                to: Waypoint(lat: to.lat, lon: to.lon)
            )
        }
    }

    // MARK: - Search

    private func performSearch() {
        let text = searchQuery.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        isSearching = true
        Task {
            geocodeResults = await geocoder.search(query: text)
            isSearching = false
        }
    }
}
