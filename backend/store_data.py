# load data into main 
from pathlib import Path
import numpy as np, pandas as pd

# Access data and load tables 
DATA = Path(__file__).parent / "data"
subbasins = pd.read_csv(DATA / "subbasins.csv", dtype={"huc8": str})  
plants = pd.read_csv(DATA / "plants.csv", dtype={"huc8": str})
GEOJSON_PATH = DATA / "subbasins.geojson"

# Get each watersheds dominanat fuel source 
gen = plants.groupby(["huc8", "fuel"])["gen_mwh"].sum().reset_index()
# Add up generation per watershed per fuel source 
dom = gen.sort_values("gen_mwh", ascending=False).drop_duplicates("huc8")
# Add to watershed table 
subbasins = subbasins.merge(dom[["huc8", "fuel"]].rename(columns={"fuel": "dominant_fuel"}),
                            on="huc8", how="left")
subbasins["dominant_fuel"] = subbasins["dominant_fuel"].fillna("NO PLANTS")

def clean(df):
    return df.replace({np.nan: None}).to_dict(orient="records") 

# Add in metrics catalogue 
METRICS = [
    {"key": "wf_total", "label": "Total water footprint", "unit": "m³/yr", "agg": "sum",
     "help": "Direct + indirect water consumed in this subbasin."},
    {"key": "cf_per_mwh", "label": "Siting: carbon per MWh", "unit": "t CO₂-eq/MWh", "agg": "median",
     "help": "Carbon intensity of a new 1 MW data center here."},
] 

# Group table metrics 
def aggregate(by, metric):
    agg = next(m["agg"] for m in METRICS if m["key"] == metric)
    g = subbasins.groupby(by)[metric]
    vals = g.sum() if agg == "sum" else g.median()
    return [{"group": k, "value": float(v)} for k, v in vals.items()]