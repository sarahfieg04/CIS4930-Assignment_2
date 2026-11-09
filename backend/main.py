# backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
import store_data

# Create FastAPI App
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Create App endpoints 
@app.get("/api/meta")
def meta():
    return {"metrics": store_data.METRICS,
            "fuels": ["COAL", "GAS", "OIL", "NUCLEAR", "HYDRO", "WIND", "SOLAR", "BIOMASS", "GEOTHERMAL", "OTHER"]}

# Main table 
@app.get("/api/subbasins")
def subbasins():
    return store_data.clean(store_data.subbasins)

# Power Plants 
@app.get("/api/plants")
def plants(fuel: str | None = None):
    out = store_data.plants if not fuel else store_data.plants[store_data.plants["fuel"] == fuel]
    return store_data.clean(out)

# Map Shapes 
@app.get("/api/geo")
def geo():
    return FileResponse(store_data.GEOJSON_PATH, media_type="application/geo+json")

# Calculate totals per region group 
@app.get("/api/aggregate")
def aggregate(by: str = "climate_region", metric: str = "wf_total"):
    return store_data.aggregate(by, metric)

# Find a particular watersheds detail page
@app.get("/api/subbasin/{huc8}")
def subbasin(huc8: str):
    rows = store_data.subbasins[store_data.subbasins["huc8"] == huc8]
    if rows.empty:
        raise HTTPException(404, "not found")
    return store_data.clean(rows)[0]