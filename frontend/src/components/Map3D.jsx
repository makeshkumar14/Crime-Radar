import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";
import { CATEGORY_COLORS, getCategoryColor } from "../lib/crimePalette";

const API_KEY = "jYCiT4YmtkMVvqlo7hnB";

const MAP_STYLES = {
  street: {
    label: "Street",
    style: `https://api.maptiler.com/maps/streets/style.json?key=${API_KEY}`,
  },
  satellite: {
    label: "Satellite",
    style: `https://api.maptiler.com/maps/satellite/style.json?key=${API_KEY}`,
  },
  dark: {
    label: "Dark",
    style: `https://api.maptiler.com/maps/darkmatter/style.json?key=${API_KEY}`,
  },
};

const RISK_COLORS = {
  HIGH: "#EF4444",
  MEDIUM: "#F59E0B",
  LOW: "#22C55E",
};

function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  if (filters.year) params.append("year", filters.year);
  if (filters.district) params.append("district", filters.district);
  if (filters.category) params.append("category", filters.category);
  return params.toString();
}

function createMarkerElement({
  size,
  color,
  border = "#ffffff",
  glow = color,
  label = "",
}) {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "4px";

  const dot = document.createElement("div");
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  dot.style.borderRadius = "999px";
  dot.style.background = color;
  dot.style.border = `2px solid ${border}`;
  dot.style.boxShadow = `0 0 14px ${glow}`;
  dot.style.cursor = "pointer";
  wrapper.appendChild(dot);

  if (label) {
    const text = document.createElement("div");
    text.textContent = label;
    text.style.fontSize = "10px";
    text.style.fontWeight = "700";
    text.style.color = "#f8fafc";
    text.style.textShadow = "0 1px 4px rgba(0,0,0,0.8)";
    wrapper.appendChild(text);
  }

  return wrapper;
}

