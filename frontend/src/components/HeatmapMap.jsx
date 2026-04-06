/**
 * HeatmapMap.jsx
 * ─────────────────────────────────────────────────────────
 * Professional GIS-grade crime heatmap using MapLibre GL JS.
 * Renders a smooth weather-style density overlay on a dark map
 * with district boundaries, numeric labels, and warning markers.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";
import "./HeatmapMap.css";

const API_KEY = "jYCiT4YmtkMVvqlo7hnB";

const DARK_STYLE = `https://api.maptiler.com/maps/darkmatter/style.json?key=${API_KEY}`;

const TN_CENTER = [78.7047, 10.7905]; // [lng, lat]

function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  if (filters.year) params.append("year", filters.year);
  if (filters.district) params.append("district", filters.district);
  if (filters.category) params.append("category", filters.category);
  return params.toString();
}

export default function HeatmapMap({ filters = {}, onDistrictClick }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);
  const tooltipRef = useRef(null);

  const [geoData, setGeoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [tooltip, setTooltip] = useState(null);

  // Layer visibility
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);

  // ── Fetch GeoJSON data ──────────────────────────────────
  const fetchData = useCallback(async () => {
    const query = buildQuery(filters);
    const url = `http://localhost:8000/api/heatmap/geojson${query ? `?${query}` : ""}`;
    setLoading(true);
    try {
      const res = await axios.get(url);
      setGeoData(res.data);
    } catch (err) {
      console.error("Heatmap data error:", err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Initialize map ──────────────────────────────────────
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      center: TN_CENTER,
      zoom: 6.8,
      pitch: 0,
      bearing: 0,
      antialias: true,
      attributionControl: true,
    });

    map.current.addControl(
      new maplibregl.NavigationControl({ showCompass: true }),
      "bottom-right"
    );

    map.current.on("load", () => setMapReady(true));

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // ── Render layers when data + map are ready ─────────────
  useEffect(() => {
    if (!map.current || !mapReady || !geoData) return;

    const m = map.current;

    // Clean up existing sources / layers
    const layerIds = [
      "heatmap-layer",
      "heatmap-layer-glow",
      "boundaries-fill",
      "boundaries-line",
    ];
    layerIds.forEach((id) => {
      if (m.getLayer(id)) m.removeLayer(id);
    });
    ["heatmap-source", "boundaries-source"].forEach((id) => {
      if (m.getSource(id)) m.removeSource(id);
    });

    // Clean up markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // ── 1. HEATMAP LAYER ───────────────────────────────────
    m.addSource("heatmap-source", {
      type: "geojson",
      data: geoData.points,
    });

    // Subtle glow underlayer
    m.addLayer({
      id: "heatmap-layer-glow",
      type: "heatmap",
      source: "heatmap-source",
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["get", "intensity"],
          0, 0,
          0.5, 0.6,
          1, 1,
        ],
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5, 0.6,
          9, 1.8,
          12, 3,
        ],
        "heatmap-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5, 50,
          8, 70,
          11, 90,
          14, 120,
        ],
        "heatmap-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5, 0.35,
          9, 0.25,
          14, 0.15,
        ],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, "rgba(0, 0, 0, 0)",
          0.1, "rgba(34, 197, 94, 0.2)",
          0.25, "rgba(132, 204, 22, 0.35)",
          0.4, "rgba(234, 179, 8, 0.5)",
          0.6, "rgba(249, 115, 22, 0.65)",
          0.8, "rgba(239, 68, 68, 0.8)",
          1, "rgba(220, 38, 38, 0.95)",
        ],
      },
    });

    // Main heatmap layer (sharper, on top)
    m.addLayer({
      id: "heatmap-layer",
      type: "heatmap",
      source: "heatmap-source",
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["get", "intensity"],
          0, 0,
          0.3, 0.4,
          0.7, 0.8,
          1, 1,
        ],
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5, 0.8,
          8, 1.5,
          11, 2.5,
          14, 4,
        ],
        "heatmap-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5, 28,
          8, 42,
          11, 55,
          14, 70,
        ],
        "heatmap-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5, 0.85,
          9, 0.75,
          14, 0.55,
        ],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, "rgba(0, 0, 0, 0)",
          0.08, "rgba(34, 197, 94, 0.15)",
          0.2, "rgba(74, 222, 128, 0.4)",
          0.35, "rgba(234, 179, 8, 0.55)",
          0.5, "rgba(245, 158, 11, 0.7)",
          0.65, "rgba(249, 115, 22, 0.8)",
          0.8, "rgba(239, 68, 68, 0.9)",
          0.92, "rgba(220, 38, 38, 0.95)",
          1, "rgba(185, 28, 28, 1)",
        ],
      },
    });

    // ── 2. DISTRICT BOUNDARIES ──────────────────────────────
    m.addSource("boundaries-source", {
      type: "geojson",
      data: geoData.regions,
    });

    m.addLayer({
      id: "boundaries-fill",
      type: "fill",
      source: "boundaries-source",
      paint: {
        "fill-color": "rgba(255, 255, 255, 0.03)",
        "fill-opacity": 0.6,
      },
    });

    m.addLayer({
      id: "boundaries-line",
      type: "line",
      source: "boundaries-source",
      paint: {
        "line-color": "rgba(255, 255, 255, 0.25)",
        "line-width": 1.2,
        "line-dasharray": [4, 3],
      },
    });

    // ── 3. DISTRICT LABEL MARKERS ───────────────────────────
    if (geoData.labels?.features) {
      geoData.labels.features.forEach((f) => {
        const el = document.createElement("div");
        el.className = "hm-district-label";
        el.innerHTML = `
          <span class="hm-district-name">${f.properties.district}</span>
          <span class="hm-district-count">${f.properties.total.toLocaleString()}</span>
        `;
        const marker = new maplibregl.Marker({
          element: el,
          anchor: "center",
        })
          .setLngLat(f.geometry.coordinates)
          .addTo(m);
        markersRef.current.push(marker);
      });
    }

    // ── 4. WARNING MARKERS ──────────────────────────────────
    if (geoData.warnings?.features) {
      geoData.warnings.features.forEach((f) => {
        const el = document.createElement("div");
        el.className = "hm-warning-marker";
        el.innerHTML = `
          <span class="hm-warning-icon">⚠️</span>
          <span class="hm-warning-label">${f.properties.taluk} · ${f.properties.total.toLocaleString()}</span>
        `;
        el.addEventListener("click", () => {
          onDistrictClick && onDistrictClick(f.properties.district);
          m.flyTo({
            center: f.geometry.coordinates,
            zoom: 9.5,
            duration: 1400,
          });
        });
        const marker = new maplibregl.Marker({
          element: el,
          anchor: "bottom",
        })
          .setLngLat(f.geometry.coordinates)
          .addTo(m);
        markersRef.current.push(marker);
      });
    }

    // ── Hover tooltip for boundaries ────────────────────────
    m.on("mousemove", "boundaries-fill", (e) => {
      m.getCanvas().style.cursor = "pointer";
      if (e.features?.length) {
        const props = e.features[0].properties;
        setTooltip({
          x: e.point.x,
          y: e.point.y,
          district: props.district,
          total: Number(props.total).toLocaleString(),
          riskLevel: props.risk_level,
        });
      }
    });

    m.on("mouseleave", "boundaries-fill", () => {
      m.getCanvas().style.cursor = "";
      setTooltip(null);
    });

    m.on("click", "boundaries-fill", (e) => {
      if (e.features?.length) {
        const props = e.features[0].properties;
        onDistrictClick && onDistrictClick(props.district);
        m.flyTo({
          center: [Number(props.center_lng), Number(props.center_lat)],
          zoom: 9,
          duration: 1200,
        });
      }
    });

    // Fly to filtered district
    if (filters.district && geoData.labels?.features?.length) {
      const target = geoData.labels.features.find(
        (f) => f.properties.district === filters.district
      );
      if (target) {
        m.flyTo({
          center: target.geometry.coordinates,
          zoom: 8.8,
          duration: 1400,
        });
      }
    }
  }, [geoData, mapReady, filters, onDistrictClick]);

  // ── Toggle layer visibility ─────────────────────────────
  useEffect(() => {
    if (!map.current || !mapReady) return;
    const m = map.current;

    ["heatmap-layer", "heatmap-layer-glow"].forEach((id) => {
      if (m.getLayer(id)) {
        m.setLayoutProperty(id, "visibility", showHeatmap ? "visible" : "none");
      }
    });
    ["boundaries-fill", "boundaries-line"].forEach((id) => {
      if (m.getLayer(id)) {
        m.setLayoutProperty(id, "visibility", showBoundaries ? "visible" : "none");
      }
    });

    // Toggle label markers
    markersRef.current.forEach((marker) => {
      const el = marker.getElement();
      if (el.classList.contains("hm-district-label")) {
        el.style.display = showLabels ? "" : "none";
      }
      if (el.classList.contains("hm-warning-marker")) {
        el.style.display = showWarnings ? "" : "none";
      }
    });
  }, [showHeatmap, showBoundaries, showLabels, showWarnings, mapReady]);

  // ── Render ──────────────────────────────────────────────
  const layers = [
    { key: "heatmap", label: "Heatmap", active: showHeatmap, toggle: setShowHeatmap },
    { key: "boundaries", label: "Boundaries", active: showBoundaries, toggle: setShowBoundaries },
    { key: "labels", label: "Labels", active: showLabels, toggle: setShowLabels },
    { key: "warnings", label: "Hotspots ⚠️", active: showWarnings, toggle: setShowWarnings },
  ];

  return (
    <div className="heatmap-root">
      <div ref={mapContainer} style={{ height: "100%", width: "100%" }} />

      {/* ── Stats Panel ────────────────────────────────── */}
      <div className="hm-panel hm-stats">
        <div className="hm-stats__title">Crime Heatmap Intelligence</div>
        <div className="hm-stats__grid">
          <div className="hm-stats__card">
            <div className="hm-stats__label">Districts</div>
            <div className="hm-stats__value">
              {geoData?.meta?.total_districts || 0}
            </div>
          </div>
          <div className="hm-stats__card">
            <div className="hm-stats__label">Data Points</div>
            <div className="hm-stats__value">
              {geoData?.meta?.total_points || 0}
            </div>
          </div>
          <div className="hm-stats__card">
            <div className="hm-stats__label">Peak Intensity</div>
            <div className="hm-stats__value" style={{ color: "#ef4444" }}>
              {(geoData?.meta?.max_intensity || 0).toLocaleString()}
            </div>
          </div>
          <div className="hm-stats__card">
            <div className="hm-stats__label">Hotspot Alerts</div>
            <div className="hm-stats__value" style={{ color: "#fbbf24" }}>
              {geoData?.warnings?.features?.length || 0}
            </div>
          </div>
        </div>
      </div>

      {/* ── Active Filters ─────────────────────────────── */}
      {(filters.year || filters.category || filters.district) && (
        <div className="hm-panel hm-filters">
          <div className="hm-filters__title">Active Filters</div>
          {filters.year && (
            <div className="hm-filters__row">
              <span className="hm-filters__chip">📅 Year</span>
              <span className="hm-filters__badge">{filters.year}</span>
            </div>
          )}
          {filters.category && (
            <div className="hm-filters__row">
              <span className="hm-filters__chip">🏷 Type</span>
              <span className="hm-filters__badge">{filters.category}</span>
            </div>
          )}
          {filters.district && (
            <div className="hm-filters__row">
              <span className="hm-filters__chip">📍 District</span>
              <span className="hm-filters__badge">{filters.district}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Gradient Legend ─────────────────────────────── */}
      <div className="hm-panel hm-legend">
        <div className="hm-legend__title">Crime Density</div>
        <div className="hm-legend__bar" />
        <div className="hm-legend__labels">
          <span>Low</span>
          <span>Moderate</span>
          <span>High</span>
          <span>Critical</span>
        </div>
      </div>

      {/* ── Layer Controls ─────────────────────────────── */}
      <div className="hm-panel hm-layers">
        <div className="hm-layers__title">Layers</div>
        <div className="hm-layers__grid">
          {layers.map(({ key, label, active, toggle }) => (
            <button
              key={key}
              className="hm-layers__item"
              onClick={() => toggle(!active)}
            >
              <div
                className={`hm-layers__check ${active ? "hm-layers__check--active" : ""}`}
              />
              <span className="hm-layers__name">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Hover Tooltip ──────────────────────────────── */}
      {tooltip && (
        <div
          className="hm-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="hm-tooltip__district">{tooltip.district}</div>
          <div className="hm-tooltip__detail">
            Total Incidents:{" "}
            <span className="hm-tooltip__count">{tooltip.total}</span>
          </div>
          <div className="hm-tooltip__detail">
            Risk Level:{" "}
            <span
              style={{
                color:
                  tooltip.riskLevel === "HIGH"
                    ? "#ef4444"
                    : tooltip.riskLevel === "MEDIUM"
                      ? "#f59e0b"
                      : "#22c55e",
                fontWeight: 700,
              }}
            >
              {tooltip.riskLevel}
            </span>
          </div>
        </div>
      )}

      {/* ── Loading Overlay ────────────────────────────── */}
      {loading && (
        <div className="hm-loading">
          <div className="hm-loading__text">
            Building heatmap intelligence...
          </div>
        </div>
      )}
    </div>
  );
}
