""" Srcipt that turns raw datasets into subbasins.csv , plants.csv , subbasins.geojson """
from pathlib import Path
import geopandas as gpd
import numpy as np
import pandas as pd
 
HERE = Path(__file__).resolve().parent
RAW = HERE.parent / "raw"                 
OUT = HERE.parent / "backend" / "data"  
OUT.mkdir(parents=True, exist_ok=True)
 
 
def huc_code(col):
    """Excel stored HUC8 as a number (leading zero lost). Rebuild the 8-digit text code;
    anything that isn't a number (footnote rows) becomes None so it can be dropped."""
    v = pd.to_numeric(col, errors="coerce")
    return v.map(lambda x: f"{int(x):08d}" if pd.notna(x) else None)
 
 # Create subbasin table
print("Reading shapefile (this takes a moment)...")
gdf = gpd.read_file(RAW / "SI_Shapefile.shp")
gdf["huc8"] = gdf["HUC_8"].astype(str).str.zfill(8)
 
sub = pd.DataFrame({
    "huc8": gdf["huc8"],
    "name": gdf["SUBBASIN"],
    "basin": gdf["BASIN"],
    "climate_region": gdf["Region_1"].replace({"0": "Unclassified", "": "Unclassified"}).fillna("Unclassified"),
    "states": gdf["HU_8_STATE"],
    "wf_total": pd.to_numeric(gdf["WF_PCA"]),     
    "cf_total": pd.to_numeric(gdf["CF_PCA"]),      
    "wsf_total": pd.to_numeric(gdf["WSF_PCA"]),    
    "scarcity_cf": pd.to_numeric(gdf["Characteri"]),
})
 
# Electricity per subbasin in data center 
t5 = pd.read_excel(RAW / "Input_data.xlsx", "Table 5", skiprows=2)
t5["huc8"] = huc_code(t5["HUC8 ID"])
t5 = t5.dropna(subset=["huc8"])
t5 = t5.rename(columns={"Scaled Power Consumption (MWh)": "dc_energy_mwh"})
sub = sub.merge(t5[["huc8", "dc_energy_mwh"]], on="huc8", how="left")
sub["dc_energy_mwh"] = sub["dc_energy_mwh"].fillna(0)
 
# Derived  data columns 
sub["wf_direct"] = sub["dc_energy_mwh"] * 1.8
sub["wf_indirect"] = (sub["wf_total"] - sub["wf_direct"]).clip(lower=0)
 
# Table 3 Results 
t3 = pd.read_excel(RAW / "Results.xlsx", "Table 3", skiprows=1)
t3["huc8"] = huc_code(t3["HUC8"])
t3 = t3.dropna(subset=["huc8"])
t3 = t3.rename(columns={"WF_1MW_DC": "wf_per_mwh", "CF_1MW_DC": "cf_per_mwh", "WSF_1MW_DC": "wsf_per_mwh"})
sub = sub.merge(t3[["huc8", "wf_per_mwh", "cf_per_mwh", "wsf_per_mwh"]], on="huc8", how="left")
 
# Plant table
p = pd.read_excel(RAW / "Input_data.xlsx", "Table 2", skiprows=2)
plants = pd.DataFrame({
    "plant_id": p["Plant Id"],
    "name": p["Plant name"],
    "fuel": p["Plant primary fuel code"].replace({"OTHF": "OTHER", "OFSL": "OTHER"}),
    "lon": p["Longitude"].round(4),
    "lat": p["Latitude"].round(4),
    "gen_mwh": p["Net generation (MWh)"].clip(lower=0),
    "co2_t": p["CO2-e Emission (tons)"].clip(lower=0),
    "water_m3": p["Water Consumption (m3)"].clip(lower=0),
    "huc8": huc_code(p["HUC8 ID"]),
})
 
# script writting checks
print(f"subbasins: {len(sub)}   duplicate HUC8s: {sub['huc8'].duplicated().sum()}")
print("missing values:\n", sub.isna().sum()[sub.isna().sum() > 0].to_string())
print(f"plants: {len(plants)}   plants whose HUC8 is not on the map: {(~plants['huc8'].isin(sub['huc8'])).sum()}")
print("national totals (paper: water ~5.1e8 m3, carbon ~3.1e7 t):")
print(sub[["dc_energy_mwh", "wf_direct", "wf_indirect", "wf_total", "cf_total", "wsf_total"]].sum().to_string())
print(f"indirect share of water: {sub['wf_indirect'].sum() / sub['wf_total'].sum():.0%}  (paper: ~75%)")
 
# Write the tables
sub.round(4).to_csv(OUT / "subbasins.csv", index=False)
plants.to_csv(OUT / "plants.csv", index=False)
 
# Use light GeoJSON for the map
print("Simplifying shapes...")
shapes = gdf[["huc8", "geometry"]].copy()
shapes["geometry"] = shapes.simplify(5000, preserve_topology=True) 
shapes = shapes.to_crs(epsg=4326)                                   
geo_path = OUT / "subbasins.geojson"

# Make sure GeoJSON driver won't overwrite any files 
geo_path.unlink(missing_ok=True)                               
shapes.to_file(geo_path, driver="GeoJSON", COORDINATE_PRECISION=3)
print(f"wrote {geo_path} ({geo_path.stat().st_size / 1e6:.1f} MB)")
print("Done. Files are in", OUT)
