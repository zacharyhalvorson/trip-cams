//
//  Color+Trip.swift
//  TripCams
//

import SwiftUI
import UIKit

extension Color {
    static let tripGreen = Color(red: 0.176, green: 0.722, blue: 0.294)

    static func regionBadge(_ region: String) -> Color {
        switch region.uppercased() {
        case "AB": return .orange
        case "BC": return .blue
        case "SK": return .yellow
        case "MB": return .teal
        case "ON": return .red
        case "QC": return .indigo
        case "NB", "NS", "PE", "NL": return .cyan
        case "YT": return .purple
        case "WA": return .purple
        case "OR": return .green
        case "CA": return .orange
        case "ID": return .brown
        case "MT": return .mint
        case "WY": return .yellow
        case "ND": return .teal
        case "OH": return .red
        case "MD": return .indigo
        case "NY": return .blue
        default: return .gray
        }
    }
}

extension UIColor {
    static let tripGreen = UIColor(red: 0.176, green: 0.722, blue: 0.294, alpha: 1)
}
