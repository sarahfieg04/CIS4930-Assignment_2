# Where does a data center's footprint land?

An interactive dashboard of the water and carbon footprints of U.S. data centers (2018), mapped to the
2,106 HUC8 watersheds of the contiguous United States.

**Question:** Is the cleanest place to plug in a server also a place where clean water is, and where
do the footprints of today's data centers actually land?

The site runs on **localhost** (it is not deployed). Use the commands below to start it.

## Get the code

Source repository: https://github.com/sarahfieg04/CIS4930-Assignment_2

```bash
git clone https://github.com/sarahfieg04/CIS4930-Assignment_2.git
cd CIS4930-Assignment_2
```

Or unzip the submitted project folder and open a terminal inside it. All commands below are run from
that top-level folder.

## Project structure

```
CIS4930-Assignment_2/
├── README.md
├── .gitignore               # keeps raw/, and notebook checkpoints out of Git
├── data_prep/
│   └── prepare_data.py      # one-time cleaning script : raw files -> backend/data/
├── backend/
│   ├── main.py              # FastAPI routes
│   ├── store.py             # loads the data once
│   ├── requirements.txt
│   └── data/                # cleaned data 
│       ├── subbasins.csv
│       ├── plants.csv
│       └── subbasins.geojson
└── frontend/
    ├── index.html
    ├── css/styles.css
    └── js/script.js
```

## Requirements

- Python 3.10 or newer
- An internet connection in the browser (D3.js v7 is loaded from the jsDelivr CDN)
- No API keys or other credentials are needed

## How to run (two terminals)

### 1. Backend, port 8000

With conda:

```bash
conda create -n a2 python=3.11 -y
conda activate a2
cd backend
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Or with a plain virtual environment:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Check it works: open **http://localhost:8000/docs** (interactive API docs). The terminal should say
`Application startup complete.` Leave this terminal open.

### 2. Frontend, port 5173

In a second terminal:

```bash
cd frontend
python -m http.server 5173
```

Then open **http://localhost:5173** in a browser.

Do not open `index.html` by double-clicking it (`file://`): the browser blocks `fetch` from file pages.
If the page says it could not reach the API, the backend in terminal 1 is not running.

The API address is set in one constant at the top of `frontend/js/script.js`:
`const API_BASE = "http://localhost:8000";`

## API endpoints

| Endpoint | Returns | Used by |
|---|---|---|
| `GET /api/meta` | metric list (label, unit, sum or median) and fuel order | dropdown, bar charts |
| `GET /api/subbasins` | one row per subbasin (2,106) with every metric | all views |
| `GET /api/plants` | 8,403 power plants (optional `?fuel=COAL`) | fuel bars |
| `GET /api/geo` | simplified subbasin shapes (GeoJSON, lon/lat) | map |
| `GET /api/aggregate?by=climate_region&metric=...` | national sum or median per climate region | region bars |
| `GET /api/subbasin/{huc8}` | one subbasin's values (404 if unknown) | details panel |

## Rebuilding the data (optional)

`backend/data/` already contains the cleaned files, so this step is not needed to run the dashboard.

The raw dataset is about 340 MB (over GitHub's 100 MB file limit), so it is **not included** in the
repository or the ZIP; `raw/` is listed in `.gitignore`. To rebuild:

1. Download the dataset from https://doi.org/10.7294/14504913 and put these files in a folder named
   `raw/` next to `data_prep/`: `SI_Shapefile.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`, `Input_data.xlsx`,
   `Results.xlsx`.
2. Install the extra packages and run the script:

```bash
pip install pandas numpy openpyxl geopandas
cd data_prep
python prepare_data.py
```

The script joins the shapefile attributes with the Excel tables by HUC8 code, restores the codes' leading
zeros, drops footnote rows, computes direct (data-center electricity × 1.8 m³/MWh) and indirect water,
simplifies the shapes (5 km) and converts them to longitude/latitude. It prints checks: 2,106 subbasins,
0 duplicates, and national totals matching the paper (water ≈ 5.07 × 10⁸ m³, carbon ≈ 3.09 × 10⁷ t CO₂-eq,
about 75% of the water footprint indirect).

## Using the dashboard

- **Map metric** dropdown: changes the map colors, the region bars and what the fuel chart measures.
- **Map (A):** hover for values, scroll to zoom, click a subbasin to select it (Shift-click to add more).
- **Scatter (B):** each dot is a subbasin, placed by the carbon and water-scarcity footprint per MWh of a
  hypothetical new data center there. Drag a rectangle to brush; click empty space to clear.
- **Region bars (C)** and **Fuel bars (D):** click a bar to filter every other view; click again to clear.
- **Filter chips** under the title show every active filter; × removes one. **Reset all** clears everything.

## Data source

Siddik, M. A. B., Shehabi, A., & Marston, L. T. (2021). The environmental footprint of data centers in the
United States. *Environmental Research Letters*, 16(6), 064017. https://doi.org/10.1088/1748-9326/abfba1

Dataset: Siddik, Shehabi & Marston, *The environmental footprint of data centers in the United States*,
University Libraries, Virginia Tech. https://doi.org/10.7294/14504913 (CC0).

Built with D3.js v7, FastAPI, pandas and geopandas.
