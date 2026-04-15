# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Web App

Vanilla JS PWA — no framework, no build tools, no tests, no linter. Static files served directly.

```bash
python3 -m http.server 8080        # or use: npx serve
```

Dev server configured in `.claude/launch.json`. Deployed to GitHub Pages via `.github/workflows/deploy.yml` on push to `main`.

### Architecture

Four modules loaded via `<script defer>`:

1. **cameras.js** — Data normalization (40+ US/Canadian DOT APIs), corridor filtering (1km buffer with OSRM geometry), route-position sorting, clustering
2. **api.js** — Stale-while-revalidate fetching with direct→CORS-proxy fallback chain. Falls back to bundled JSON (`data/cameras-*.json`). Progressive parallel loading per region. Incident/event API fetching.
3. **map.js** — Leaflet wrapper. Marker clustering, route polyline (OSRM geometry), traffic coloring, geolocation.
4. **app.js** — UI orchestration. Route selection, camera list with clustering/pagination, FLIP modal animation, pull-to-refresh, list↔map scroll sync, URL hash routing, generation-based stale load cancellation, incident notifications.

### Key Patterns

- **Module pattern**: IIFEs returning public API objects (`TripMap`, `API`, `Cameras`)
- **FLIP animation**: Modal measures source card rect → animates clone → reveals modal
- **List↔map sync**: Debounced bidirectional scroll/pan sync
- **URL hash routing**: `#from={id}&to={id}&camera={id}`
- **Route generation counter**: Cancels stale async camera loads on route change
- **Service worker**: Tiered caching — stale-while-revalidate for assets, cache-first for images/tiles, network-first for API data. **Bump `CACHE_NAME` in `sw.js` when changing JS files.**

### CSS

Single `styles.css`. Mobile-first, desktop breakpoint at 769px. Light/dark via `prefers-color-scheme`. `prefers-reduced-motion` disables animations.

## iOS App

SwiftUI app in `ios/TripCams/`. Mirrors the web app's single-screen design.

### Build

```bash
xcodebuild -project ios/TripCams/TripCams.xcodeproj -scheme TripCams \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/TripCamsBuild clean build
```

Always use `clean` + `-derivedDataPath` to avoid stale build cache issues.

### Architecture

- **TripViewModel** — Shared `@MainActor` `ObservableObject`. Manages route/camera state, coordinates API loading. Loads default Vancouver→Calgary route on init.
- **CameraAPIService** — Fetches and normalizes camera data from 40+ DOT APIs. All normalizer methods are `nonisolated` (pure functions). DriveBC uses field names `name`, `is_on`, `links.imageDisplay`.
- **RouteService** — Loads bundled route data, fetches OSRM geometry.
- **CorridorFilter** — Filters cameras within buffer of route geometry, clusters, sorts by route position.

### UI Structure

Single `ZStack` in ContentView (no TabView):
- **MapContainerView** — Full-screen MapKit map with green route polyline and camera markers
- **RoutePickerOverlay** — Glassmorphic from/to bar at top with swap button, opens StopPickerSheet
- **Custom bottom sheet** — Draggable panel (not system `.sheet()`) with camera card list. Uses offset + spring animation for peek/expand states.
- **CameraDetailView** — Dark overlay modal with `matchedGeometryEffect` hero transition from card

The bottom sheet is a custom implementation (not `.sheet()`) specifically so that `matchedGeometryEffect` can animate between the card in the list and the modal — system sheets create a separate presentation context that breaks cross-boundary geometry matching.

### Key Files

| File | Purpose |
|------|---------|
| `Views/ContentView.swift` | Root ZStack: map + route overlay + custom sheet + modal |
| `Views/CameraCardView.swift` | 16:9 camera card with gradient overlay, region badge |
| `Views/CameraImageView.swift` | AsyncImage wrapper, strips CORS proxy URLs, shimmer loading |
| `Views/CameraDetailView.swift` | Full-screen modal with matchedGeometryEffect |
| `Views/Color+Trip.swift` | Design tokens: `.tripGreen`, `.regionBadge()` |
| `App/TripViewModel.swift` | Shared state, route/camera loading logic |
| `Services/CameraAPIService.swift` | API fetching + 15 normalizers for different DOT formats |

## Shared External Dependencies

- **Camera APIs**: 55+ DOT APIs — IBI 511 (AB, SK, MB, ON, NB, NS, PE, NL, YT + all 50 US state codes registered), DriveBC, WSDOT, Caltrans (12 districts), ArcGIS (OR, WY, KY, DE), custom (MD, OH, ND, QC). Some US states use non-IBI platforms and may not respond to the IBI endpoint — the app degrades gracefully. Web uses corsproxy.io for CORS; iOS fetches directly.
- **OSRM**: Road geometry for route polylines
