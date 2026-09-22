#!/usr/bin/env python3
"""Extract CPC soil moisture percentile for Binghamton area."""
import sys, json
try:
    import rasterio
    from datetime import datetime, timedelta
    for days_ago in range(0, 4):
        d = datetime.utcnow() - timedelta(days=days_ago)
        url = f"https://ftp.cpc.ncep.noaa.gov/GIS/USDM_Products/soil/percentile/daily/w.rank.{d.strftime('%Y%m%d')}.tif"
        try:
            with rasterio.open(url) as ds:
                row, col = ds.index(-75.918, 42.099)
                val = float(ds.read(1)[row, col])
                print(json.dumps({"percentile": round(val, 1), "date": d.strftime('%Y-%m-%d')}))
                sys.exit(0)
        except Exception:
            continue
    print(json.dumps({"percentile": None, "date": None, "error": "No data available"}))
except ImportError:
    print(json.dumps({"percentile": None, "date": None, "error": "rasterio not installed"}))
except Exception as e:
    print(json.dumps({"percentile": None, "date": None, "error": str(e)}))
