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
import { CATEGORY_COLORS, getCategoryColor } from "../lib/crimePalette";
import { fetchRoadRoute } from "../lib/roadRouting";

const RISK_COLORS = {
  HIGH: "#EF4444",
  MEDIUM: "#F59E0B",
  LOW: "#22C55E",
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
  const [availableCategories, setAvailableCategories] = useState(
    Object.keys(CATEGORY_COLORS),
  );
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
  const [patrolRouteGeometry, setPatrolRouteGeometry] = useState({});
  const [patrolRouteState, setPatrolRouteState] = useState("idle");

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
        console.error("Category load error:", error);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!showPatrol || !layers?.patrol_routes?.length) {
      setPatrolRouteGeometry({});
      setPatrolRouteState("idle");
      return undefined;
    }

    setPatrolRouteState("loading");

    Promise.all(
      layers.patrol_routes.map(async (route) => [
        route.route_id,
        await fetchRoadRoute(route.path),
      ]),
    )
      .then((entries) => {
        if (cancelled) return;
        setPatrolRouteGeometry(Object.fromEntries(entries));
        setPatrolRouteState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPatrolRouteGeometry({});
        setPatrolRouteState("idle");
      });

    return () => {
      cancelled = true;
    };
  }, [layers, showPatrol]);

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
  const patrolFallbackCount = Object.values(patrolRouteGeometry).filter(
    (route) => route?.source === "fallback",
  ).length;

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
            const color = getCategoryColor(zone.dominant_category);
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
                color: station.source_type === "osm" ? "#3B82F6" : "#2563EB",
                fillColor: station.source_type === "osm" ? "#1E40AF" : "#1E3A8A",
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
              positions={patrolRouteGeometry[route.route_id]?.coordinates || []}
              pathOptions={{
                color: "#38BDF8",
                weight: 3,
                dashArray: "8 6",
              }}
            />
          ))}
      </MapContainer>






      {/* CONTROLS (Map Style, Demo FIR, Layers) - Positioned at top right */}
      <div className="absolute top-4 right-4 z-[1000] w-36 rounded-xl border border-white/10 bg-slate-900/40 p-2 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-all hover:bg-slate-900/50">
        <p className="mb-1.5 text-[8px] font-black uppercase tracking-[0.3em] text-white/50">
          MAP STYLE
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
            ["District risk", showDistricts, setShowDistricts],
            ["Taluk zones", showZones, setShowZones],
            ["Stations", showStations, setShowStations],
            ["Hotspots", showHotspots, setShowHotspots],
            ["Women safety", showWomenSafety, setShowWomenSafety],
            ["Accident zones", showAccident, setShowAccident],
            ["Patrol routes", showPatrol, setShowPatrol],
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
        {showPatrol && patrolRouteState === "loading" && (
          <p className="mb-2 text-[8px] leading-4 text-cyan-100/80">
            Snapping patrol routes to real roads...
          </p>
        )}
        {showPatrol && patrolRouteState === "ready" && patrolFallbackCount > 0 && (
          <p className="mb-2 text-[8px] leading-4 text-amber-200/90">
            {patrolFallbackCount} patrol route
            {patrolFallbackCount > 1 ? "s are" : " is"} still approximate.
          </p>
        )}

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
          disabled={submittingDemo}
          className="w-full rounded bg-emerald-600 px-1.5 py-1 text-[9px] font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submittingDemo ? "Wait..." : "Inject FIR"}
        </button>
      </div>

      {/* COMBINED OPS & LEGEND - Positioned at bottom left */}
      <div className="absolute bottom-4 left-4 z-[1000] w-fit min-w-[220px] max-w-[280px] rounded-xl border border-white/10 bg-slate-900/40 p-2 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-all hover:bg-slate-900/50">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-cyan-400/90">
            TAMIL NADU OPS
          </p>
        </div>
        <div className="mb-1.5 grid grid-cols-2 gap-1 text-[8.5px] uppercase tracking-wider text-gray-300">
          <div className="flex items-center justify-between rounded bg-white/5 px-1.5 py-0.5">
            <span>Dist:</span>
            <span className="font-bold text-white">{layers.summary.districts}</span>
          </div>
          <div className="flex items-center justify-between rounded bg-white/5 px-1.5 py-0.5">
            <span>Zones:</span>
            <span className="font-bold text-white">{layers.summary.taluks}</span>
          </div>
          <div className="flex items-center justify-between rounded bg-white/5 px-1.5 py-0.5">
            <span>Stns:</span>
            <span className="font-bold text-white">{layers.summary.stations}</span>
          </div>
          <div className="flex items-center justify-between rounded bg-white/5 px-1.5 py-0.5">
            <span>Load:</span>
            <span className="font-bold text-white">{layers.summary.incidents.toLocaleString()}</span>
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
            {availableCategories.slice(0, 8).map((label) => (
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
    </div>
  );
}
