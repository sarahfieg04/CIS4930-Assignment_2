const API_BASE = "http://localhost:8000";   

const state = {
  metric: "wf_total",
  picked: new Set(),   // map clicks
  brush: null,         // Set of ids inside the scatter brush, or null
  region: null,        // clicked region bar
  fuel: null,          // clicked fuel bar
  focus: null,         // subbasin in the details panel
};

// Load everything in parallel first then start site 
let META, ROWS, BY_ID, PLANTS, GEO;

function setState(patch) {
  Object.assign(state, patch);
  draw();
}

// Check if this subbasin in the selection
function passes(r, except = null) {
  if (except !== "region" && state.region && r.climate_region !== state.region) return false;
  if (except !== "fuel" && state.fuel && r.dominant_fuel !== state.fuel) return false;
  if (except !== "brush" && state.brush && !state.brush.has(r.huc8)) return false;
  if (state.picked.size && !state.picked.has(r.huc8)) return false;
  return true;
}

function draw() {
  const activeIds = new Set(ROWS.filter(r => passes(r)).map(r => r.huc8));
  renderFilterBar(activeIds);
  MapView.update(activeIds);
  Scatter.update(activeIds);  
   Regions.update();           
   Fuels.update();             
   Details.update();        
}

async function getJSON(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`${res.status} for ${path}`);
  return res.json();
}

// tooltip and helpers 
const tooltip = d3.select("#tooltip");
 
function showTip(event, html) {
  tooltip.html(html).attr("hidden", null)
    .style("left", event.clientX + 14 + "px")
    .style("top", event.clientY + 14 + "px");
}
function hideTip() { tooltip.attr("hidden", true); }
 
const fmt = d3.format(".3~s");                        
const metricInfo = key => META.metrics.find(m => m.key === key);
 
// Fix shape in geopandas 
function fixWinding(geo) {
  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      if (d3.geoArea({ type: "Polygon", coordinates: poly }) > 2 * Math.PI) {
        poly.forEach(ring => ring.reverse());
      }
    }
  }
}

// control settings 
function buildControls() {
  const sel = d3.select("#metric-select");
  sel.selectAll("option").data(META.metrics).join("option")
    .attr("value", d => d.key).text(d => d.label);
  sel.property("value", state.metric)
    .on("change", async e => {
      const metric = e.target.value;
      await getBaseline(metric);     
      setState({ metric });
    });
 
  d3.select("#reset-btn").on("click", () => {
      Scatter.clearBrush();  
    setState({ picked: new Set(), brush: null, region: null, fuel: null, focus: null }); 
    });
}

