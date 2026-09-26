#!/usr/bin/env python3
"""Extract CPC soil moisture percentile for Binghamton area."""
import sys, json
from datetime import datetime, timedelta, timezone

LON, LAT = -75.918, 42.099

def emit(val, day):
    if val is None or not (0 <= val <= 100):
        return False
    print(json.dumps({"percentile": round(float(val), 1), "date": day.strftime("%Y-%m-%d")}))
    return True

def sample_rasterio(url):
    import rasterio
    with rasterio.open(url) as ds:
        sample = next(ds.sample([(LON, LAT)], masked=True))[0]
        if getattr(sample, "mask", False):
            return None
        return float(sample)

def sample_gdal(url):
    from osgeo import gdal
    import struct
    ds = gdal.Open("/vsicurl/" + url)
    if ds is None:
        ds = gdal.Open(url)
    if ds is None:
        raise RuntimeError("GeoTIFF could not be opened")
    gt = ds.GetGeoTransform()
    px = int((LON - gt[0]) / gt[1])
    py = int((LAT - gt[3]) / gt[5])
    if px < 0 or py < 0 or px >= ds.RasterXSize or py >= ds.RasterYSize:
        return None
    band = ds.GetRasterBand(1)
    raw = band.ReadRaster(px, py, 1, 1)
    formats = {
        gdal.GDT_Byte: "B", gdal.GDT_UInt16: "H", gdal.GDT_Int16: "h",
        gdal.GDT_UInt32: "I", gdal.GDT_Int32: "i", gdal.GDT_Float32: "f", gdal.GDT_Float64: "d",
    }
    fmt = formats.get(band.DataType)
    if raw is None or fmt is None:
        raise RuntimeError("Soil moisture raster type is unsupported")
    val = float(struct.unpack(fmt, raw)[0])
    nodata = band.GetNoDataValue()
    if nodata is not None and val == float(nodata):
        return None
    return val

readers = []
try:
    import rasterio  # noqa: F401
    readers.append(sample_rasterio)
except ImportError:
    pass
try:
    from osgeo import gdal  # noqa: F401
    readers.append(sample_gdal)
except ImportError:
    pass

if not readers:
    print(json.dumps({"percentile": None, "date": None, "error": "No GeoTIFF reader installed"}))
    sys.exit(0)

found = False
errors = []
for days_ago in range(0, 4):
    day = datetime.now(timezone.utc) - timedelta(days=days_ago)
    url = f"https://ftp.cpc.ncep.noaa.gov/GIS/USDM_Products/soil/percentile/daily/w.rank.{day.strftime('%Y%m%d')}.tif"
    for reader in readers:
        try:
            if emit(reader(url), day):
                found = True
                break
        except Exception as exc:
            errors.append(str(exc))
    if found:
        sys.exit(0)

print(json.dumps({
    "percentile": None,
    "date": None,
    "error": errors[-1] if errors else "No data available",
}))
