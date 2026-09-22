# Floodwatch v4 QA inventory

## Required signoff
- Desktop overview: hierarchy, timestamps, live data and official guidance visible.
- Mobile at 375px: no document overflow; all six sections reachable.
- Light/dark toggle: full round trip, readable charts and statuses.
- Pause/resume automatic refresh; manual refresh fetches without claiming premature success.
- River filters: search, river selection, watchlist toggle, empty state, reset.
- Watchlist: add/remove a station and observe changes on Overview.
- CSV export: filtered rows, source timestamps, freshness, explicit units.
- Gauge details: selected station chart, 24/72-hour control and source link.
- Official forecast: station switch, timestamp, future values only, missing forecast message.
- Cameras: expand/close, traffic expansion, offline and snapshot labels.
- Weather: image tabs, image failure state, expandable forecast/discussion.
- Radio/community: retained controls and third-party failure states.
- Data health: no false current badge when requests or embedded products fail.
- Offline/failed NWS alerts: no “no active alerts” assurance.
- Stale gauge test: stale data cannot be counted as current.
- Backend: typecheck, build, unit tests, compression, asset caching, 404.

## Deliberate exclusions
Third-party availability and radio reception cannot be guaranteed. Data health
checks camera metadata separately from camera images. No synthetic demonstration
values are injected into the delivered application.