// Create View 1: Map 
const MapView = {
  W: 960, H: 590,
 
  init() {
    const svg = d3.select("#map-view").append("svg")
      .attr("viewBox", `0 0 ${this.W} ${this.H}`);
 
    this.projection = d3.geoAlbers().fitSize([this.W, this.H], GEO);
    const path = d3.geoPath(this.projection);
 
    this.g = svg.append("g");
    this.paths = this.g.selectAll("path")
      .data(GEO.features, d => d.properties.huc8)
      .join("path")
      .attr("class", "subbasin")
      .attr("d", path)
      .on("mousemove", (event, d) => {
        const r = BY_ID.get(d.properties.huc8);
        if (!r) return;
        const info = metricInfo(state.metric);
        showTip(event, `<b>${r.name}</b> (${r.states})<br>` +
          `${info.label}: <b>${fmt(r[state.metric] ?? 0)}</b> ${info.unit}`);
      })
      .on("mouseleave", hideTip)
      .on("click", (event, d) => {
        const id = d.properties.huc8;
        const picked = new Set(event.shiftKey ? state.picked : []);
        if (state.picked.has(id) && (event.shiftKey || state.picked.size === 1)) picked.delete(id);
        else picked.add(id);
        setState({ picked, focus: picked.size ? id : null });
      });
 
    this.lastMetric = null;
  },
 
  colorScale(key) {
    const vals = ROWS.map(r => r[key]).filter(v => v > 0).sort(d3.ascending);
    const lo = d3.quantile(vals, 0.02), hi = d3.max(vals);
    this.useLog = hi / lo > 50;
    const blues = t => d3.interpolateBlues(0.15 + 0.85 * t);   
    const scale = this.useLog
      ? d3.scaleSequentialLog([lo, hi], blues)
      : d3.scaleSequential([0, hi], blues);
    return scale.clamp(true);
  },
 
  update(activeIds) {
    const key = state.metric;
 
    if (key !== this.lastMetric) {          
      const color = this.colorScale(key);
      this.paths.transition().duration(400)
        .attr("fill", d => {
          const v = BY_ID.get(d.properties.huc8)?.[key];
          return v > 0 ? color(v) : "#ecebe6";
        });
      this.drawLegend(color, key);
      this.lastMetric = key;
    }
 
    const filtering = state.region || state.fuel || state.brush || state.picked.size;
    this.paths
      .classed("dim", d => filtering && !activeIds.has(d.properties.huc8))
      .classed("picked", d => state.picked.has(d.properties.huc8));
    this.paths.filter(".picked").raise();
  },
 
  drawLegend(scale, key) {
    const info = metricInfo(key);
    const box = d3.select("#map-legend").html("");
    box.append("div").text(`${info.label} (${info.unit})${this.useLog ? ", log scale" : ""}`);
 
    const w = 240;
    const svg = box.append("svg").attr("width", w + 20).attr("height", 34);
    const grad = svg.append("defs").append("linearGradient").attr("id", "legend-grad");
    const [lo, hi] = scale.domain();
    d3.range(0, 1.01, 0.1).forEach(t => grad.append("stop")
      .attr("offset", t)
      .attr("stop-color", scale(this.useLog ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t)));
    svg.append("rect").attr("x", 10).attr("width", w).attr("height", 10)
      .attr("fill", "url(#legend-grad)");
 
    const axis = (this.useLog ? d3.scaleLog() : d3.scaleLinear()).domain([lo, hi]).range([10, 10 + w]);
    svg.append("g").attr("transform", "translate(0,10)")
      .call(d3.axisBottom(axis).ticks(4, "~s"));
  },
};
 
// Create View 2: Scatter Plot 
const Scatter = {
  W: 560, H: 470, m: { t: 14, r: 16, b: 46, l: 58 },
  init() {
// Add in scales, axis, and refrence lines 
    const { W, H, m } = this;
    this.data = ROWS.filter(r => r.cf_per_mwh != null && r.wsf_per_mwh > 0);
    const svg = d3.select("#scatter-view").append("svg").attr("viewBox", `0 0 ${W} ${H}`);

    this.x = d3.scaleLinear().domain([0, d3.max(this.data, d => d.cf_per_mwh)]).nice().range([m.l, W - m.r]);
    this.y = d3.scaleLog().domain(d3.extent(this.data, d => d.wsf_per_mwh)).nice().range([H - m.b, m.t]);

    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(this.x).ticks(6));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(this.y).ticks(5, "~g"));
    // axis titles so the reader knows what x and y mean
    svg.append("text").attr("class", "axis-title")
      .attr("x", (m.l + W - m.r) / 2).attr("y", H - 8).attr("text-anchor", "middle")
      .text("Carbon per MWh of a new data center here (t CO₂-eq / MWh) →");
    svg.append("text").attr("class", "axis-title")
      .attr("transform", `translate(14,${(H - m.b + m.t) / 2}) rotate(-90)`).attr("text-anchor", "middle")
      .text("Water scarcity footprint per MWh (m³ US-eq, log) →");

    // national medians split the plot into quadrants
    const mx = d3.median(this.data, d => d.cf_per_mwh);
    const my = d3.median(this.data, d => d.wsf_per_mwh);
    svg.append("line").attr("class", "ref-line")
      .attr("x1", this.x(mx)).attr("x2", this.x(mx)).attr("y1", m.t).attr("y2", H - m.b);
    svg.append("line").attr("class", "ref-line")
      .attr("x1", m.l).attr("x2", W - m.r).attr("y1", this.y(my)).attr("y2", this.y(my));
    svg.append("text").attr("class", "quadrant").attr("x", m.l + 6).attr("y", H - m.b - 8).text("Low carbon · low water stress");
    svg.append("text").attr("class", "quadrant").attr("x", W - m.r - 6).attr("y", m.t + 12)
      .attr("text-anchor", "end").text("High on both");

