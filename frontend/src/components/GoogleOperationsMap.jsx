import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { CATEGORY_COLORS, getCategoryColor } from "../lib/crimePalette";
import { loadGoogleMapsApi } from "../lib/googleMapsLoader";
import { apiUrl } from "../lib/api";

const RISK_COLORS = {
  HIGH: "#EF4444",
  MEDIUM: "#F59E0B",
  LOW: "#22C55E",
};

const GOOGLE_MAP_STYLES = {
  street: {
    label: "Street",
    typeId: "roadmap",
  },
  satellite: {
    label: "Satellite",
    typeId: "satellite",
  },
  hybrid: {
    label: "Hybrid",
    typeId: "hybrid",
  },
  terrain: {
    label: "Terrain",
    typeId: "terrain",
  },
};

const TN_CENTER = { lat: 10.7905, lng: 78.7047 };

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

function clearOverlays(registeredOverlays) {
  registeredOverlays.forEach(({ overlay, listeners = [] }) => {
    listeners.forEach((listener) => listener?.remove?.());
    overlay?.setMap?.(null);
  });
}

function buildMarkerIcon(googleMaps, options) {
  return {
    path: googleMaps.SymbolPath.CIRCLE,
    scale: options.scale,
    fillColor: options.fillColor,
    fillOpacity: options.fillOpacity ?? 0.88,
    strokeColor: options.strokeColor,
    strokeWeight: options.strokeWeight ?? 2,
  };
}

function toGooglePath(coordinates = []) {
  return coordinates.map(([lat, lng]) => ({ lat, lng }));
}

