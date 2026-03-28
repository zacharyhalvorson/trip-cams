//
//  CacheService.swift
//  TripCams
//

import Foundation

actor CacheService {
    static let shared = CacheService()

    private let cacheDuration: TimeInterval = 300 // 5 minutes
    private var memCache: [String: CacheEntry] = [:]

    struct CacheEntry: Codable {
        let data: Data
        let timestamp: Date
    }

    func get(key: String) -> (data: Data, fresh: Bool)? {
        // Check memory cache first, then UserDefaults
        // Return fresh=true if within cacheDuration, fresh=false if stale
        if let entry = memCache[key] {
            let fresh = Date().timeIntervalSince(entry.timestamp) < cacheDuration
            return (entry.data, fresh)
        }
        // Check UserDefaults
        let storageKey = "tripcams_cache_\(key)"
        if let stored = UserDefaults.standard.data(forKey: storageKey),
           let entry = try? JSONDecoder().decode(CacheEntry.self, from: stored) {
            memCache[key] = entry
            let fresh = Date().timeIntervalSince(entry.timestamp) < cacheDuration
            return (entry.data, fresh)
        }
        return nil
    }

    func set(key: String, data: Data) {
        let entry = CacheEntry(data: data, timestamp: Date())
        memCache[key] = entry
        if let encoded = try? JSONEncoder().encode(entry) {
            UserDefaults.standard.set(encoded, forKey: "tripcams_cache_\(key)")
        }
    }

    func clear() {
        memCache.removeAll()
    }
}