// Add in brush tool 
       this.brush = d3.brush()
      .extent([[m.l, m.t], [W - m.r, H - m.b]])
      .on("brush end", e => this.onBrush(e));
    this.brushG = svg.append("g").call(this.brush);

    this.dots = svg.append("g").selectAll("circle")
      .data(this.data, d => d.huc8)
      .join("circle")
      .attr("class", "dot active").attr("r", 3.2)
      .attr("cx", d => this.x(d.cf_per_mwh))
      .attr("cy", d => this.y(d.wsf_per_mwh))
      .on("mousemove", (event, d) => showTip(event,
        `<b>${d.name}</b> (${d.states})<br>` +
        `Carbon: <b>${d.cf_per_mwh.toFixed(2)}</b> t CO₂-eq/MWh<br>` +
        `Water scarcity: <b>${fmt(d.wsf_per_mwh)}</b> m³ US-eq/MWh`))
      .on("mouseleave", hideTip)
      .on("click", (e, d) => setState({ picked: new Set([d.huc8]), focus: d.huc8 }));

    // message shown when no dot matches the filters
    this.empty = d3.select("#scatter-view").append("div").attr("class", "empty")
      .text("No subbasin matches every filter. Remove a filter to see points again.")
      .style("display", "none");
  },
// Create a set of ids for each state 
  onBrush(e) {
    if (!e.selection) { cancelAnimationFrame(this.raf); this.raf = null; setState({ brush: null }); return; }  
    const [[x0, y0], [x1, y1]] = e.selection;
    const ids = new Set(this.data.filter(d => {
      const cx = this.x(d.cf_per_mwh), cy = this.y(d.wsf_per_mwh);
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    }).map(d => d.huc8));
    // redraw at most once per screen frame so dragging stays smooth
    this.pending = ids;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = null; setState({ brush: this.pending }); });
  },
  clearBrush() { this.brushG.call(this.brush.move, null); },   

  update(activeIds) {
    const filtering = state.region || state.fuel || state.brush || state.picked.size;
    this.dots.attr("class", d => "dot " +
      (state.picked.has(d.huc8) ? "picked" : (!filtering || activeIds.has(d.huc8)) ? "active" : "inactive"));
    this.dots.filter(".active").raise();     
    // show the empty message when nothing matches
    const any = this.data.some(d => activeIds.has(d.huc8));
    this.empty.style("display", any ? "none" : null);
  },
};

