import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";

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

const CATEGORY_COLORS = {
  Violent: "#EF4444",
  Property: "#F59E0B",
  Fraud: "#3B82F6",
  "Women Safety": "#EC4899",
  "Public Order": "#06B6D4",
  NDPS: "#8B5CF6",
  "Excise Act": "#84CC16",
  Accident: "#F97316",
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

  const [layers, setLayers] = useState(null);
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
          color: CATEGORY_COLORS[item.dominant_category] || "#64748b",
          glow: CATEGORY_COLORS[item.dominant_category] || "#64748b",
        };
      } else if (type === "station") {
        markerConfig = {
          size: 10,
          color: item.source_type === "osm" ? "#e2e8f0" : "#94a3b8",
          border: item.source_type === "osm" ? "#ffffff" : "#64748b",
          glow: "#cbd5e1",
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

      <div className="absolute top-4 left-4 z-50 rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-2 text-xs font-bold tracking-[0.2em] text-cyan-300">
          3D OPS VIEW
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs text-white">
          <div className="rounded-lg bg-gray-900/80 px-3 py-2">
            <p className="text-gray-400">Districts</p>
            <p className="text-base font-bold">{layers?.summary?.districts || 0}</p>
          </div>
          <div className="rounded-lg bg-gray-900/80 px-3 py-2">
            <p className="text-gray-400">Taluks</p>
            <p className="text-base font-bold">{layers?.summary?.taluks || 0}</p>
          </div>
          <div className="rounded-lg bg-gray-900/80 px-3 py-2">
            <p className="text-gray-400">Stations</p>
            <p className="text-base font-bold">{layers?.summary?.stations || 0}</p>
          </div>
          <div className="rounded-lg bg-gray-900/80 px-3 py-2">
            <p className="text-gray-400">Incident Load</p>
            <p className="text-base font-bold">
              {(layers?.summary?.incidents || 0).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      <div className="absolute top-4 left-[18rem] z-50 rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-2 text-xs font-bold tracking-[0.2em] text-white/70">STYLE</p>
        <div className="flex gap-2">
          {Object.entries(MAP_STYLES).map(([key, style]) => (
            <button
              key={key}
              onClick={() => setMapStyle(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                mapStyle === key
                  ? "bg-blue-600 text-white"
                  : "bg-gray-900 text-gray-300 hover:bg-gray-800"
              }`}
            >
              {style.label}
            </button>
          ))}
        </div>
      </div>

      <div className="absolute top-4 right-4 z-50 w-72 rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-3 text-xs font-bold tracking-[0.2em] text-white/70">LIVE DEMO FIR</p>
        <p className="mb-3 text-xs text-gray-400">
          Synthetic FIR activity with real Tamil Nadu geography coverage.
        </p>
        <select
          value={demoCategory}
          onChange={(event) => setDemoCategory(event.target.value)}
          className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
        >
          {Object.keys(CATEGORY_COLORS).map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <input
          type="range"
          min="1"
          max="20"
          value={demoCount}
          onChange={(event) => setDemoCount(event.target.value)}
          className="mb-1 w-full"
        />
        <p className="mb-3 text-xs text-gray-400">{demoCount} synthetic incidents</p>
        <button
          onClick={handleDemoEntry}
          disabled={submittingDemo || loading}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submittingDemo ? "Injecting FIR..." : "Inject Demo FIR"}
        </button>
      </div>

      <div className="absolute right-4 bottom-8 z-50 rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-3 text-xs font-bold tracking-[0.2em] text-white/70">LAYERS</p>
        <div className="grid grid-cols-2 gap-2 text-xs text-white">
          {[
            ["Districts", showDistricts, setShowDistricts],
            ["Taluk zones", showZones, setShowZones],
            ["Stations", showStations, setShowStations],
            ["Hotspots", showHotspots, setShowHotspots],
          ].map(([label, value, setter]) => (
            <label key={label} className="flex items-center gap-2 rounded-lg bg-gray-900/80 px-2 py-2">
              <input
                type="checkbox"
                checked={value}
                onChange={(event) => setter(event.target.checked)}
                className="h-4 w-4"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="absolute bottom-8 left-4 z-50 rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-2 text-xs font-bold tracking-[0.2em] text-white/70">LEGEND</p>
        <div className="mb-3 flex flex-wrap gap-3">
          {Object.entries(RISK_COLORS).map(([level, color]) => (
            <div key={level} className="flex items-center gap-2">
              <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-white">{level} risk</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {Object.entries(CATEGORY_COLORS).slice(0, 4).map(([label, color]) => (
            <div key={label} className="flex items-center gap-2">
              <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-white">{label}</span>
            </div>
          ))}
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
