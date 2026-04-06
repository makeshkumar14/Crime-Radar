import { useEffect, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  ZoomControl,
  useMap,
} from "react-leaflet";
import axios from "axios";
import "leaflet/dist/leaflet.css";

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

const MAP_STYLES = {
  street: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap",
    label: "Street",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri World Imagery",
    label: "Satellite",
    maxZoom: 19,
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "© CartoDB",
    label: "Dark",
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "© OpenTopoMap",
    label: "Terrain",
    maxZoom: 17,
  },
};

const TN_CENTER = [10.7905, 78.7047];

function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  if (filters.year) params.append("year", filters.year);
  if (filters.district) params.append("district", filters.district);
  if (filters.category) params.append("category", filters.category);
  return params.toString();
}

function getDistrictRadius(total) {
  if (total > 70000) return 18;
  if (total > 50000) return 15;
  if (total > 30000) return 13;
  if (total > 15000) return 11;
  return 8;
}

function getStationRadius(total) {
  if (total > 5000) return 6;
  if (total > 2500) return 5;
  if (total > 1200) return 4;
  return 3;
}

function MapController({ focusDistrict, fallbackCenter }) {
  const map = useMap();

  useEffect(() => {
    if (focusDistrict) {
      map.flyTo([focusDistrict.lat, focusDistrict.lng], 9, { duration: 1.25 });
    } else {
      map.flyTo(fallbackCenter, 7, { duration: 1.25 });
    }
  }, [focusDistrict, fallbackCenter, map]);

  return null;
}