// Create View 3: Bar Chart 
function makeBars(sel, { W = 440, rowH = 24, labelW = 128, onClick }) {
  d3.select(sel).style("position", "relative");
  const key = d3.select(sel).append("div").attr("class", "key");          // legend line above the bars
  const svg = d3.select(sel).append("svg");
  const x = d3.scaleLinear().range([labelW, W - 52]);
  const empty = d3.select(sel).append("div").attr("class", "empty").style("display", "none");

  function draw(rows, { chosen, max, fmtValue = fmt, keyHtml = "" }) {
    key.html(keyHtml);
    svg.attr("viewBox", `0 0 ${W} ${rows.length * rowH + 8}`);
    x.domain([0, max || 1]);
    const g = svg.selectAll("g.bar-row").data(rows, d => d.key).join(enter => {
      const r = enter.append("g").attr("class", "bar-row");
      r.append("rect").attr("class", "bar-hit");          // invisible full-width area: easier to click/hover
      r.append("rect").attr("class", "bar-ghost");
      r.append("rect").attr("class", "bar-fill");
      r.append("line").attr("class", "bar-tick");
      r.append("text").attr("class", "bar-label");
      r.append("text").attr("class", "bar-value");
      return r;
    });
    g.attr("transform", (d, i) => `translate(0,${i * rowH})`)
     .classed("chosen", d => d.key === chosen)
     .classed("unchosen", d => chosen && d.key !== chosen)
     .on("click", (e, d) => onClick(d.key))
     .on("mousemove", (e, d) => showTip(e, d.tip))
     .on("mouseleave", hideTip);
    g.select(".bar-hit").attr("width", W).attr("height", rowH - 2);
    g.select(".bar-label").attr("x", labelW - 8).attr("y", rowH / 2 + 4)
     .attr("text-anchor", "end").text(d => d.label);
    g.select(".bar-ghost").attr("x", labelW).attr("y", 4).attr("height", rowH - 10)
     .attr("width", d => d.ghost == null ? 0 : x(d.ghost) - labelW);
    g.select(".bar-fill").transition().duration(350)         
     .attr("x", labelW).attr("y", 4).attr("height", rowH - 10)
     .attr("width", d => Math.max(0, x(d.value) - labelW));
    g.select(".bar-tick").attr("x1", d => x(d.tick ?? 0)).attr("x2", d => x(d.tick ?? 0))
     .attr("y1", 2).attr("y2", rowH - 4).style("opacity", d => d.tick == null ? 0 : 1);
    // value printed just past the longest mark in the row
    g.select(".bar-value").attr("y", rowH / 2 + 3)
     .attr("x", d => Math.max(x(d.value), d.ghost != null ? x(d.ghost) : 0, d.tick != null ? x(d.tick) : 0) + 5)
     .text(d => fmtValue(d.value));
  }
  return { draw, empty };
}
// Create Climate regions on bar chart 
const Regions = {
  init() {
    this.chart = makeBars("#region-view", {
      onClick: k => setState({ region: state.region === k ? null : k }),   
    });
  },
  async update() {
    const key = state.metric;
    const info = META.metrics.find(m => m.key === key);
    const isSum = info.agg === "sum";
    const base = await getBaseline(key);              
    const rows = ROWS.filter(r => passes(r, "region")); 
    const sel = d3.rollup(rows,
      v => isSum ? d3.sum(v, r => r[key]) : d3.median(v, r => r[key]),
      r => r.climate_region);
    const num = v => Math.abs(v) < 10 ? d3.format(".2~f")(v) : fmt(v);   // 0.70 instead of "700m"
    const filtering = state.picked.size || state.brush || state.fuel;
    const data = [...base.keys()].map(g => ({
      key: g, label: g, value: sel.get(g) ?? 0,
      ghost: isSum ? base.get(g) : null,    
      tick:  isSum ? null : base.get(g),    
      tip: `<b>${g}</b><br>${info.label}<br>` +
           `${filtering ? "Selection" : "All subbasins"}: <b>${num(sel.get(g) ?? 0)}</b> ${info.unit}<br>` +
           `National: ${num(base.get(g))} ${info.unit}`,
    }));
    const max = d3.max(data, d => Math.max(d.value, d.ghost ?? 0, d.tick ?? 0));
    this.chart.draw(data, {
      chosen: state.region, max, fmtValue: num,
      keyHtml: isSum
        ? `<span><i class="sw sel"></i>${filtering ? "Selection" : "All subbasins"}</span>` +
          (filtering ? `<span><i class="sw ghost"></i>Whole region</span>` : "")
        : `<span><i class="sw sel"></i>Median${filtering ? " of selection" : ""}</span><span><i class="sw tick"></i>National median</span>`,
    });
    this.chart.empty.style("display", rows.length ? "none" : null).text("No subbasins match the other filters.");
  },
};

