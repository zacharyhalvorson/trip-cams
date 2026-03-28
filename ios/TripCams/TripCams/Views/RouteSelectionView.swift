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
    @State private var originResults: [GeocodingService.GeocodedPlace] = []
    @State private var destinationResults: [GeocodingService.GeocodedPlace] = []
    @State private var selectedOrigin: GeocodingService.GeocodedPlace?
    @State private var selectedDestination: GeocodingService.GeocodedPlace?
    @State private var isSearchingOrigin = false
    @State private var isSearchingDestination = false

    private let geocoder = GeocodingService.shared

    var body: some View {
        List {
            if viewModel.selectedRouteId != nil || !viewModel.routeWaypoints.isEmpty {
                currentRouteSection
            }

            predefinedRoutesSection

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
                            .font(.subheadline.bold())
                    }

                    if let from = viewModel.fromStop, let to = viewModel.toStop {
                        Text("\(from.name) → \(to.name)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Text(viewModel.loadingProgress)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if viewModel.isLoadingCameras {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        } header: {
            Text("Current Route")
        }
    }

    // MARK: - Predefined Routes

    private var predefinedRoutesSection: some View {
        Section {
            ForEach(viewModel.routes.sorted(by: { $0.key < $1.key }), id: \.key) { routeId, route in
                routeCard(routeId: routeId, route: route)
            }
        } header: {
            Text("Predefined Routes")
        }
    }

    private func routeCard(routeId: String, route: Route) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeInOut(duration: 0.25)) {
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
                            .font(.subheadline.bold())
                            .foregroundStyle(.primary)

                        Text("\(route.stops.count) stops")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Image(systemName: expandedRouteId == routeId ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if expandedRouteId == routeId {
                VStack(spacing: 10) {
                    Picker("From", selection: $selectedFrom) {
                        Text("Select origin").tag(nil as RouteStop?)
                        ForEach(route.stops) { stop in
                            Text(stop.name).tag(stop as RouteStop?)
                        }
                    }
                    .pickerStyle(.menu)

                    Picker("To", selection: $selectedTo) {
                        Text("Select destination").tag(nil as RouteStop?)
                        ForEach(route.stops) { stop in
                            Text(stop.name).tag(stop as RouteStop?)
                        }
                    }
                    .pickerStyle(.menu)

                    Button {
                        if let from = selectedFrom, let to = selectedTo {
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
            searchField(
                label: "Origin",
                icon: "circle.fill",
                color: .green,
                query: $originQuery,
                results: $originResults,
                selected: $selectedOrigin,
                isSearching: $isSearchingOrigin
            )

            searchField(
                label: "Destination",
                icon: "mappin.circle.fill",
                color: .red,
                query: $destinationQuery,
                results: $destinationResults,
                selected: $selectedDestination,
                isSearching: $isSearchingDestination
            )

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

    // MARK: - Reusable Search Field

    private func searchField(
        label: String,
        icon: String,
        color: Color,
        query: Binding<String>,
        results: Binding<[GeocodingService.GeocodedPlace]>,
        selected: Binding<GeocodingService.GeocodedPlace?>,
        isSearching: Binding<Bool>
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: icon)
                .font(.subheadline.bold())
                .foregroundStyle(color)

            HStack {
                TextField("Search city or address", text: query)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .onSubmit {
                        performSearch(query: query, results: results, isSearching: isSearching)
                    }

                if isSearching.wrappedValue {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Button {
                        performSearch(query: query, results: results, isSearching: isSearching)
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                    .disabled(query.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            if let place = selected.wrappedValue {
                selectedPlaceBadge(name: place.displayName, onClear: {
                    selected.wrappedValue = nil
                })
            }

            if !results.wrappedValue.isEmpty && selected.wrappedValue == nil {
                ForEach(results.wrappedValue) { result in
                    Button {
                        selected.wrappedValue = result
                        query.wrappedValue = result.name
                        results.wrappedValue = []
                    } label: {
                        HStack {
                            Image(systemName: "mappin")
                                .foregroundStyle(.secondary)
                            Text(result.displayName)
                                .font(.subheadline)
                                .foregroundStyle(.primary)
                            Spacer()
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
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

    private func performSearch(
        query: Binding<String>,
        results: Binding<[GeocodingService.GeocodedPlace]>,
        isSearching: Binding<Bool>
    ) {
        let text = query.wrappedValue.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        isSearching.wrappedValue = true
        Task {
            results.wrappedValue = await geocoder.search(query: text)
            isSearching.wrappedValue = false
        }
    }
}

#Preview {
    NavigationStack {
        RouteSelectionView()
            .navigationTitle("Route")
    }
    .environmentObject(TripViewModel())
}
