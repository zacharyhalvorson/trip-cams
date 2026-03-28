// TripCams – CameraAPIService.swift
// Fetches and normalizes camera data from 30+ state/province DOT APIs

import Foundation

// MARK: - Camera Registry

struct CameraEndpoint {
    let code: String
    let urls: [String]
    let normalizer: NormalizerType

    enum NormalizerType {
        case alberta
        case ibi(String)
        case bc
        case wa
        case qc
        case md
        case oh
        case nd
        case arcGIS(String)
        case ca
        case or_
    }
}

// California district with geographic bounds
struct CADistrict {
    let number: Int
    let padded: String
    let latRange: ClosedRange<Double>
    let lonRange: ClosedRange<Double>

    var url: String {
        "https://cwwp2.dot.ca.gov/data/d\(number)/cctv/cctvStatusD\(padded).json"
    }
}

// MARK: - Service

@MainActor
class CameraAPIService: ObservableObject {
    static let shared = CameraAPIService()

    private let session: URLSession
    private let cacheService = CacheService.shared

    private static let batchSize = 8

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 30
        session = URLSession(configuration: config)
    }

    // MARK: - Registry

    static let registry: [CameraEndpoint] = [
        // Canada – IBI 511
        CameraEndpoint(code: "AB", urls: ["https://511.alberta.ca/api/v2/get/cameras"], normalizer: .alberta),
        CameraEndpoint(code: "SK", urls: ["https://hotline.gov.sk.ca/api/v2/get/cameras"], normalizer: .ibi("SK")),
        CameraEndpoint(code: "MB", urls: ["https://www.manitoba511.ca/api/v2/get/cameras"], normalizer: .ibi("MB")),
        CameraEndpoint(code: "ON", urls: ["https://511on.ca/api/v2/get/cameras"], normalizer: .ibi("ON")),
        CameraEndpoint(code: "NB", urls: ["https://511.gnb.ca/api/v2/get/cameras"], normalizer: .ibi("NB")),
        CameraEndpoint(code: "NS", urls: ["https://511.novascotia.ca/api/v2/get/cameras"], normalizer: .ibi("NS")),
        CameraEndpoint(code: "PE", urls: ["https://511.gov.pe.ca/api/v2/get/cameras"], normalizer: .ibi("PE")),
        CameraEndpoint(code: "NL", urls: ["https://511nl.ca/api/v2/get/cameras"], normalizer: .ibi("NL")),
        CameraEndpoint(code: "YT", urls: ["https://511yukon.ca/api/v2/get/cameras"], normalizer: .ibi("YT")),

        // Canada – Custom
        CameraEndpoint(code: "BC", urls: ["https://www.drivebc.ca/api/webcams/"], normalizer: .bc),
        CameraEndpoint(code: "QC", urls: ["https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&outfile=Camera&srsname=EPSG:4326&outputformat=geojson"], normalizer: .qc),

        // US – IBI 511
        CameraEndpoint(code: "NY", urls: ["https://511ny.org/api/v2/get/cameras"], normalizer: .ibi("NY")),
        CameraEndpoint(code: "GA", urls: ["https://511ga.org/api/v2/get/cameras"], normalizer: .ibi("GA")),
        CameraEndpoint(code: "WI", urls: ["https://511wi.gov/api/v2/get/cameras"], normalizer: .ibi("WI")),
        CameraEndpoint(code: "LA", urls: ["https://511la.org/api/v2/get/cameras"], normalizer: .ibi("LA")),
        CameraEndpoint(code: "AZ", urls: ["https://az511.gov/api/v2/get/cameras"], normalizer: .ibi("AZ")),
        CameraEndpoint(code: "ID", urls: ["https://511.idaho.gov/api/v2/get/cameras"], normalizer: .ibi("ID")),
        CameraEndpoint(code: "AK", urls: ["https://511.alaska.gov/api/v2/get/cameras"], normalizer: .ibi("AK")),
        CameraEndpoint(code: "UT", urls: ["https://udottraffic.utah.gov/api/v2/get/cameras"], normalizer: .ibi("UT")),
        CameraEndpoint(code: "NV", urls: ["https://nvroads.com/api/v2/get/cameras"], normalizer: .ibi("NV")),
        CameraEndpoint(code: "CT", urls: ["https://portal.ct.gov/dot-511/api/v2/get/cameras"], normalizer: .ibi("CT")),

        // US – Custom
        CameraEndpoint(code: "WA", urls: [
            "https://data.wsdot.wa.gov/mobile/Cameras.json",
            "https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query?where=1%3D1&outFields=*&f=json",
            "https://www.wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=788bd008-7608-4534-8819-8b7495d91551"
        ], normalizer: .wa),
        CameraEndpoint(code: "OR", urls: ["https://gis.odot.state.or.us/arcgis/rest/services/transgis/CCTV_Cameras/FeatureServer/0/query?where=1%3D1&outFields=*&f=json"], normalizer: .or_),
        CameraEndpoint(code: "MD", urls: ["https://chart.maryland.gov/DataFeeds/GetCamerasJson"], normalizer: .md),
        CameraEndpoint(code: "OH", urls: ["https://publicapi.ohgo.com/api/v1/cameras"], normalizer: .oh),
        CameraEndpoint(code: "ND", urls: ["https://travelfiles.dot.nd.gov/geojson_nc/cameras.json"], normalizer: .nd),
        CameraEndpoint(code: "WY", urls: ["https://map.wyoroad.info/wtimap/arcgis/rest/services/Shared/Camera/FeatureServer/0/query?where=1%3D1&outFields=*&f=json"], normalizer: .arcGIS("WY")),
        CameraEndpoint(code: "KY", urls: ["https://maps.kytc.ky.gov/arcgis/rest/services/GOPSServices/TRIMARC_Cameras/FeatureServer/0/query?where=1%3D1&outFields=*&f=json"], normalizer: .arcGIS("KY")),
        CameraEndpoint(code: "DE", urls: ["https://tmc.deldot.gov/arcgis/rest/services/TMC/TMC_CCTV/FeatureServer/0/query?where=1%3D1&outFields=*&f=json"], normalizer: .arcGIS("DE")),
    ]

    static let caDistricts: [CADistrict] = [
        CADistrict(number: 1,  padded: "01", latRange: 38.2...42.0, lonRange: -124.4...(-121.5)),
        CADistrict(number: 2,  padded: "02", latRange: 38.5...42.0, lonRange: -124.2...(-120.0)),
        CADistrict(number: 3,  padded: "03", latRange: 38.0...40.2, lonRange: -122.5...(-119.8)),
        CADistrict(number: 4,  padded: "04", latRange: 37.2...38.8, lonRange: -122.8...(-121.5)),
        CADistrict(number: 5,  padded: "05", latRange: 34.3...37.5, lonRange: -122.0...(-118.5)),
        CADistrict(number: 6,  padded: "06", latRange: 35.5...37.8, lonRange: -121.5...(-118.5)),
        CADistrict(number: 7,  padded: "07", latRange: 33.7...34.8, lonRange: -118.9...(-117.6)),
        CADistrict(number: 8,  padded: "08", latRange: 33.4...34.5, lonRange: -117.8...(-115.4)),
        CADistrict(number: 9,  padded: "09", latRange: 33.0...34.0, lonRange: -117.5...(-116.0)),
        CADistrict(number: 10, padded: "10", latRange: 36.5...38.5, lonRange: -121.5...(-119.0)),
        CADistrict(number: 11, padded: "11", latRange: 32.5...33.5, lonRange: -117.3...(-116.1)),
        CADistrict(number: 12, padded: "12", latRange: 33.5...35.5, lonRange: -120.8...(-117.0)),
    ]

    // MARK: - Progressive Fetching

    /// Fetch cameras for given regions progressively, calling onRegion as each completes.
    func fetchCameras(regions: [String], onRegion: @escaping (String, [Camera]) -> Void) async {
        // Handle California specially — only fetch relevant districts
        var endpoints = Self.registry.filter { regions.contains($0.code) }

        if regions.contains("CA") {
            // CA is handled separately via district fetching
            endpoints.removeAll { $0.code == "CA" }
        }

        // Batch fetch
        for batch in stride(from: 0, to: endpoints.count, by: Self.batchSize) {
            let end = min(batch + Self.batchSize, endpoints.count)
            let slice = endpoints[batch..<end]

            await withTaskGroup(of: (String, [Camera]).self) { group in
                for endpoint in slice {
                    group.addTask { [weak self] in
                        guard let self else { return (endpoint.code, []) }
                        let cameras = await self.fetchRegion(endpoint: endpoint)
                        return (endpoint.code, cameras)
                    }
                }

                for await (code, cameras) in group {
                    if !cameras.isEmpty {
                        onRegion(code, cameras)
                    }
                }
            }
        }

        // Fetch California districts if needed
        if regions.contains("CA") {
            await fetchCaliforniaDistricts(onRegion: onRegion)
        }
    }

    // MARK: - Single Region Fetch

    private func fetchRegion(endpoint: CameraEndpoint) async -> [Camera] {
        // Check cache first (stale-while-revalidate)
        if let cached = await cacheService.get(key: endpoint.code) {
            let cameras = normalize(data: cached.data, endpoint: endpoint)
            if cached.fresh {
                return cameras
            }
            // Stale — refresh in background, return cached
            Task { [weak self] in
                if let fresh = await self?.fetchFromNetwork(endpoint: endpoint) {
                    await self?.cacheService.set(key: endpoint.code, data: fresh)
                }
            }
            return cameras
        }

        // No cache — fetch fresh
        if let data = await fetchFromNetwork(endpoint: endpoint) {
            await cacheService.set(key: endpoint.code, data: data)
            return normalize(data: data, endpoint: endpoint)
        }

        // Try bundled fallback
        return loadFallback(region: endpoint.code)
    }

    private func fetchFromNetwork(endpoint: CameraEndpoint) async -> Data? {
        // Try each URL (WA has 3 fallbacks)
        for urlString in endpoint.urls {
            guard let url = URL(string: urlString) else { continue }
            do {
                let (data, response) = try await session.data(from: url)
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    return data
                }
            } catch {
                continue
            }
        }
        return nil
    }

    // MARK: - California Districts

    private func fetchCaliforniaDistricts(onRegion: @escaping (String, [Camera]) -> Void) async {
        // Check cache first
        if let cached = await cacheService.get(key: "CA") {
            let cameras = normalizeCA(data: cached.data, district: 0)
            if cached.fresh && !cameras.isEmpty {
                onRegion("CA", cameras)
                return
            }
        }

        await withTaskGroup(of: [Camera].self) { group in
            for district in Self.caDistricts {
                group.addTask { [weak self] in
                    guard let self else { return [] }
                    guard let url = URL(string: district.url) else { return [] }
                    do {
                        let (data, response) = try await self.session.data(from: url)
                        if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                            return self.normalizeCA(data: data, district: district.number)
                        }
                    } catch {}
                    return []
                }
            }

            var allCA: [Camera] = []
            for await cameras in group {
                allCA.append(contentsOf: cameras)
            }
            if !allCA.isEmpty {
                onRegion("CA", allCA)
            }
        }
    }

    // MARK: - Normalization Router

    private func normalize(data: Data, endpoint: CameraEndpoint) -> [Camera] {
        switch endpoint.normalizer {
        case .alberta:
            return normalizeIBI(data: data, region: "AB")
        case .ibi(let region):
            return normalizeIBI(data: data, region: region)
        case .bc:
            return normalizeBC(data: data)
        case .wa:
            return normalizeWA(data: data)
        case .qc:
            return normalizeQC(data: data)
        case .md:
            return normalizeMD(data: data)
        case .oh:
            return normalizeOH(data: data)
        case .nd:
            return normalizeND(data: data)
        case .arcGIS(let region):
            return normalizeArcGIS(data: data, region: region)
        case .ca:
            return normalizeCA(data: data, district: 0)
        case .or_:
            return normalizeArcGIS(data: data, region: "OR")
        }
    }

    // MARK: - Bundled Fallback

    private func loadFallback(region: String) -> [Camera] {
        let filename = "cameras-\(region.lowercased())"
        guard let url = Bundle.main.url(forResource: filename, withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let cameras = try? JSONDecoder().decode([Camera].self, from: data) else {
            return []
        }
        return cameras
    }

    // MARK: - Normalizers

    /// IBI 511 normalizer. Used by AB, SK, MB, ON, NB, NS, PE, NL, YT, NY, GA, WI, LA, AZ, ID, AK, UT, NV, CT.
    private func normalizeIBI(data: Data, region: String) -> [Camera] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }

        var cameras: [Camera] = []
        let prefix = region.lowercased()

        for cam in json {
            guard let camId = cam["Id"] as? Int ?? (cam["Id"] as? String).flatMap({ Int($0) }),
                  let lat = cam["Latitude"] as? Double,
                  let lon = cam["Longitude"] as? Double,
                  lat != 0, lon != 0 else { continue }

            let name = cam["Name"] as? String ?? cam["Description"] as? String ?? "Camera \(camId)"
            let highway = cam["Roadway"] as? String ?? cam["RoadwayName"] as? String ?? ""
            let direction = cam["Direction"] as? String ?? ""

            guard let views = cam["Views"] as? [[String: Any]], !views.isEmpty else {
                cameras.append(Camera(
                    id: "\(prefix)-\(camId)",
                    name: name, highway: highway, region: region,
                    lat: lat, lon: lon,
                    imageUrl: "", thumbnailUrl: nil,
                    status: .inactive, direction: direction,
                    lastUpdated: nil, temperature: nil
                ))
                continue
            }

            for view in views {
                guard let viewId = view["Id"] as? Int ?? (view["Id"] as? String).flatMap({ Int($0) }),
                      let imageUrl = view["Url"] as? String, !imageUrl.isEmpty else { continue }

                let statusStr = view["Status"] as? String ?? "Enabled"
                let status: Camera.CameraStatus = statusStr == "Disabled" ? .inactive : .active
                let lastUpdated = view["LastUpdated"] as? String

                cameras.append(Camera(
                    id: "\(prefix)-\(camId)-\(viewId)",
                    name: name, highway: highway, region: region,
                    lat: lat, lon: lon,
                    imageUrl: imageUrl, thumbnailUrl: nil,
                    status: status, direction: direction,
                    lastUpdated: lastUpdated, temperature: nil
                ))
            }
        }

        return cameras
    }

    /// DriveBC format. GeoJSON-like array with nested location.coordinates.
    private func normalizeBC(data: Data) -> [Camera] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }

        var cameras: [Camera] = []
        let baseUrl = "https://www.drivebc.ca"

        for cam in json {
            if let shouldAppear = cam["should_appear"] as? Bool, !shouldAppear { continue }

            guard let location = cam["location"] as? [String: Any],
                  let coordinates = location["coordinates"] as? [Double],
                  coordinates.count >= 2 else { continue }

            let lon = coordinates[0]
            let lat = coordinates[1]
            let id = cam["id"] as? String ?? cam["id"].map { "\($0)" } ?? UUID().uuidString
            let name = cam["camName"] as? String ?? ""
            let highway = cam["caption"] as? String ?? ""
            let isOn = cam["isOn"] as? Bool ?? true
            let orientation = cam["orientation"] as? String ?? ""

            let links = cam["links"] as? [String: Any]
            let imageSource = links?["imageSource"] as? String ?? ""
            let imageThumbnail = links?["imageThumbnail"] as? String

            let imageUrl = imageSource.hasPrefix("http") ? imageSource : baseUrl + imageSource
            let thumbnailUrl = imageThumbnail.map { $0.hasPrefix("http") ? $0 : baseUrl + $0 }

            cameras.append(Camera(
                id: "bc-\(id)",
                name: name, highway: highway, region: "BC",
                lat: lat, lon: lon,
                imageUrl: imageUrl, thumbnailUrl: thumbnailUrl,
                status: isOn ? .active : .inactive,
                direction: orientation,
                lastUpdated: nil, temperature: nil
            ))
        }

        return cameras
    }

    /// WSDOT format. Three possible API formats: mobile, ArcGIS, REST.
    private func normalizeWA(data: Data) -> [Camera] {
        guard let json = try? JSONSerialization.jsonObject(with: data) else {
            return []
        }

        // Try mobile format first: { cameras: { items: [...] } }
        if let dict = json as? [String: Any],
           let camerasObj = dict["cameras"] as? [String: Any],
           let items = camerasObj["items"] as? [[String: Any]] {
            return normalizeWAItems(items)
        }

        // Try ArcGIS format: { features: [...] }
        if let dict = json as? [String: Any],
           let features = dict["features"] as? [[String: Any]] {
            return normalizeWAArcGIS(features)
        }

        // Try direct array format
        if let items = json as? [[String: Any]] {
            return normalizeWAItems(items)
        }

        return []
    }

    private func normalizeWAItems(_ items: [[String: Any]]) -> [Camera] {
        var cameras: [Camera] = []

        for item in items {
            let camId = item["CameraID"] as? Int ?? item["CameraId"] as? Int ?? 0
            let title = item["Title"] as? String ?? item["CameraTitle"] as? String ?? ""
            let highway = item["RoadwayName"] as? String ?? item["RoadName"] as? String ?? ""
            let imageUrl = item["ImageURL"] as? String ?? item["ImageUrl"] as? String ?? ""

            var lat: Double?
            var lon: Double?

            if let displayLat = item["DisplayLatitude"] as? Double {
                lat = displayLat
                lon = item["DisplayLongitude"] as? Double
            } else if let camLoc = item["CameraLocation"] as? [String: Any] {
                lat = camLoc["Latitude"] as? Double
                lon = camLoc["Longitude"] as? Double
            } else {
                lat = item["Latitude"] as? Double
                lon = item["Longitude"] as? Double
            }

            guard let latitude = lat, let longitude = lon, latitude != 0 else { continue }

            cameras.append(Camera(
                id: "wa-\(camId)",
                name: title, highway: highway, region: "WA",
                lat: latitude, lon: longitude,
                imageUrl: imageUrl, thumbnailUrl: nil,
                status: .active, direction: "",
                lastUpdated: nil, temperature: nil
            ))
        }

        return cameras
    }

    private func normalizeWAArcGIS(_ features: [[String: Any]]) -> [Camera] {
        var cameras: [Camera] = []

        for feature in features {
            guard let attrs = feature["attributes"] as? [String: Any],
                  let geom = feature["geometry"] as? [String: Any] else { continue }

            let lon = geom["x"] as? Double ?? 0
            let lat = geom["y"] as? Double ?? 0
            guard lat != 0, lon != 0 else { continue }

            let camId = attrs["CameraID"] as? Int ?? attrs["OBJECTID"] as? Int ?? 0
            let title = attrs["Title"] as? String ?? attrs["CameraTitle"] as? String ?? ""
            let highway = attrs["RoadwayName"] as? String ?? ""
            let imageUrl = attrs["ImageURL"] as? String ?? attrs["ImageUrl"] as? String ?? ""

            cameras.append(Camera(
                id: "wa-\(camId)",
                name: title, highway: highway, region: "WA",
                lat: lat, lon: lon,
                imageUrl: imageUrl, thumbnailUrl: nil,
                status: .active, direction: "",
                lastUpdated: nil, temperature: nil
            ))
        }

        return cameras
    }

    /// Quebec WFS GeoJSON format.
    private func normalizeQC(data: Data) -> [Camera] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]] else {
            return []
        }

        var cameras: [Camera] = []

        for feature in features {
            guard let properties = feature["properties"] as? [String: Any],
                  let geometry = feature["geometry"] as? [String: Any],
                  let coordinates = geometry["coordinates"] as? [Double],
                  coordinates.count >= 2 else { continue }

            let lon = coordinates[0]
            let lat = coordinates[1]
            let id = properties["id_camera"] as? Int ?? properties["id"] as? Int ?? 0
            let name = properties["nom"] as? String ?? ""
            let highway = properties["route"] as? String ?? properties["description"] as? String ?? ""
            let imageUrl = properties["url_image_en"] as? String
                ?? properties["url_image_fr"] as? String ?? ""

            cameras.append(Camera(
                id: "qc-\(id)",
                name: name, highway: highway, region: "QC",
                lat: lat, lon: lon,
                imageUrl: imageUrl, thumbnailUrl: nil,
                status: .active, direction: "",
                lastUpdated: nil, temperature: nil
            ))
        }

        return cameras
    }

    /// Maryland JSON array format.
    private func normalizeMD(data: Data) -> [Camera] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }

        var cameras: [Camera] = []

        for cam in json {
            guard let lat = cam["lat"] as? Double ?? (cam["latitude"] as? Double),
                  let lon = cam["lon"] as? Double ?? (cam["longitude"] as? Double),
                  lat != 0, lon != 0 else { continue }

            let id = cam["cameraId"] as? String ?? cam["id"].map { "\($0)" } ?? UUID().uuidString
            let name = cam["description"] as? String ?? cam["name"] as? String ?? ""
            let imageUrl = cam["imageUrl"] as? String ?? cam["url"] as? String ?? ""

            cameras.append(Camera(
                id: "md-\(id)",
                name: name, highway: "", region: "MD",
                lat: lat, lon: lon,
                imageUrl: imageUrl, thumbnailUrl: nil,
                status: .active, direction: "",
                lastUpdated: nil, temperature: nil
            ))
        }

        return cameras
    }

    /// Ohio OHGO format.
    private func normalizeOH(data: Data) -> [Camera] {
        guard let json = try? JSONSerialization.jsonObject(with: data) else {
            return []
        }

        let items: [[String: Any]]
        if let dict = json as? [String: Any], let results = dict["results"] as? [[String: Any]] {
            items = results
        } else if let arr = json as? [[String: Any]] {
            items = arr
        } else {
            return []
        }

        var cameras: [Camera] = []

        for cam in items {
            guard let lat = cam["latitude"] as? Double,
                  let lon = cam["longitude"] as? Double,
                  lat != 0, lon != 0 else { continue }

            let id = cam["id"] as? Int ?? 0
            let name = cam["description"] as? String ?? ""
            let highway = cam["routeName"] as? String ?? ""
            let imageUrl = cam["largeImageUrl"] as? String ?? cam["cameraImageUrl"] as? String ?? ""

            cameras.append(Camera(
                id: "oh-\(id)",
                name: name, highway: highway, region: "OH",
                lat: lat, lon: lon,
                imageUrl: imageUrl, thumbnailUrl: nil,
                status: .active, direction: "",
                lastUpdated: nil, temperature: nil
            ))
        }

        return cameras
    }

    /// North Dakota GeoJSON format.
    private func normalizeND(data: Data) -> [Camera] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]] else {
            return []
        }

        var cameras: [Camera] = []

        for feature in features {
            guard let properties = feature["properties"] as? [String: Any],
                  let geometry = feature["geometry"] as? [String: Any],
                  let coordinates = geometry["coordinates"] as? [Double],
                  coordinates.count >= 2 else { continue }

            let lon = coordinates[0]
            let lat = coordinates[1]
            let id = properties["id"] as? Int ?? (properties["id"] as? String).flatMap({ Int($0) }) ?? 0
            let name = properties["description"] as? String ?? ""
            let imageUrl = properties["image_url"] as? String ?? ""

            cameras.append(Camera(
                id: "nd-\(id)",
                name: name, highway: "", region: "ND",
                lat: lat, lon: lon,
                imageUrl: imageUrl, thumbnailUrl: nil,
                status: .active, direction: "",
                lastUpdated: nil, temperature: nil
            ))
        }

        return cameras
    }

    /// ArcGIS FeatureServer format. Used by OR, WY, KY, DE.
    private func normalizeArcGIS(data: Data, region: String) -> [Camera] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = json["features"] as? [[String: Any]] else {
            return []
        }

        let prefix = region.lowercased()
        var cameras: [Camera] = []

        for feature in features {
            guard let attrs = feature["attributes"] as? [String: Any] else { continue }

            // Flexible coordinate extraction
            var lat: Double?
            var lon: Double?

            if let geom = feature["geometry"] as? [String: Any] {
                lon = geom["x"] as? Double
                lat = geom["y"] as? Double
            }

            if lat == nil {
                lat = attrs["latitude"] as? Double ?? attrs["Latitude"] as? Double
                    ?? attrs["LATITUDE"] as? Double ?? attrs["lat"] as? Double
            }
            if lon == nil {
                lon = attrs["longitude"] as? Double ?? attrs["Longitude"] as? Double
                    ?? attrs["LONGITUDE"] as? Double ?? attrs["lon"] as? Double
                    ?? attrs["lng"] as? Double
            }

            guard let latitude = lat, let longitude = lon, latitude != 0, longitude != 0 else { continue }

            let id = attrs["OBJECTID"] as? Int ?? attrs["objectid"] as? Int
                ?? attrs["ID"] as? Int ?? attrs["id"] as? Int ?? 0

            // Flexible name extraction
            let name = (attrs["title"] as? String)
                ?? (attrs["Title"] as? String)
                ?? (attrs["TITLE"] as? String)
                ?? (attrs["description"] as? String)
                ?? (attrs["Description"] as? String)
                ?? (attrs["DESCRIPTION"] as? String)
                ?? (attrs["Name"] as? String)
                ?? (attrs["name"] as? String)
                ?? (attrs["NAME"] as? String)
                ?? (attrs["LocationDescription"] as? String)
                ?? ""

            // Flexible image URL extraction
            let imageUrl = (attrs["CameraImageURL"] as? String)
                ?? (attrs["ImageUrl"] as? String)
                ?? (attrs["image_url"] as? String)
                ?? (attrs["imageURL"] as? String)
                ?? (attrs["URL"] as? String)
                ?? (attrs["url"] as? String)
                ?? (attrs["IMAGEURL"] as? String)
                ?? ""

            cameras.append(Camera(
                id: "\(prefix)-\(id)",
                name: name, highway: "", region: region,
                lat: latitude, lon: longitude,
                imageUrl: imageUrl, thumbnailUrl: nil,
                status: .active, direction: "",
                lastUpdated: nil, temperature: nil
            ))
        }

        return cameras
    }

    /// California Caltrans per-district format.
    private func normalizeCA(data: Data, district: Int) -> [Camera] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataArray = json["data"] as? [[String: Any]] else {
            return []
        }

        var cameras: [Camera] = []
        let baseUrl = "https://cwwp2.dot.ca.gov"

        for entry in dataArray {
            guard let cctv = entry["cctv"] as? [String: Any] else { continue }

            guard let location = cctv["location"] as? [String: Any],
                  let lat = location["latitude"] as? Double,
                  let lon = location["longitude"] as? Double,
                  lat != 0, lon != 0 else { continue }

            guard let index = cctv["index"] as? [String: Any] else { continue }
            let id = index["id"] as? String ?? "\(district)-\(cameras.count)"
            let name = location["locationName"] as? String ?? ""
            let direction = location["direction"] as? String ?? ""

            let inService = cctv["inService"] as? String ?? "true"
            let status: Camera.CameraStatus = inService == "true" ? .active : .inactive

            var imageUrl = ""
            if let imageData = cctv["imageData"] as? [String: Any],
               let staticData = imageData["static"] as? [String: Any],
               let currentUrl = staticData["currentImageURL"] as? String {
                imageUrl = currentUrl.hasPrefix("http") ? currentUrl : baseUrl + currentUrl
            }

            cameras.append(Camera(
                id: "ca-\(id)",
                name: name, highway: "", region: "CA",
                lat: lat, lon: lon,
                imageUrl: imageUrl, thumbnailUrl: nil,
                status: status, direction: direction,
                lastUpdated: nil, temperature: nil
            ))
        }

        return cameras
    }

}
