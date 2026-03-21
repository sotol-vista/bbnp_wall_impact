const TILE_BUST = Date.now().toString();

const CONFIG = {
  center: [-103.31388, 29.21967],
  zoom: 11,
  maxZoom: 17,
  minZoom: 8,

  data: {
    wall: "./data/wall_proposed.geojson",
    riparian: "./data/riparian_corridor.geojson",
    poi: "./data/points_of_interest.geojson",
    crossings: "./data/potential_crossings.geojson",
    watersheds: "./data/watersheds_adjacent.geojson"
  },

  viewshedTiles: `./tiles/viewshed/{z}/{x}/{y}.png?v=${TILE_BUST}`,
  lightTiles: `./tiles/light_from_wall/{z}/{x}/{y}.png?v=${TILE_BUST}`
};

const state = {
  rankField: "RO_Rank",
  selectedWallId: null
};

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors"
      },
      wall: {
        type: "geojson",
        data: CONFIG.data.wall
      },
      riparian: {
        type: "geojson",
        data: CONFIG.data.riparian
      },
      poi: {
        type: "geojson",
        data: CONFIG.data.poi
      },
      crossings: {
        type: "geojson",
        data: CONFIG.data.crossings
      },
      watersheds: {
        type: "geojson",
        data: CONFIG.data.watersheds
      },
      viewshed: {
        type: "raster",
        tiles: [CONFIG.viewshedTiles],
        tileSize: 256,
        minzoom: 10,
        maxzoom: 14
      },
      lightFromWall: {
        type: "raster",
        tiles: [CONFIG.lightTiles],
        tileSize: 256,
        minzoom: 10,
        maxzoom: 14
      }
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm"
      },
      {
        id: "viewshed",
        type: "raster",
        source: "viewshed",
        paint: {
          "raster-opacity": 0.45
        }
      },
      {
        id: "light-from-wall",
        type: "raster",
        source: "lightFromWall",
        paint: {
          "raster-opacity": 0.75
        },
        layout: {
          visibility: "none"
        }
      },
      {
        id: "watersheds-line",
        type: "line",
        source: "watersheds",
        paint: {
          "line-color": "#4c4c4c",
          "line-width": 2.2,
          "line-opacity": 0.85
        }
      },
      {
        id: "riparian-fill",
        type: "fill",
        source: "riparian",
        paint: {
          "fill-color": "#77a879",
          "fill-opacity": 0.18
        }
      },
      {
        id: "riparian-outline",
        type: "line",
        source: "riparian",
        paint: {
          "line-color": "#5d875e",
          "line-width": 1.2,
          "line-opacity": 0.65
        }
      },
      {
        id: "wall-line",
        type: "line",
        source: "wall",
        paint: {
          "line-color": [
            "match",
            ["downcase", ["to-string", ["coalesce", ["get", "RO_Rank"], ""]]],
            "low", "#f1c40f",
            "medium", "#e67e22",
            "high", "#c0392b",
            "#888888"
          ],
          "line-width": 4
        }
      },
      {
        id: "wall-highlight",
        type: "line",
        source: "wall",
        filter: ["==", ["get", "ID"], "__none__"],
        paint: {
          "line-color": "#00e5ff",
          "line-width": 8,
          "line-opacity": 0.9
        }
      },
      {
        id: "crossings-circle",
        type: "circle",
        source: "crossings",
        paint: {
          "circle-radius": 5,
          "circle-color": "#111111",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.2
        }
      }
    ]
  },
  center: CONFIG.center,
  zoom: CONFIG.zoom,
  minZoom: CONFIG.minZoom,
  maxZoom: CONFIG.maxZoom
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

map.on("load", async () => {
  addTriangleIcons();
  addPoiLayers();

  wireUi();
  await fitToWall();

  updateWallColoring();
  updatePoiSummary();
  addInteractions();
});

function addPoiLayers() {
  const poiLayerDefs = [
    { id: "poi-triangle-poi", typeValue: "POI", icon: "triangle-poi" },
    { id: "poi-triangle-th", typeValue: "TH", icon: "triangle-th" },
    { id: "poi-triangle-camp", typeValue: "CAMP", icon: "triangle-camp" },
    { id: "poi-triangle-trib", typeValue: "TRIB", icon: "triangle-trib" },
    { id: "poi-triangle-rafting", typeValue: "RAFTING", icon: "triangle-rafting" }
  ];

  poiLayerDefs.forEach((def) => {
    if (map.getLayer(def.id)) return;

    map.addLayer({
      id: def.id,
      type: "symbol",
      source: "poi",
      filter: ["==", ["get", "Type"], def.typeValue],
      layout: {
        "icon-image": def.icon,
        "icon-size": 1,
        "icon-allow-overlap": true
      }
    });
  });
}

