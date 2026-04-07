import { useCallback, useEffect, useState } from "react";
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
import { apiUrl } from "../lib/api";
import { downloadApiPdf } from "../lib/download";

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
const FIR_BLINK_INTERVAL_MS = 650;
const EMPTY_LAYERS = {
  summary: {
    districts: 0,
    taluks: 0,
    stations: 0,
    incidents: 0,
  },
  districts: [],
  zones: [],
  stations: [],
  hotspots: [],
  women_zones: [],
  accident_zones: [],
  patrol_routes: [],
};

function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  if (filters.year) params.append("year", filters.year);
  if (filters.district) params.append("district", filters.district);
  if (filters.category) params.append("category", filters.category);
  return params.toString();
}

function slugify(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
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

function getZoneDisplayRadiusKm(zone, districtMeta) {
  const talukCount = districtMeta?.taluk_count || 0;

  if (talukCount >= 15) {
    return Math.max(1.8, zone.radius_km * 0.38);
  }
  if (talukCount >= 10) {
    return Math.max(2.4, zone.radius_km * 0.52);
  }
  if (talukCount >= 7) {
    return Math.max(3, zone.radius_km * 0.68);
  }
  return zone.radius_km;
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

export default function Map({
  filters = {},
  onDistrictClick,
  refreshKey = 0,
  highlightTarget = null,
}) {
  const [mapStyle, setMapStyle] = useState("street");
  const [layers, setLayers] = useState(EMPTY_LAYERS);
  const [availableCategories, setAvailableCategories] = useState(
    Object.keys(CATEGORY_COLORS),
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [activeDistrict, setActiveDistrict] = useState(null);
  const [showDistricts, setShowDistricts] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showStations, setShowStations] = useState(false);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showWomenSafety, setShowWomenSafety] = useState(false);
  const [showAccident, setShowAccident] = useState(false);
  const [showPatrol, setShowPatrol] = useState(false);
  const [patrolRouteGeometry, setPatrolRouteGeometry] = useState({});
  const [patrolRouteState, setPatrolRouteState] = useState("idle");
  const [blinkOn, setBlinkOn] = useState(true);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const fetchLayers = useCallback(async (nextFilters = filters) => {
    const query = buildQuery(nextFilters);
    const url = apiUrl(`/api/fir/map-layers${query ? `?${query}` : ""}`);
    setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(url);
      setLayers({
        ...EMPTY_LAYERS,
        ...response.data,
        summary: {
          ...EMPTY_LAYERS.summary,
          ...(response.data?.summary || {}),
        },
        districts: response.data?.districts || [],
        zones: response.data?.zones || [],
        stations: response.data?.stations || [],
        hotspots: response.data?.hotspots || [],
        women_zones: response.data?.women_zones || [],
        accident_zones: response.data?.accident_zones || [],
        patrol_routes: response.data?.patrol_routes || [],
      });
      if (nextFilters.district) {
        setActiveDistrict(nextFilters.district);
      }
    } catch (error) {
      console.error("Map layers error:", error);
      setLoadError("We couldn't load operations layers. The basemap is still available, and you can retry.");
    } finally {
      setLoading(false);
      setInitialLoadComplete(true);
    }
  }, [filters]);

  useEffect(() => {
    fetchLayers(filters);
  }, [fetchLayers, filters, refreshKey]);

  useEffect(() => {
    axios
      .get(apiUrl("/api/fir/categories"))
      .then((response) => {
        const categories = response.data.categories || [];
        if (categories.length) {
          setAvailableCategories(categories);
        }
      })
      .catch((error) => {
        console.error("Category load error:", error);
      });
  }, []);

  useEffect(() => {
    if (!highlightTarget?.district) return;
    setActiveDistrict(highlightTarget.district);
  }, [highlightTarget]);

  useEffect(() => {
    if (!highlightTarget) {
      setBlinkOn(true);
      return undefined;
    }

    setBlinkOn(true);
    const interval = globalThis.setInterval(() => {
      setBlinkOn((current) => !current);
    }, FIR_BLINK_INTERVAL_MS);

    return () => globalThis.clearInterval(interval);
  }, [highlightTarget]);

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

  const handleDownloadReport = async () => {
    setDownloadingReport(true);
    setDownloadError("");
    try {
      await downloadApiPdf("/api/reports/operations-pdf", {
        params: {
          year: filters.year || undefined,
          district: filters.district || undefined,
          category: filters.category || undefined,
        },
        filename: `operations-report-${slugify(filters.district, "statewide")}-${slugify(filters.category, "all-categories")}-${filters.year || "all-years"}.pdf`,
      });
    } catch (error) {
      console.error("Operations report download error:", error);
      setDownloadError("Operations PDF could not be downloaded right now.");
    } finally {
      setDownloadingReport(false);
    }
  };

  const focusDistrict =
    layers.districts.find((item) => item.district === (filters.district || activeDistrict)) ||
    null;
  const focusedDistrictName = filters.district || activeDistrict || null;
  const districtMetaByName = Object.fromEntries(
    layers.districts.map((district) => [district.district, district]),
  );
  const visibleZones = focusedDistrictName
    ? layers.zones.filter((zone) => zone.district === focusedDistrictName)
    : layers.zones;
  const visibleStations = focusedDistrictName
    ? layers.stations.filter((station) => station.district === focusedDistrictName)
    : layers.stations;
  const visibleHotspots = focusedDistrictName
    ? layers.hotspots.filter((hotspot) => hotspot.district === focusedDistrictName)
    : layers.hotspots;
  const visibleWomenZones = focusedDistrictName
    ? layers.women_zones.filter((zone) => zone.district === focusedDistrictName)
    : layers.women_zones;
  const visibleAccidentZones = focusedDistrictName
    ? layers.accident_zones.filter((zone) => zone.district === focusedDistrictName)
    : layers.accident_zones;
  const visiblePatrolRoutes = focusedDistrictName
    ? layers.patrol_routes.filter((route) => route.district === focusedDistrictName)
    : layers.patrol_routes;
  const highlightedDistrict = highlightTarget?.district
    ? layers.districts.find((item) => item.district === highlightTarget.district) || null
    : null;
  const highlightedZone = highlightTarget?.taluk_id
    ? layers.zones.find((item) => item.taluk_id === highlightTarget.taluk_id) || null
    : null;
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
          visibleZones.map((zone) => {
            const color = getCategoryColor(zone.dominant_category);
            const isActive = activeDistrict === zone.district;
            const displayRadiusKm = getZoneDisplayRadiusKm(
              zone,
              districtMetaByName[zone.district],
            );
            return (
              <Circle
                key={zone.taluk_id}
                center={[zone.lat, zone.lng]}
                radius={displayRadiusKm * 1000}
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
          visibleStations.map((station) => (
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
          visibleHotspots.map((hotspot) => (
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
          visibleWomenZones.map((zone) => (
            <Circle
              key={`women-${zone.taluk_id}`}
              center={[zone.lat, zone.lng]}
              radius={zone.radius_km * 1000}
              pathOptions={{
                color: RISK_COLORS[zone.risk_level] || "#EC4899",
                fillColor: RISK_COLORS[zone.risk_level] || "#EC4899",
                fillOpacity: 0.18,
                weight: 2,
                dashArray: "4 3",
              }}
            />
          ))}

        {showAccident &&
          visibleAccidentZones.map((zone) => (
            <Circle
              key={`accident-${zone.taluk_id}`}
              center={[zone.lat, zone.lng]}
              radius={zone.radius_km * 1000}
              pathOptions={{
                color: RISK_COLORS[zone.risk_level] || "#F97316",
                fillColor: RISK_COLORS[zone.risk_level] || "#F97316",
                fillOpacity: 0.18,
                weight: 2,
                dashArray: "4 3",
              }}
            />
          ))}

        {showPatrol &&
          visiblePatrolRoutes.map((route) => (
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

        {highlightedDistrict && (
          <CircleMarker
            center={[highlightedDistrict.lat, highlightedDistrict.lng]}
            radius={getDistrictRadius(highlightedDistrict.total) + (blinkOn ? 11 : 6)}
            pathOptions={{
              color: blinkOn ? "#F8FAFC" : "#60A5FA",
              fillColor: "#2563EB",
              fillOpacity: blinkOn ? 0.4 : 0.1,
              opacity: blinkOn ? 1 : 0.35,
              weight: blinkOn ? 5 : 2,
            }}
          />
        )}

        {highlightedZone && (
          <>
            <Circle
              center={[highlightedZone.lat, highlightedZone.lng]}
              radius={Math.max(highlightedZone.radius_km * 1000, 2800)}
              pathOptions={{
                color: blinkOn ? "#F8FAFC" : "#38BDF8",
                fillColor: "#0EA5E9",
                fillOpacity: blinkOn ? 0.18 : 0.04,
                opacity: blinkOn ? 0.95 : 0.28,
                weight: blinkOn ? 4 : 1.5,
                dashArray: blinkOn ? "8 8" : "4 10",
              }}
            />
            <CircleMarker
              center={[highlightedZone.lat, highlightedZone.lng]}
              radius={blinkOn ? 10 : 6}
              pathOptions={{
                color: "#F8FAFC",
                fillColor: blinkOn ? "#38BDF8" : "#1D4ED8",
                fillOpacity: blinkOn ? 1 : 0.38,
                opacity: blinkOn ? 1 : 0.35,
                weight: blinkOn ? 4 : 2,
              }}
            />
          </>
        )}
      </MapContainer>






      {/* CONTROLS (Map Style, Demo FIR, Layers) - Positioned at top right */}
      <div className="absolute top-4 right-4 z-[1000] w-44 rounded-xl border border-white/10 bg-slate-900/40 p-3 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-all hover:bg-slate-900/50">
        <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.3em] text-white/80">
          REPORT
        </p>
        <button
          onClick={handleDownloadReport}
          disabled={downloadingReport || loading}
          className="mb-2 w-full rounded-md border border-[#ef4444]/35 bg-[#8f1d1d] px-2 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {downloadingReport ? "Building PDF..." : "Download PDF"}
        </button>
        {downloadError && (
          <p className="mb-2 text-[9px] leading-4 text-amber-200/90">{downloadError}</p>
        )}

        <div className="mb-2 h-px w-full bg-white/10" />

        <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.3em] text-white/80">
          MAP STYLE
        </p>
        <div className="mb-2 flex flex-col gap-1">
          {Object.entries(MAP_STYLES).map(([key, style]) => (
            <button
              key={key}
              onClick={() => setMapStyle(key)}
              className={`rounded px-1.5 py-1 text-[11px] font-semibold transition ${
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

        <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.3em] text-white/80">
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
                className="h-3 w-3 accent-blue-500"
              />
              <span className="text-[11px] font-medium">{label}</span>
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
      </div>

      {/* COMBINED OPS & LEGEND - Positioned at bottom left */}
      <div className="absolute bottom-4 left-4 z-[1000] w-fit min-w-[260px] max-w-[320px] rounded-xl border border-white/10 bg-slate-900/40 p-3 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-all hover:bg-slate-900/50">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">
            TAMIL NADU OPS
          </p>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1.5 text-[10px] uppercase tracking-wider text-gray-200">
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

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
            <span className="font-bold uppercase tracking-widest text-white/80">Risk:</span>
            {Object.entries(RISK_COLORS).map(([level, color]) => (
              <div key={level} className="flex items-center gap-0.5">
                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-white/80">{level}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
            <span className="font-bold uppercase tracking-widest text-white/80">Crime:</span>
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

      {loadError && (
        <div className="absolute left-4 top-4 z-[1001] max-w-sm rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100 shadow-xl backdrop-blur-md">
          <p className="font-semibold">Operations data unavailable</p>
          <p className="mt-1 leading-5 text-amber-50/90">{loadError}</p>
          <button
            onClick={() => fetchLayers(filters)}
            className="mt-3 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/20"
          >
            Retry loading layers
          </button>
        </div>
      )}

      {!loadError && !loading && initialLoadComplete && layers.districts.length === 0 && (
        <div className="absolute left-4 top-4 z-[1001] max-w-sm rounded-xl border border-slate-700/70 bg-slate-950/85 p-4 text-sm text-slate-100 shadow-xl backdrop-blur-md">
          No operational layers matched the current filters.
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-gray-950/25 backdrop-blur-[1px]">
          <p className="rounded-xl bg-gray-950/80 px-4 py-2 text-sm font-semibold text-white">
            {initialLoadComplete
              ? "Refreshing operations layers..."
              : "Building Tamil Nadu operations picture..."}
          </p>
        </div>
      )}
    </div>
  );
}