export default function Map3D({ filters = {}, onDistrictClick }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);
  const styleReadyRef = useRef(false);
  const currentStyleRef = useRef("street");
  const requestedStyleRef = useRef("street");

  const [layers, setLayers] = useState(null);
  const [availableCategories, setAvailableCategories] = useState(
    Object.keys(CATEGORY_COLORS),
  );
  const [mapStyle, setMapStyle] = useState("street");
  const [loading, setLoading] = useState(true);
  const [activeDistrict, setActiveDistrict] = useState(null);
  const [showDistricts, setShowDistricts] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showStations, setShowStations] = useState(false);
  const [showHotspots, setShowHotspots] = useState(true);
  const [demoCategory, setDemoCategory] = useState("Women Safety");
  const [demoCount, setDemoCount] = useState(5);
  const [submittingDemo, setSubmittingDemo] = useState(false);

  const fetchLayers = async (nextFilters = filters) => {
    const query = buildQuery(nextFilters);
    const url = `http://localhost:8000/api/fir/map-layers${query ? `?${query}` : ""}`;
    setLoading(true);
    try {
      const response = await axios.get(url);
      setLayers(response.data);
      if (nextFilters.district) {
        setActiveDistrict(nextFilters.district);
      }
    } catch (error) {
      console.error("Map3D layers error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLayers(filters);
  }, [filters]);

  useEffect(() => {
    axios
      .get("http://localhost:8000/api/fir/categories")
      .then((response) => {
        const categories = response.data.categories || [];
        if (categories.length) {
          setAvailableCategories(categories);
          if (!categories.includes(demoCategory)) {
            setDemoCategory(categories[0]);
          }
        }
      })
      .catch((error) => {
        console.error("Map3D category load error:", error);
      });
  }, []);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLES.street.style,
      center: [78.7047, 10.7905],
      zoom: 6.8,
      pitch: 55,
      bearing: -12,
      antialias: true,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "bottom-right");
    map.current.on("load", () => {
      styleReadyRef.current = true;
      currentStyleRef.current = "street";
    });
    map.current.on("style.load", () => {
      styleReadyRef.current = true;
      currentStyleRef.current = requestedStyleRef.current;
    });
  }, []);

  useEffect(() => {
    if (!map.current || !layers) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const attachMarker = (item, type) => {
      let markerConfig;

      if (type === "district") {
        markerConfig = {
          size: activeDistrict === item.district ? 26 : 22,
          color: RISK_COLORS[item.risk_level],
          glow: RISK_COLORS[item.risk_level],
          label: item.district,
        };
      } else if (type === "zone") {
        markerConfig = {
          size: 14,
          color: getCategoryColor(item.dominant_category),
          glow: getCategoryColor(item.dominant_category),
        };
      } else if (type === "station") {
        markerConfig = {
          size: 10,
          color: item.source_type === "osm" ? "#1E40AF" : "#1E3A8A",
          border: item.source_type === "osm" ? "#3B82F6" : "#2563EB",
          glow: "#2563EB",
        };
      } else {
        markerConfig = {
          size: 24,
          color: RISK_COLORS[item.risk_level],
          glow: RISK_COLORS[item.risk_level],
        };
      }

      const element = createMarkerElement(markerConfig);
      element.addEventListener("click", () => {
        const district = item.district;
        setActiveDistrict(district);
        onDistrictClick && onDistrictClick(district);
        map.current.flyTo({
          center: [item.lng || item.center_lng, item.lat || item.center_lat],
          zoom: type === "district" ? 8.8 : 10,
          duration: 1500,
        });
      });

      const marker = new maplibregl.Marker({
        element,
        anchor: "center",
      })
        .setLngLat([item.lng || item.center_lng, item.lat || item.center_lat])
        .addTo(map.current);

      markersRef.current.push(marker);
    };

    if (showZones) {
      layers.zones.slice(0, 220).forEach((zone) => attachMarker(zone, "zone"));
    }
    if (showStations) {
      layers.stations.slice(0, 180).forEach((station) => attachMarker(station, "station"));
    }
    if (showHotspots) {
      layers.hotspots.slice(0, 20).forEach((hotspot) =>
        attachMarker(
          {
            ...hotspot,
            lat: hotspot.center_lat,
            lng: hotspot.center_lng,
          },
          "hotspot",
        ),
      );
    }
    if (showDistricts) {
      layers.districts.forEach((district) => attachMarker(district, "district"));
    }
  }, [layers, activeDistrict, onDistrictClick, showDistricts, showHotspots, showStations, showZones]);

  useEffect(() => {
    if (!map.current) return;
    if (!styleReadyRef.current) return;
    if (currentStyleRef.current === mapStyle) return;
    requestedStyleRef.current = mapStyle;
    styleReadyRef.current = false;
    map.current.setStyle(MAP_STYLES[mapStyle].style);
  }, [mapStyle]);

  useEffect(() => {
    if (!map.current || !layers) return;
    const focusDistrict =
      layers.districts.find((item) => item.district === (filters.district || activeDistrict)) ||
      null;
    if (!focusDistrict) return;
    map.current.flyTo({
      center: [focusDistrict.lng, focusDistrict.lat],
      zoom: 8.4,
      duration: 1400,
    });
  }, [activeDistrict, filters.district, layers]);

  const handleDemoEntry = async () => {
    if (!layers?.districts?.length) return;
    const targetDistrict =
      activeDistrict || filters.district || layers.districts[0]?.district;
    setSubmittingDemo(true);
    try {
      const response = await axios.post("http://localhost:8000/api/fir/demo-entry", {
        district: targetDistrict,
        category: demoCategory,
        count: Number(demoCount),
      });
      setActiveDistrict(response.data.entry.district);
      onDistrictClick && onDistrictClick(response.data.entry.district);
      await fetchLayers(filters);
    } catch (error) {
      console.error("Map3D demo entry error:", error);
    } finally {
      setSubmittingDemo(false);
    }
  };

  return (
    <div className="relative flex-1">
      <div ref={mapContainer} style={{ height: "100%", width: "100%" }} />







      {/* CONTROLS (Map Style, Demo FIR, Layers) - Positioned at top right */}
      <div className="absolute top-4 right-4 z-50 w-36 rounded-xl border border-white/10 bg-slate-900/40 p-2 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-all hover:bg-slate-900/50">
        <p className="mb-1.5 text-[8px] font-black uppercase tracking-[0.3em] text-white/50">
          STYLE
        </p>
        <div className="mb-2 flex flex-col gap-1">
          {Object.entries(MAP_STYLES).map(([key, style]) => (
            <button
              key={key}
              onClick={() => setMapStyle(key)}
              className={`rounded px-1.5 py-1 text-[9px] font-semibold transition ${
                mapStyle === key
                  ? "bg-blue-600 text-white"
                  : "bg-gray-900 text-gray-300 hover:bg-gray-800"
              }`}
            >
              {style.label}
            </button>
          ))}
        </div>

        <div className="mb-2 h-px w-full bg-white/10" />

        <p className="mb-1.5 text-[8px] font-black uppercase tracking-[0.3em] text-white/50">
          LAYERS
        </p>
        <div className="mb-2 flex flex-col gap-1 text-xs text-white">
          {[
            ["Districts", showDistricts, setShowDistricts],
            ["Taluk zones", showZones, setShowZones],
            ["Stations", showStations, setShowStations],
            ["Hotspots", showHotspots, setShowHotspots],
          ].map(([label, value, setter]) => (
            <label key={label} className="flex items-center gap-1.5 rounded bg-gray-900/80 px-1.5 py-1 cursor-pointer transition hover:bg-gray-800">
              <input
                type="checkbox"
                checked={value}
                onChange={(event) => setter(event.target.checked)}
                className="h-2.5 w-2.5 accent-blue-500"
              />
              <span className="text-[9px] font-medium">{label}</span>
            </label>
          ))}
        </div>

        <div className="mb-2 h-px w-full bg-white/10" />

        <p className="mb-1 text-[8px] font-black uppercase tracking-[0.3em] text-white/50">
          DEMO FIR
        </p>
        <div className="mb-2 flex flex-col gap-1.5">
            <div>
                <label className="mb-0.5 block text-[8px] font-semibold text-gray-400">Category</label>
                <select
                  value={demoCategory}
                  onChange={(event) => setDemoCategory(event.target.value)}
                  className="w-full rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[8.5px] text-white"
                >
                  {availableCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
            </div>
            <div>
                <label className="mb-0.5 block text-[8px] font-semibold text-gray-400">Cases ({demoCount})</label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={demoCount}
                  onChange={(event) => setDemoCount(event.target.value)}
                  className="w-full accent-blue-500"
                />
            </div>
        </div>
        <button
          onClick={handleDemoEntry}
          disabled={submittingDemo || loading}
          className="w-full rounded bg-emerald-600 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submittingDemo ? "Wait..." : "Inject FIR"}
        </button>
      </div>

      {/* COMBINED OPS & LEGEND - Positioned at bottom left */}
      <div className="absolute bottom-4 left-4 z-50 w-fit min-w-[220px] max-w-[280px] rounded-xl border border-white/10 bg-slate-900/40 p-2 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-all hover:bg-slate-900/50">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-cyan-400/90">
            3D OPS VIEW
          </p>
        </div>
        <div className="mb-1.5 grid grid-cols-2 gap-1 text-[8.5px] uppercase tracking-wider text-gray-300">
          <div className="flex items-center justify-between rounded bg-white/5 px-1.5 py-0.5">
            <span>Dist:</span>
            <span className="font-bold text-white">{layers?.summary?.districts || 0}</span>
          </div>
          <div className="flex items-center justify-between rounded bg-white/5 px-1.5 py-0.5">
            <span>Zones:</span>
            <span className="font-bold text-white">{layers?.summary?.taluks || 0}</span>
          </div>
          <div className="flex items-center justify-between rounded bg-white/5 px-1.5 py-0.5">
            <span>Stns:</span>
            <span className="font-bold text-white">{layers?.summary?.stations || 0}</span>
          </div>
          <div className="flex items-center justify-between rounded bg-white/5 px-1.5 py-0.5">
            <span>Load:</span>
            <span className="font-bold text-white">{(layers?.summary?.incidents || 0).toLocaleString()}</span>
          </div>
        </div>

        <div className="mb-1.5 h-px w-full bg-white/10" />

        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8px]">
            <span className="font-bold uppercase tracking-widest text-white/50">Risk:</span>
            {Object.entries(RISK_COLORS).map(([level, color]) => (
              <div key={level} className="flex items-center gap-0.5">
                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-white/80">{level}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8px]">
            <span className="font-bold uppercase tracking-widest text-white/50">Crime:</span>
            {availableCategories.slice(0, 6).map((label) => (
              <div key={label} className="flex items-center gap-0.5">
                <div
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: getCategoryColor(label) }}
                />
                <span className="text-white/80">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-gray-950/35 backdrop-blur-[2px]">
          <p className="rounded-xl bg-gray-950/80 px-4 py-2 text-sm font-semibold text-white">
            Refreshing operations view...
          </p>
        </div>
      )}
    </div>
  );
}
