# Trip Cams

**Live highway cameras along your driving route — Calgary to Seattle and beyond.**

**Live site: [https://zacharyhalvorson.github.io/road-trip-cameras/](https://zacharyhalvorson.github.io/road-trip-cameras/)**

Trip Cams is a progressive web app that shows real-time highway camera feeds along popular driving corridors through Alberta, British Columbia, and Washington State. Pick your origin and destination, and instantly see what road conditions look like between here and there.

## Features

- **Three driving corridors** — Northern (Hwy 1 / Coquihalla), Southern (Hwy 3 / Crowsnest), and Lethbridge Spur, covering 20 cities from Calgary to Seattle
- **Live camera feeds** from Alberta 511, DriveBC, and WSDOT, with auto-refresh
- **Interactive map** with clustered markers, satellite view toggle, and route polyline
- **Synced map + list** — scroll the camera list and the map follows, or pan the map and the list scrolls to the nearest camera
- **Works offline** — service worker caches cameras, images, and map tiles so the app stays usable on spotty mountain highway connections
- **Installable PWA** — add to your home screen for a native app experience
- **Light and dark mode** — follows your system preference
- **Geolocation** — detects your position and snaps to the nearest camera
- **Shareable routes** — URL hash encoding lets you share a link to a specific route

## Getting Started

No build tools required. Trip Cams is a static site — just serve the files.

```bash
git clone https://github.com/zacharyhalvorson/road-trip-cameras.git
cd road-trip-cameras

# Use any local HTTP server
python3 -m http.server 8000
# or
npx serve .
```

Then open [http://localhost:8000](http://localhost:8000).

## Project Structure

```
road-trip-cameras/
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
│   ├── route.json        # Route definitions + city stops
│   ├── cameras-ab.json   # Alberta camera fallback data
│   ├── cameras-bc.json   # BC camera fallback data
│   └── cameras-wa.json   # Washington camera fallback data
└── img/                  # Icons, favicon, placeholder
```

## How It Works

1. **Pick a route** — select your origin and destination from the dropdowns
2. **Cameras load** — the app fetches live camera data from provincial/state APIs, filtered to a 25 km corridor along your route using Haversine distance calculations
3. **Browse conditions** — scroll through camera cards or explore the map; views stay synced
4. **Tap a camera** — opens a full-screen modal with optional auto-refresh (every 30 seconds)

Camera data is cached with a stale-while-revalidate strategy: you see cached results immediately while fresh data loads in the background. If APIs are unreachable, bundled fallback data keeps things working.

## Camera Data Sources

| Region | Source | API |
|--------|--------|-----|
| Alberta | [511 Alberta](https://511.alberta.ca) | `511.alberta.ca/api/v2/get/cameras` |
| British Columbia | [DriveBC](https://www.drivebc.ca) | `drivebc.ca/api/webcams/` |
| Washington | [WSDOT](https://wsdot.wa.gov) | `wsdot.wa.gov/Traffic/api/` |

## Tech Stack

- **Vanilla JavaScript** — no frameworks, no bundler, no build step
- **Leaflet** + **Leaflet.MarkerCluster** — interactive mapping
- **Service Worker** — tiered caching (API responses, images, map tiles)
- **GitHub Pages** — automatic deployment via GitHub Actions

## Deployment

Pushes to `main` or `feature/camera-viewer` trigger an automatic GitHub Pages deployment via the workflow in `.github/workflows/deploy.yml`.

## License

This project is for personal use. Camera data is provided by the respective provincial and state transportation agencies.
