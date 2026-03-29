//
//  RoutePickerOverlay.swift
//  TripCams
//

import SwiftUI

struct RoutePickerOverlay: View {
    @EnvironmentObject private var viewModel: TripViewModel
    @State private var swapRotation: Double = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                // From input
                routeInput(
                    label: "FROM",
                    value: viewModel.fromStop?.name ?? "Choose origin",
                    isEmpty: viewModel.fromStop == nil,
                    field: .from
                )

                // Swap button
                Button {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) {
                        swapRotation += 180
                    }
                    viewModel.swapFromTo()
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(Color.tripGreen, in: RoundedRectangle(cornerRadius: 12))
                        .rotationEffect(.degrees(swapRotation))
                }

                // To input
                routeInput(
                    label: "TO",
                    value: viewModel.toStop?.name ?? "Choose destination",
                    isEmpty: viewModel.toStop == nil,
                    field: .to
                )
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(.ultraThinMaterial)
        .sheet(isPresented: Binding(
            get: { viewModel.activeDropdown != .none },
            set: { if !$0 { viewModel.activeDropdown = .none } }
        )) {
            StopPickerSheet()
                .environmentObject(viewModel)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private func routeInput(label: String, value: String, isEmpty: Bool, field: TripViewModel.DropdownField) -> some View {
        Button {
            viewModel.activeDropdown = field
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)

                Text(value)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(isEmpty ? .tertiary : .primary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(.secondarySystemBackground))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color(.separator).opacity(0.3), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
