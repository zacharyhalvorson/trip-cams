# Trip Cams

**Live highway cameras along your driving route.**

**Live site: [https://tripcams.zacharyhalvorson.com](https://tripcams.zacharyhalvorson.com)**

Trip Cams is a progressive web app that shows real-time highway camera feeds along any driving route across North America. Enter any origin and destination — or pick a predefined corridor — and instantly see what road conditions look like between here and there.

## Features

- **Route anywhere** — enter any origin and destination via search, or choose a predefined corridor (Northern, Southern, Lethbridge Spur). Routes are computed using OSRM road geometry
- **35 camera regions** — live feeds from 11 Canadian provinces/territories and 24 US states, with cameras detected automatically based on your route
- **Smart corridor filtering** — 1 km buffer along OSRM road geometry for precise camera matching; falls back to 25 km for predefined routes or 5 km for straight-line segments
- **Interactive map** with clustered markers, satellite view toggle, and route polyline with traffic coloring
- **Synced map + list** — scroll the camera list and the map follows, or pan the map and the list scrolls to the nearest camera
- **Progressive loading** — camera regions fetch in parallel and render as they arrive
- **Works offline** — service worker caches cameras, images, and map tiles so the app stays usable on spotty highway connections
- **Installable PWA** — add to your home screen for a native app experience
- **Light and dark mode** — follows your system preference
- **Geolocation** — detects your position and snaps to the nearest camera
- **Shareable routes** — URL hash encoding lets you share a link to a specific route and camera

## Getting Started

No build tools required. Trip Cams is a static site — just serve the files.

```bash
git clone https://github.com/zacharyhalvorson/trip-cams.git
cd trip-cams

# Use any local HTTP server
python3 -m http.server 8000
# or
npx serve .
```

Then open [http://localhost:8000](http://localhost:8000).

## Project Structure

```
trip-cams/
├── index.html            # Single-page entry point
├── manifest.json         # PWA manifest
├── sw.js                 # Service worker (offline + caching)
├── css/
│   └── styles.css        # All styles, light/dark themes
├── js/
│   ├── app.js            # Core UI, state management, rendering
│   ├── api.js            # Camera API fetching + CORS proxy fallback
│   ├── cameras.js        # Data normalization, corridor filtering, sorting
│   └── map.js            # Leaflet map, markers, route polyline
├── data/
│   ├── route.json        # Predefined route definitions + city stops
│   ├── region-bounds.json# Geographic bounds for all supported regions
│   ├── cameras-ab.json   # Alberta camera fallback data
│   └── cameras-bc.json   # BC camera fallback data
├── img/                  # Icons, favicon, placeholder
└── ios/TripCams/         # Native iOS companion app (SwiftUI)
```

## How It Works

1. **Pick a route** — search for any origin and destination, or select a predefined corridor from the dropdowns
2. **Route geometry** — OSRM computes the actual road geometry; the app detects which camera regions the route passes through
3. **Cameras load** — camera data fetches in parallel from each region's API, filtered to a tight corridor along your route
4. **Browse conditions** — scroll through camera cards or explore the map; views stay synced
5. **Tap a camera** — opens a full-screen modal with optional auto-refresh (every 30 seconds)

Camera data is cached with a stale-while-revalidate strategy: you see cached results immediately while fresh data loads in the background. If APIs are unreachable, bundled fallback data keeps things working.

## Camera Data Sources

### Canada

| Region | Source |
|--------|--------|
| Alberta | [511 Alberta](https://511.alberta.ca) |
| British Columbia | [DriveBC](https://www.drivebc.ca) |
| Saskatchewan | [511 Saskatchewan](https://511.saskatchewan.ca) |
| Manitoba | [511 Manitoba](https://511.manitoba.ca) |
| Ontario | [511 Ontario](https://511.ontario.ca) |
| Quebec | [Transports Quebec](https://www.quebec511.info) |
| New Brunswick | [511 New Brunswick](https://511.gnb.ca) |
| Nova Scotia | [511 Nova Scotia](https://511.novascotia.ca) |
| Prince Edward Island | [511 PEI](https://511.gov.pe.ca) |
| Newfoundland | [511 Newfoundland](https://511.gov.nl.ca) |
| Yukon | [511 Yukon](https://511.yukon.ca) |

### United States

| Region | Source |
|--------|--------|
| Washington | [WSDOT](https://wsdot.wa.gov) |
| Oregon | [ODOT TripCheck](https://tripcheck.com) |
| California | [Caltrans](https://cwwp2.dot.ca.gov) (12 districts) |
| Idaho, Utah, Nevada, Arizona | 511 (IBI platform) |
| Montana, Wyoming, Colorado, New Mexico | State DOTs |
| North Dakota, South Dakota, Nebraska, Kansas | State DOTs |
| Minnesota, Iowa, Wisconsin, Illinois, Missouri | State DOTs |
| Georgia, Louisiana, Kentucky, Arkansas | State DOTs |
| New York, Ohio, Maryland, Delaware | State DOTs |

## iOS App

A native iOS companion app lives in `ios/TripCams/`. Built with SwiftUI, it mirrors the web app's single-screen design: full-screen MapKit map, glassmorphic route picker overlay, draggable bottom sheet with camera cards, and a hero-animated image modal. Shares the same camera API sources and route data as the web app.

Open `ios/TripCams/TripCams.xcodeproj` in Xcode to build and run.

## Tech Stack

- **Vanilla JavaScript** — no frameworks, no bundler, no build step (web)
- **SwiftUI** + **MapKit** — native iOS app
- **Leaflet** + **Leaflet.MarkerCluster** — interactive mapping (web)
- **OSRM** — road geometry for route computation and corridor filtering
- **Photon/Komoot** — geocoding for custom origin/destination search
- **Service Worker** — tiered caching for API responses, images, map tiles (web)
- **GitHub Pages** — automatic deployment via GitHub Actions

## Deployment

Pushes to `main` trigger an automatic GitHub Pages deployment via the workflow in `.github/workflows/deploy.yml`. The site is served at `tripcams.zacharyhalvorson.com` via a custom domain configured in the `CNAME` file.

## License

This project is for personal use. Camera data is provided by the respective provincial and state transportation agencies.