function addTriangleIcons() {
  const colors = {
    "triangle-poi": "navy",
    "triangle-th": "forestgreen",
    "triangle-camp": "orange",
    "triangle-trib": "deepskyblue",
    "triangle-rafting": "mediumspringgreen"
  };

  Object.entries(colors).forEach(([name, color]) => {
    if (map.hasImage(name)) return;

    const size = 22;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.beginPath();
    ctx.moveTo(size / 2, 2);
    ctx.lineTo(size - 2, size - 2);
    ctx.lineTo(2, size - 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    const imageData = ctx.getImageData(0, 0, size, size);
    map.addImage(name, {
      width: size,
      height: size,
      data: imageData.data
    });
  });
}

async function fitToWall() {
  const data = await fetch(CONFIG.data.wall).then((r) => r.json());
  const bbox = getGeoJSONBounds(data);

  if (bbox) {
    map.fitBounds(bbox, { padding: 40, duration: 0 });
  }
}

function wireUi() {
  document.getElementById("rankField").addEventListener("change", (e) => {
    state.rankField = e.target.value;
    updateWallColoring();
  });

  document.getElementById("viewshedOpacity").addEventListener("input", (e) => {
    map.setPaintProperty("viewshed", "raster-opacity", Number(e.target.value));
  });

  document.getElementById("lightOpacity").addEventListener("input", (e) => {
    map.setPaintProperty("light-from-wall", "raster-opacity", Number(e.target.value));
  });

  document.getElementById("toggleWatersheds").addEventListener("change", (e) => {
    setLayerVisibility("watersheds-line", e.target.checked);
  });

  document.getElementById("toggleRiparian").addEventListener("change", (e) => {
    setLayerVisibility("riparian-fill", e.target.checked);
    setLayerVisibility("riparian-outline", e.target.checked);
  });

  document.getElementById("toggleWall").addEventListener("change", (e) => {
    setLayerVisibility("wall-line", e.target.checked);
    setLayerVisibility("wall-highlight", e.target.checked);
  });

  document.getElementById("togglePOI").addEventListener("change", (e) => {
    ["poi-triangle-poi", "poi-triangle-th", "poi-triangle-camp", "poi-triangle-trib", "poi-triangle-rafting"]
      .forEach((id) => setLayerVisibility(id, e.target.checked));
  });

  document.getElementById("toggleCrossings").addEventListener("change", (e) => {
    setLayerVisibility("crossings-circle", e.target.checked);
  });

  document.getElementById("toggleViewshed").addEventListener("change", (e) => {
    setLayerVisibility("viewshed", e.target.checked);
  });

  document.getElementById("toggleLightFromWall").addEventListener("change", (e) => {
    setLayerVisibility("light-from-wall", e.target.checked);
  });

  document.getElementById("filterVisiblePOI").addEventListener("change", (e) => {
    applyPoiFilter(e.target.checked);
  });

  document.getElementById("segmentSearch").addEventListener("input", handleSegmentSearch);
}

function addInteractions() {
  map.on("mouseenter", "wall-line", () => {
    map.getCanvas().style.cursor = "pointer";
  });

  map.on("mouseleave", "wall-line", () => {
    map.getCanvas().style.cursor = "";
  });

  map.on("click", "wall-line", (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    selectWallFeature(feature);
  });

  map.on("click", "crossings-circle", (e) => {
    const feature = e.features?.[0];
    if (!feature) return;

    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML("<strong>Potential crossing</strong><br>Potential wildlife crossing blocked by wall.")
      .addTo(map);
  });

  const poiLayers = [
    "poi-triangle-poi",
    "poi-triangle-th",
    "poi-triangle-camp",
    "poi-triangle-trib",
    "poi-triangle-rafting"
  ];

  poiLayers.forEach((layerId) => {
    map.on("click", layerId, (e) => {
      const f = e.features?.[0];
      if (!f) return;

      const p = f.properties;
      const visible = toNumber(p.wall_visible) === 1 ? "Yes" : "No";
      const views = valueOrDash(p.viewshed_mosaic);

      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <strong>${escapeHtml(valueOrDash(p.Name))}</strong><br>
          Type: ${escapeHtml(valueOrDash(p.Type))}<br>
          Wall visible: ${visible}<br>
          Viewshed value: ${views}
        `)
        .addTo(map);
    });

    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  });
}

function selectWallFeature(feature) {
  const p = feature.properties;
  const wallId = p.ID;
  state.selectedWallId = wallId;

  map.setFilter("wall-highlight", ["==", ["get", "ID"], wallId]);

  const featureBounds = getFeatureBounds(feature);
  if (featureBounds) {
    map.fitBounds(featureBounds, { padding: 80, duration: 500 });
  }

  const runoffRank = valueOrDash(p.RO_Rank);
  const riparianRank = valueOrDash(p.Riparian_Rank);
  const runoffAcFtYr = formatNumber(p.RO_acftyr);
  const runoffIntensity = formatNumber(p.RO_acftyr_per_rivermile);
  const riparianAc = formatNumber(p.Riparian_ac);

  document.getElementById("impactCard").classList.remove("empty");
  document.getElementById("impactCard").innerHTML = `
    <div class="pill-row">
      <span class="pill">Segment ${escapeHtml(valueOrDash(wallId))}</span>
      <span class="pill">${escapeHtml(valueOrDash(p.Name_Watershed))}</span>
    </div>

    <div><strong>Connectivity</strong></div>
    <div>Upstream: ${escapeHtml(valueOrDash(p.US_ID))}</div>
    <div>Downstream: ${escapeHtml(valueOrDash(p.DS_ID))}</div>

    <div class="metric-grid">
      <div class="metric">
        <div class="metric-label">Annual runoff</div>
        <div class="metric-value">${runoffAcFtYr}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Runoff intensity</div>
        <div class="metric-value">${runoffIntensity}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Runoff rank</div>
        <div class="metric-value">${runoffRank}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Riparian acres</div>
        <div class="metric-value">${riparianAc}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Riparian rank</div>
        <div class="metric-value">${riparianRank}</div>
      </div>
    </div>

    <p style="margin-top:12px;">
      <strong>Interpretation:</strong>
      ${buildSegmentNarrative(p)}
    </p>
  `;
}

function buildSegmentNarrative(properties) {
  const ro = String(properties.RO_Rank ?? "").toLowerCase();
  const rip = String(properties.Riparian_Rank ?? "").toLowerCase();

  const parts = [];

  if (ro === "high") parts.push("This segment ranks high for runoff-related erosion or flooding concerns.");
  else if (ro === "medium") parts.push("This segment shows moderate runoff-related concern.");
  else if (ro === "low") parts.push("This segment shows relatively low runoff-related concern.");

  if (rip === "high") parts.push("Riparian habitat sensitivity is high here.");
  else if (rip === "medium") parts.push("Riparian habitat sensitivity is moderate here.");
  else if (rip === "low") parts.push("Riparian habitat sensitivity is relatively low here.");

  if (!parts.length) {
    return "Use the map context, watershed boundaries, crossings, POIs, and raster overlays to evaluate this segment.";
  }

  return parts.join(" ");
}

function updateWallColoring() {
  const field = state.rankField;

  map.setPaintProperty("wall-line", "line-color", [
    "match",
    ["downcase", ["to-string", ["coalesce", ["get", field], ""]]],
    "low", "#f1c40f",
    "medium", "#e67e22",
    "high", "#c0392b",
    "#888888"
  ]);
}

function applyPoiFilter(visibleOnly) {
  ["poi-triangle-poi", "poi-triangle-th", "poi-triangle-camp", "poi-triangle-trib", "poi-triangle-rafting"]
    .forEach((layerId) => {
      const mappedType = layerId === "poi-triangle-th" ? "TH"
        : layerId === "poi-triangle-camp" ? "CAMP"
        : layerId === "poi-triangle-trib" ? "TRIB"
        : layerId === "poi-triangle-rafting" ? "RAFTING"
        : "POI";

      if (visibleOnly) {
        map.setFilter(layerId, [
          "all",
          ["==", ["get", "Type"], mappedType],
          ["==", ["to-number", ["coalesce", ["get", "wall_visible"], 0]], 1]
        ]);
      } else {
        map.setFilter(layerId, ["==", ["get", "Type"], mappedType]);
      }
    });

  updatePoiSummary();
}

async function updatePoiSummary() {
  const data = await fetch(CONFIG.data.poi).then((r) => r.json());
  const visibleOnly = document.getElementById("filterVisiblePOI").checked;

  let features = data.features || [];
  if (visibleOnly) {
    features = features.filter((f) => toNumber(f.properties?.wall_visible) === 1);
  }

  const total = features.length;
  const visibleCount = features.filter((f) => toNumber(f.properties?.wall_visible) === 1).length;
  const avgViewshed = average(
    features
      .map((f) => toNumber(f.properties?.viewshed_mosaic))
      .filter((v) => !isNaN(v))
  );

  document.getElementById("poiSummary").innerHTML = `
    <div><strong>Total POIs shown:</strong> ${total}</div>
    <div><strong>POIs with wall visible:</strong> ${visibleCount}</div>
    <div><strong>Average viewshed value:</strong> ${isNaN(avgViewshed) ? "—" : avgViewshed.toFixed(2)}</div>
  `;
}

function handleSegmentSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;

  const features = map.querySourceFeatures("wall");
  const match = features.find((f) => {
    const id = String(f.properties?.ID ?? "").toLowerCase();
    const ws = String(f.properties?.Name_Watershed ?? "").toLowerCase();
    return id.includes(q) || ws.includes(q);
  });

  if (match) {
    selectWallFeature(match);
  }
}

function setLayerVisibility(layerId, visible) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function getGeoJSONBounds(geojson) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function visitCoords(coords) {
    if (!Array.isArray(coords)) return;

    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      minX = Math.min(minX, coords[0]);
      minY = Math.min(minY, coords[1]);
      maxX = Math.max(maxX, coords[0]);
      maxY = Math.max(maxY, coords[1]);
    } else {
      coords.forEach(visitCoords);
    }
  }

  for (const f of geojson.features || []) {
    visitCoords(f.geometry?.coordinates);
  }

  if (!isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

function getFeatureBounds(feature) {
  return getGeoJSONBounds({
    type: "FeatureCollection",
    features: [feature]
  });
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function formatNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function valueOrDash(v) {
  return v === null || v === undefined || v === "" ? "—" : v;
}

function average(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}