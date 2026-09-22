# Floodwatch v4.0

## September 22, 2026

### Reliability
- Replace hard-coded alert/news reports with live NWS alerts for Broome, Tioga, Chenango and Delaware counties, NY.
- Replace guessed ensemble bands and unvalidated risk/similarity scores with official NOAA NWPS forecasts for Conklin, Vestal, Chenango Forks and Waverly.
- Load stage thresholds from official station metadata. No hard-coded fallback is shown.
- Correct the regional radar bounding box and resolve forecast grid coordinates from the Binghamton point endpoint.
- Use source observation/issue times, distinguish unavailable, stale and partial feeds, and retain failure information on cached responses.
- Count only current gauge observations in summary metrics. A failed alert feed never becomes “no alerts.”
- Calculate rainfall-window totals from validTime interval overlap rather than summing expired precipitation periods.
- Stop inferring reservoir storage volume from pool elevation.
- Retain groundwater and CPC soil-moisture context without making basin-wide saturation claims.
- Make camera extraction and soil processing asynchronous; add upstream timeouts and reject missing soil raster values.
- Retire legacy `/api/ensemble` and `/api/predictive-outlook` with explicit unavailable responses.

### Interface
- Six dashboard sections, responsive at 375px, with system-aware light/dark themes.
- Session watchlists, station search, river filters and CSV export of filtered gauges.
- Observation charts with 24/72-hour windows and official forecast station selection.
- Auto-refresh pause/resume and explicit offline states.
- Source-health panel, camera snapshot/offline labels, and preserved scanner/community panels.
- Self-hosted IBM Plex fonts, accessible controls and reduced-motion support.

### Build and verification
- TypeScript check and six regression tests pass.
- Production build passes; HTML uses Brotli compression and hashed assets use immutable caching.
- Local mobile Lighthouse initial run: performance 96, LCP 1.7s, CLS 0.01, TBT 190ms.
- Desktop/mobile interaction checks cover filters, watchlists, CSV, forecast switching, themes, camera controls and failure states.
- Compatible dependency updates plus Drizzle ORM security update applied. One low-severity development-only nested esbuild advisory remains in the dependency audit.
- This is a local lab measurement, not a claim about deployed Railway performance.

### Operational limitations
- Watchlists are session-only and reset on reload.
- Third-party camera images may show provider-offline graphics even after successful retrieval. Snapshot retrieval does not establish capture freshness.
- Soil extraction requires optional rasterio; missing upstream data remains unavailable.
- NOAA/NWS/USGS are the authoritative providers. This independent site is not an emergency warning service.

Data interfaces: [NOAA NWPS documentation](https://api.water.noaa.gov/nwps/v1/docs/), [NWS API](https://www.weather.gov/documentation/services-web-api), [USGS Water Services](https://waterservices.usgs.gov/).