const baselineCache = new Map();
async function getBaseline(metric) {
  if (!baselineCache.has(metric)) {
    const rows = await getJSON(`/api/aggregate?by=climate_region&metric=${metric}`);
    baselineCache.set(metric, new Map(rows.map(d => [d.group, d.value])));
  }
  return baselineCache.get(metric);
}
// Create separate view to specify fuel types
const Fuels = {
  init() {
    this.chart = makeBars("#fuel-view", { labelW: 92,
      onClick: k => setState({ fuel: state.fuel === k ? null : k }) });
  },
  update() {
    const field = state.metric.startsWith("cf") ? "co2_t"
                : state.metric === "dc_energy_mwh" ? "gen_mwh" : "water_m3";
    const ids = new Set(ROWS.filter(r => passes(r, "fuel")).map(r => r.huc8));
    const what = { co2_t: "CO₂ emitted", gen_mwh: "electricity generated", water_m3: "water consumed" }[field];
    const selPlants = PLANTS.filter(p => ids.has(p.huc8));
    const selBy = d3.rollup(selPlants, v => d3.sum(v, p => p[field]), p => p.fuel);
    const natBy = d3.rollup(PLANTS, v => d3.sum(v, p => p[field]), p => p.fuel);
    const selTot = d3.sum(selBy.values()) || 1, natTot = d3.sum(natBy.values());
    const pct = d3.format(".0%");
    const data = META.fuels.map(f => {
      const value = (selBy.get(f) || 0) / selTot, tick = (natBy.get(f) || 0) / natTot;
      const label = f[0] + f.slice(1).toLowerCase();      // COAL -> Coal
      return { key: f, label, value, ghost: null, tick,
        tip: `<b>${label}</b>: share of ${what}<br>Selection: <b>${pct(value)}</b><br>Nationally: ${pct(tick)}` };
    });
    this.chart.draw(data, {
      chosen: state.fuel, fmtValue: pct, max: d3.max(data, d => Math.max(d.value, d.tick)),
      keyHtml: `<span>Share of ${what} (${selPlants.length.toLocaleString()} plants)</span>` +
               `<span><i class="sw sel"></i>Selection</span><span><i class="sw tick"></i>Nationally</span>`,
    });
    this.chart.empty.style("display", selPlants.length ? "none" : null)
      .text(ids.size ? "No power plants in the selected subbasins." : "No subbasins match the other filters.");
  },
};

//Create Details Panel 
const detailCache = new Map();
const Details = {
  async update() {
    const box = d3.select("#detail-view");
    const id = state.focus;
    if (!id) {                                         
      const active = ROWS.filter(r => passes(r));
      const share = k => d3.sum(active, r => r[k]) / d3.sum(ROWS, r => r[k]);
      box.html(`<p>${d3.format(".0%")(share("dc_energy_mwh"))} of data-center electricity · ` +
               `${d3.format(".0%")(share("cf_total"))} of the carbon footprint</p>`);
      return;
    }
     // add one row per metric, value + percentile bar
    if (!detailCache.has(id)) {
      try { detailCache.set(id, await getJSON(`/api/subbasin/${id}`)); }
      catch (err) { box.html(`<p>Could not load details: ${err.message}</p>`); return; }
    }
    if (state.focus !== id) return;                 
    const d = detailCache.get(id);
    box.html(`<h3>${d.name}</h3><p>${d.states} · ${d.climate_region}</p>`);
  },
};

// Add in filter bar settings 
function renderFilterBar(active) {
  const chips = [];
  if (state.brush)  chips.push({ label: `Brush: ${state.brush.size}`, clear: () => { Scatter.clearBrush(); setState({ brush: null }); } });
  if (state.region) chips.push({ label: `Region: ${state.region}`, clear: () => setState({ region: null }) });
  if (state.fuel)   chips.push({ label: `Fuel: ${state.fuel}`,     clear: () => setState({ fuel: null }) });
  if (state.picked.size) chips.push({ label: `Map: ${state.picked.size}`, clear: () => setState({ picked: new Set(), focus: null }) });
   const bar = d3.select("#filter-bar").html(`<b>${active.size}</b> of ${ROWS.length} selected `);
  bar.selectAll("span.chip").data(chips).join("span").attr("class", "chip").text(d => d.label + " ")
     .append("button").text("×").on("click", (e, d) => d.clear());
}

// launch 
async function init() {
  try {
    [META, ROWS, GEO, PLANTS] = await Promise.all([
      getJSON("/api/meta"), getJSON("/api/subbasins"), getJSON("/api/geo"), getJSON("/api/plants"),
    ]);
  } catch (err) {
    d3.select("#map-view").html(
      `<p style="color:#a3261f">Could not reach the API at ${API_BASE}. Is uvicorn running?<br>${err.message}</p>`);
    console.error(err);
    return;
  }
  fixWinding(GEO);
  console.log(ROWS.length, PLANTS.length, GEO.features.length);   // 2106 8403 2106
  BY_ID = new Map(ROWS.map(r => [r.huc8, r]));

  buildControls();
  MapView.init();
  Scatter.init();   
  Regions.init();   
  Fuels.init();
  await getBaseline(state.metric);        
  draw();
}
init();   // keep this as the LAST line of the file