export default function Map({ filters = {}, onDistrictClick }) {
  const [mapStyle, setMapStyle] = useState("street");
  const [layers, setLayers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeDistrict, setActiveDistrict] = useState(null);
  const [showDistricts, setShowDistricts] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showStations, setShowStations] = useState(false);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showWomenSafety, setShowWomenSafety] = useState(false);
  const [showAccident, setShowAccident] = useState(false);
  const [showPatrol, setShowPatrol] = useState(false);
  const [demoCategory, setDemoCategory] = useState("Women Safety");
  const [demoCount, setDemoCount] = useState(6);
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
      console.error("Map layers error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLayers(filters);
  }, [filters]);

  const handleDistrictSelect = (district) => {
    setActiveDistrict(district);
    onDistrictClick && onDistrictClick(district);
  };

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
      handleDistrictSelect(response.data.entry.district);
      await fetchLayers(filters);
    } catch (error) {
      console.error("Demo entry error:", error);
    } finally {
      setSubmittingDemo(false);
    }
  };

  if (loading || !layers) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <p className="text-white text-lg animate-pulse">
          Building Tamil Nadu operations picture...
        </p>
      </div>
    );
  }

  const focusDistrict =
    layers.districts.find((item) => item.district === (filters.district || activeDistrict)) ||
    null;

  return (
    <div className="flex-1 relative">
      <MapContainer
        center={[10.7905, 78.7047]}
        zoom={7}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
      >
        <ZoomControl position="bottomright" />
        <TileLayer
          key={mapStyle}
          url={MAP_STYLES[mapStyle].url}
          attribution={MAP_STYLES[mapStyle].attribution}
          maxZoom={MAP_STYLES[mapStyle].maxZoom || 19}
        />

        <MapController
          focusDistrict={focusDistrict}
          fallbackCenter={TN_CENTER}
        />

        {showZones &&
          layers.zones.map((zone) => {
            const color = CATEGORY_COLORS[zone.dominant_category] || "#64748b";
            const isActive = activeDistrict === zone.district;
            return (
              <Circle
                key={zone.taluk_id}
                center={[zone.lat, zone.lng]}
                radius={zone.radius_km * 1000}
                pathOptions={{
                  color: isActive ? "#ffffff" : color,
                  fillColor: color,
                  fillOpacity: isActive ? 0.2 : 0.1,
                  weight: isActive ? 2.5 : 1.2,
                }}
                eventHandlers={{
                  click: () => handleDistrictSelect(zone.district),
                }}
              />
            );
          })}

        {showDistricts &&
          layers.districts.map((district) => {
            const isActive = activeDistrict === district.district;
            return (
              <CircleMarker
                key={district.district}
                center={[district.lat, district.lng]}
                radius={isActive ? getDistrictRadius(district.total) + 2 : getDistrictRadius(district.total)}
                pathOptions={{
                  color: isActive ? "#ffffff" : RISK_COLORS[district.risk_level],
                  fillColor: RISK_COLORS[district.risk_level],
                  fillOpacity: 0.88,
                  weight: isActive ? 3 : 2,
                }}
                eventHandlers={{
                  click: () => handleDistrictSelect(district.district),
                }}
              />
            );
          })}

        {showStations &&
          layers.stations.map((station) => (
            <CircleMarker
              key={station.station_id}
              center={[station.lat, station.lng]}
              radius={getStationRadius(station.total)}
              pathOptions={{
                color: station.source_type === "osm" ? "#ffffff" : "#94A3B8",
                fillColor: station.source_type === "osm" ? "#E2E8F0" : "#64748B",
                fillOpacity: 0.9,
                weight: 1,
              }}
              eventHandlers={{
                click: () => handleDistrictSelect(station.district),
              }}
            />
          ))}

        {showHotspots &&
          layers.hotspots.map((hotspot) => (
            <Circle
              key={`hotspot-${hotspot.taluk_id}`}
              center={[hotspot.center_lat, hotspot.center_lng]}
              radius={hotspot.radius_km * 1000}
              pathOptions={{
                color: RISK_COLORS[hotspot.risk_level],
                fillColor: RISK_COLORS[hotspot.risk_level],
                fillOpacity: 0.14,
                weight: 2,
                dashArray: "6 4",
              }}
            />
          ))}

        {showWomenSafety &&
          layers.women_zones.map((zone) => (
            <Circle
              key={`women-${zone.taluk_id}`}
              center={[zone.lat, zone.lng]}
              radius={zone.radius_km * 1000}
              pathOptions={{
                color: "#EC4899",
                fillColor: "#EC4899",
                fillOpacity: 0.18,
                weight: 2,
                dashArray: "4 3",
              }}
            />
          ))}

        {showAccident &&
          layers.accident_zones.map((zone) => (
            <Circle
              key={`accident-${zone.taluk_id}`}
              center={[zone.lat, zone.lng]}
              radius={zone.radius_km * 1000}
              pathOptions={{
                color: "#F97316",
                fillColor: "#F97316",
                fillOpacity: 0.18,
                weight: 2,
                dashArray: "4 3",
              }}
            />
          ))}

        {showPatrol &&
          layers.patrol_routes.map((route) => (
            <Polyline
              key={route.route_id}
              positions={route.path.map((point) => [point.lat, point.lng])}
              pathOptions={{
                color: "#38BDF8",
                weight: 3,
                dashArray: "8 6",
              }}
            />
          ))}
      </MapContainer>

      <div className="absolute top-4 left-4 z-[1000] rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-2 text-xs font-bold tracking-[0.2em] text-cyan-300">
          TAMIL NADU OPS
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs text-white">
          <div className="rounded-lg bg-gray-900/80 px-3 py-2">
            <p className="text-gray-400">Districts</p>
            <p className="text-base font-bold">{layers.summary.districts}</p>
          </div>
          <div className="rounded-lg bg-gray-900/80 px-3 py-2">
            <p className="text-gray-400">Taluks/Zones</p>
            <p className="text-base font-bold">{layers.summary.taluks}</p>
          </div>
          <div className="rounded-lg bg-gray-900/80 px-3 py-2">
            <p className="text-gray-400">Stations</p>
            <p className="text-base font-bold">{layers.summary.stations}</p>
          </div>
          <div className="rounded-lg bg-gray-900/80 px-3 py-2">
            <p className="text-gray-400">Incident Load</p>
            <p className="text-base font-bold">{layers.summary.incidents.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="absolute top-4 left-[17rem] z-[1000] rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-3 text-xs font-bold tracking-[0.2em] text-white/70">
          MAP STYLE
        </p>
        <div className="flex gap-2">
          {Object.entries(MAP_STYLES).map(([key, style]) => (
            <button
              key={key}
              onClick={() => setMapStyle(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
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

      <div className="absolute top-4 right-4 z-[1000] w-72 rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-3 text-xs font-bold tracking-[0.2em] text-white/70">
          LIVE DEMO FIR
        </p>
        <p className="mb-3 text-xs text-gray-400">
          Geography is real. FIR activity is synthetic for demo use.
        </p>
        <label className="mb-2 block text-[11px] font-semibold text-gray-400">
          Category
        </label>
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
        <label className="mb-2 block text-[11px] font-semibold text-gray-400">
          Case Load
        </label>
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
          disabled={submittingDemo}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submittingDemo ? "Injecting FIR..." : "Inject Demo FIR"}
        </button>
      </div>

      <div className="absolute right-4 bottom-8 z-[1000] w-72 rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-3 text-xs font-bold tracking-[0.2em] text-white/70">
          LAYERS
        </p>
        <div className="grid grid-cols-2 gap-2 text-sm text-white">
          {[
            ["District risk", showDistricts, setShowDistricts],
            ["Taluk zones", showZones, setShowZones],
            ["Stations", showStations, setShowStations],
            ["Hotspots", showHotspots, setShowHotspots],
            ["Women safety", showWomenSafety, setShowWomenSafety],
            ["Accident zones", showAccident, setShowAccident],
            ["Patrol routes", showPatrol, setShowPatrol],
          ].map(([label, value, setter]) => (
            <label key={label} className="flex items-center gap-2 rounded-lg bg-gray-900/80 px-2 py-2">
              <input
                type="checkbox"
                checked={value}
                onChange={(event) => setter(event.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-xs font-medium">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="absolute bottom-8 left-4 z-[1000] w-80 rounded-xl border border-gray-700/70 bg-gray-950/80 p-3 shadow-xl backdrop-blur-md">
        <p className="mb-3 text-xs font-bold tracking-[0.2em] text-white/70">
          LEGEND
        </p>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          District Risk
        </p>
        <div className="mb-3 flex flex-wrap gap-3">
          {Object.entries(RISK_COLORS).map(([level, color]) => (
            <div key={level} className="flex items-center gap-2">
              <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-white">{level}</span>
            </div>
          ))}
        </div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Zone Dominant Crime
        </p>
        <div className="flex flex-wrap gap-3">
          {Object.entries(CATEGORY_COLORS).map(([label, color]) => (
            <div key={label} className="flex items-center gap-2">
              <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-white">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