export default function GoogleOperationsMap({
  filters = {},
  onDistrictClick,
}) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);

  const [apiState, setApiState] = useState(apiKey ? "loading" : "missing");
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
  const [patrolUnits, setPatrolUnits] = useState([]);
  const [patrolRouteState, setPatrolRouteState] = useState("idle");

  const fetchLayers = async (nextFilters = filters) => {
    const query = buildQuery(nextFilters);
    const url = apiUrl(`/api/fir/map-layers${query ? `?${query}` : ""}`);
    setLoading(true);
    try {
      const response = await axios.get(url);
      setLayers(response.data);
      if (nextFilters.district) {
        setActiveDistrict(nextFilters.district);
      }
    } catch (error) {
      console.error("Google map layers error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLayers(filters);
  }, [filters]);

  useEffect(() => {
    axios
      .get(apiUrl("/api/fir/categories"))
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
        console.error("Google category load error:", error);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!showPatrol) {
      setPatrolUnits([]);
      setPatrolRouteState("idle");
      return undefined;
    }

    const patrolDistrict = filters.district || activeDistrict || null;
    if (!patrolDistrict) {
      setPatrolUnits([]);
      setPatrolRouteState("needs-district");
      return undefined;
    }

    setPatrolRouteState("loading");

    axios
      .post(apiUrl("/api/patrol/routes/generate"), {
        district: patrolDistrict,
        target_year: filters.year || undefined,
      })
      .then((response) => {
        if (cancelled) return;
        setPatrolUnits(response.data?.patrol_units || []);
        setPatrolRouteState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPatrolUnits([]);
        setPatrolRouteState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [activeDistrict, filters.district, filters.year, showPatrol]);

  useEffect(() => {
    let active = true;

    if (!apiKey) {
      setApiState("missing");
      return undefined;
    }

    loadGoogleMapsApi(apiKey)
      .then(() => {
        if (active) {
          setApiState("ready");
        }
      })
      .catch((error) => {
        console.error("Google Maps load error:", error);
        if (active) {
          setApiState("error");
        }
      });

    return () => {
      active = false;
    };
  }, [apiKey]);

  useEffect(() => {
    if (apiState !== "ready" || mapRef.current || !mapContainerRef.current) {
      return undefined;
    }

    mapRef.current = new window.google.maps.Map(mapContainerRef.current, {
      center: TN_CENTER,
      zoom: 7,
      mapTypeId: GOOGLE_MAP_STYLES.street.typeId,
      clickableIcons: false,
      fullscreenControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      zoomControl: true,
      gestureHandling: "greedy",
    });

    return () => {
      clearOverlays(overlaysRef.current);
      overlaysRef.current = [];
      mapRef.current = null;
    };
  }, [apiState]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setMapTypeId(GOOGLE_MAP_STYLES[mapStyle].typeId);
  }, [mapStyle]);

  const handleDistrictSelect = (district) => {
    setActiveDistrict(district);
    onDistrictClick && onDistrictClick(district);
  };

  const focusDistrict =
    layers?.districts.find(
      (item) => item.district === (filters.district || activeDistrict),
    ) || null;

  useEffect(() => {
    if (!mapRef.current) return;

    if (focusDistrict) {
      mapRef.current.panTo({ lat: focusDistrict.lat, lng: focusDistrict.lng });
      mapRef.current.setZoom(9);
    } else {
      mapRef.current.panTo(TN_CENTER);
      mapRef.current.setZoom(7);
    }
  }, [focusDistrict]);

  useEffect(() => {
    if (apiState !== "ready" || !mapRef.current || !layers) {
      return undefined;
    }

    const googleMaps = window.google.maps;
    const nextOverlays = [];
    const registerOverlay = (overlay, listeners = []) => {
      nextOverlays.push({ overlay, listeners });
      return overlay;
    };

    clearOverlays(overlaysRef.current);
    overlaysRef.current = [];

    if (showZones) {
      layers.zones.forEach((zone) => {
        const color = getCategoryColor(zone.dominant_category);
        const isActive = activeDistrict === zone.district;
        const circle = registerOverlay(
          new googleMaps.Circle({
            center: { lat: zone.lat, lng: zone.lng },
            radius: zone.radius_km * 1000,
            map: mapRef.current,
            fillColor: color,
            fillOpacity: isActive ? 0.2 : 0.1,
            strokeColor: isActive ? "#FFFFFF" : color,
            strokeOpacity: 1,
            strokeWeight: isActive ? 3 : 1.5,
          }),
        );

        const listener = circle.addListener("click", () =>
          handleDistrictSelect(zone.district),
        );
        nextOverlays[nextOverlays.length - 1].listeners.push(listener);
      });
    }

    if (showDistricts) {
      layers.districts.forEach((district) => {
        const isActive = activeDistrict === district.district;
        const marker = registerOverlay(
          new googleMaps.Marker({
            position: { lat: district.lat, lng: district.lng },
            map: mapRef.current,
            title: `${district.district} (${district.risk_level} risk)`,
            zIndex: isActive ? 10 : 5,
            icon: buildMarkerIcon(googleMaps, {
              scale: isActive
                ? getDistrictRadius(district.total) + 2
                : getDistrictRadius(district.total),
              fillColor: RISK_COLORS[district.risk_level],
              strokeColor: isActive
                ? "#FFFFFF"
                : RISK_COLORS[district.risk_level],
              strokeWeight: isActive ? 3 : 2,
            }),
          }),
        );

        const listener = marker.addListener("click", () =>
          handleDistrictSelect(district.district),
        );
        nextOverlays[nextOverlays.length - 1].listeners.push(listener);
      });
    }

    if (showStations) {
      layers.stations.forEach((station) => {
        const marker = registerOverlay(
          new googleMaps.Marker({
            position: { lat: station.lat, lng: station.lng },
            map: mapRef.current,
            title: station.station_name || station.taluk || station.station_id,
            icon: buildMarkerIcon(googleMaps, {
              scale: getStationRadius(station.total),
              fillColor: station.source_type === "osm" ? "#E2E8F0" : "#64748B",
              strokeColor: station.source_type === "osm" ? "#FFFFFF" : "#94A3B8",
              strokeWeight: 1.5,
            }),
          }),
        );

        const listener = marker.addListener("click", () =>
          handleDistrictSelect(station.district),
        );
        nextOverlays[nextOverlays.length - 1].listeners.push(listener);
      });
    }

    if (showHotspots) {
      layers.hotspots.forEach((hotspot) => {
        registerOverlay(
          new googleMaps.Circle({
            center: {
              lat: hotspot.center_lat,
              lng: hotspot.center_lng,
            },
            radius: hotspot.radius_km * 1000,
            map: mapRef.current,
            fillColor: RISK_COLORS[hotspot.risk_level],
            fillOpacity: 0.14,
            strokeColor: RISK_COLORS[hotspot.risk_level],
            strokeOpacity: 0.9,
            strokeWeight: 2,
          }),
        );
      });
    }

    if (showWomenSafety) {
      layers.women_zones.forEach((zone) => {
        registerOverlay(
          new googleMaps.Circle({
            center: { lat: zone.lat, lng: zone.lng },
            radius: zone.radius_km * 1000,
            map: mapRef.current,
            fillColor: "#EC4899",
            fillOpacity: 0.18,
            strokeColor: "#EC4899",
            strokeOpacity: 1,
            strokeWeight: 2,
          }),
        );
      });
    }

    if (showAccident) {
      layers.accident_zones.forEach((zone) => {
        registerOverlay(
          new googleMaps.Circle({
            center: { lat: zone.lat, lng: zone.lng },
            radius: zone.radius_km * 1000,
            map: mapRef.current,
            fillColor: "#F97316",
            fillOpacity: 0.18,
            strokeColor: "#F97316",
            strokeOpacity: 1,
            strokeWeight: 2,
          }),
        );
      });
    }

    if (showPatrol) {
      patrolUnits.forEach((route) => {
        const path =
          route.route_geometry?.coordinates?.map(([lng, lat]) => [lat, lng]) || [];
        if (path.length < 2) return;

        registerOverlay(
          new googleMaps.Polyline({
            path: toGooglePath(path),
            map: mapRef.current,
            strokeColor: "#38BDF8",
            strokeOpacity: 1,
            strokeWeight: 3,
          }),
        );
      });
    }

    overlaysRef.current = nextOverlays;

    return () => {
      clearOverlays(nextOverlays);
    };
  }, [
    activeDistrict,
    apiState,
    layers,
    patrolUnits,
    showAccident,
    showDistricts,
    showHotspots,
    showPatrol,
    showStations,
    showWomenSafety,
    showZones,
  ]);

  const handleDemoEntry = async () => {
    if (!layers?.districts?.length) return;
    const targetDistrict =
      activeDistrict || filters.district || layers.districts[0]?.district;
    setSubmittingDemo(true);
    try {
      const response = await axios.post(
        apiUrl("/api/fir/demo-entry"),
        {
          district: targetDistrict,
          category: demoCategory,
          count: Number(demoCount),
        },
      );
      handleDistrictSelect(response.data.entry.district);
      await fetchLayers(filters);
    } catch (error) {
      console.error("Google demo entry error:", error);
    } finally {
      setSubmittingDemo(false);
    }
  };

  if (loading || !layers) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-950">
        <p className="text-lg text-white animate-pulse">
          Building Tamil Nadu operations picture...
        </p>
      </div>
    );
  }

  if (apiState === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-950">
        <p className="text-lg text-white animate-pulse">
          Loading Google Maps...
        </p>
      </div>
    );
  }

  if (apiState === "error" || apiState === "missing") {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-950 p-6">
        <div className="max-w-md rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Google Maps could not start. Add a valid
          <span className="px-1 font-semibold text-white">
            VITE_GOOGLE_MAPS_API_KEY
          </span>
          in
          <span className="px-1 font-semibold text-white">frontend/.env</span>
          or remove the key to keep using the existing Leaflet map.
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1">
      <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

      <div className="absolute top-4 right-4 z-[1000] w-36 rounded-xl border border-white/10 bg-slate-900/40 p-2 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-all hover:bg-slate-900/50">
        <p className="mb-1.5 text-[8px] font-black uppercase tracking-[0.3em] text-white/50">
          MAP STYLE
        </p>
        <div className="mb-2 flex flex-col gap-1">
          {Object.entries(GOOGLE_MAP_STYLES).map(([key, style]) => (
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
            <label
              key={label}
              className="flex cursor-pointer items-center gap-1.5 rounded bg-gray-900/80 px-1.5 py-1 transition hover:bg-gray-800"
            >
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
            Generating continuous road-based patrol loops...
          </p>
        )}
        {showPatrol && patrolRouteState === "needs-district" && (
          <p className="mb-2 text-[8px] leading-4 text-cyan-100/80">
            Select a district to generate patrol loops.
          </p>
        )}
        {showPatrol && patrolRouteState === "error" && (
          <p className="mb-2 text-[8px] leading-4 text-amber-200/90">
            Patrol routing failed. Check OSRM connectivity.
          </p>
        )}

        <div className="mb-2 h-px w-full bg-white/10" />

        <p className="mb-1 text-[8px] font-black uppercase tracking-[0.3em] text-white/50">
          DEMO FIR
        </p>
        <div className="mb-2 flex flex-col gap-1.5">
          <div>
            <label className="mb-0.5 block text-[8px] font-semibold text-gray-400">
              Category
            </label>
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
            <label className="mb-0.5 block text-[8px] font-semibold text-gray-400">
              Cases ({demoCount})
            </label>
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

      <div className="absolute bottom-4 left-4 z-[1000] w-fit min-w-[220px] max-w-[280px] rounded-xl border border-white/10 bg-slate-900/40 p-2 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-all hover:bg-slate-900/50">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-cyan-400/90">
            GOOGLE OPS VIEW
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
            <span className="font-bold text-white">
              {layers.summary.incidents.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="mb-1.5 h-px w-full bg-white/10" />

        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8px]">
            <span className="font-bold uppercase tracking-widest text-white/50">
              Risk:
            </span>
            {Object.entries(RISK_COLORS).map(([level, color]) => (
              <div key={level} className="flex items-center gap-0.5">
                <div
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-white/80">{level}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8px]">
            <span className="font-bold uppercase tracking-widest text-white/50">
              Crime:
            </span>
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
          <p className="pt-1 text-[8px] leading-4 text-slate-300">
            Google is the basemap here. Crime overlays still come from your
            current backend APIs.
          </p>
        </div>
      </div>
    </div>
  );
}
