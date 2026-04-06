import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsDirectionsUrlFromQueries,
} from "../lib/roadRouting";
import { apiUrl } from "../lib/api";

const ROUTE_COLORS = {
  fast: "#2563EB",
  safe: "#22C55E",
  accident: "#EF4444",
  origin: "#38BDF8",
  destination: "#F59E0B",
  user: "#F8FAFC",
};

function RouteViewport({ positions }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length < 2) {
      return;
    }

    map.fitBounds(positions, {
      padding: [48, 48],
      maxZoom: 11,
    });
  }, [map, positions]);

  return null;
}

function pathToLeafletPositions(points = []) {
  return points
    .map((point) => {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }
      return [lat, lng];
    })
    .filter(Boolean);
}

function formatMinutes(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${value} min`;
}

function formatDistance(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${value} km`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${value}%`;
}

function formatDelta(value, unit) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  if (value === 0) {
    return `0 ${unit}`;
  }
  return `${value > 0 ? "+" : ""}${value} ${unit}`;
}

function routeRiskTone(riskLabel) {
  if (riskLabel === "HIGH") {
    return "text-rose-300";
  }
  if (riskLabel === "MEDIUM") {
    return "text-amber-300";
  }
  return "text-emerald-300";
}

function zoneStyle(zone) {
  if (zone?.avoided_by_safer) {
    return {
      color: "#22C55E",
      fillColor: "#22C55E",
      fillOpacity: 0.12,
      opacity: 0.95,
      weight: 2,
    };
  }
  if (zone?.crossed_by_safer) {
    return {
      color: "#F97316",
      fillColor: "#F97316",
      fillOpacity: 0.2,
      opacity: 0.95,
      weight: 2,
    };
  }
  if (zone?.crossed_by_fastest) {
    return {
      color: "#EF4444",
      fillColor: "#EF4444",
      fillOpacity: 0.18,
      opacity: 0.95,
      weight: 2,
    };
  }
  return {
    color: "#F59E0B",
    fillColor: "#F59E0B",
    fillOpacity: 0.1,
    opacity: 0.8,
    weight: 1.5,
  };
}

function zoneTooltipLabel(zone) {
  if (zone?.avoided_by_safer) {
    return "Safer route avoids this accident-prone area";
  }
  if (zone?.crossed_by_safer) {
    return "Fallback safer route still passes through this buffered zone";
  }
  if (zone?.crossed_by_fastest) {
    return "Fastest route passes through this buffered accident zone";
  }
  return "Route comes close to this accident-prone area";
}

function selectionProfileLabel(profile) {
  if (profile === "strict_safe_balanced") {
    return "Strict avoidance";
  }
  if (profile === "least_risky_balanced_fallback") {
    return "Balanced fallback";
  }
  if (profile === "least_risky_unbalanced_fallback") {
    return "Least-risk fallback";
  }
  if (profile === "fast_only") {
    return "Fast mode";
  }
  return "Comparison";
}

export default function TravelAdvisor() {
  const [taluks, setTaluks] = useState([]);
  const [form, setForm] = useState({
    origin_taluk_id: "",
    destination_taluk_id: "",
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [taluksLoading, setTaluksLoading] = useState(false);
  const [taluksError, setTaluksError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [trackLocation, setTrackLocation] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState("");

  const loadTaluks = useCallback(async () => {
    setTaluksLoading(true);
    setTaluksError("");
    try {
      const res = await axios.get(apiUrl("/api/fir/taluks"));
      const nextTaluks = res.data.taluks || [];
      setTaluks(nextTaluks);
      if (nextTaluks.length >= 2) {
        setForm((prev) => {
          const talukIds = new Set(nextTaluks.map((taluk) => taluk.taluk_id));
          const originValid = talukIds.has(prev.origin_taluk_id);
          const destinationValid = talukIds.has(prev.destination_taluk_id);
          if (originValid && destinationValid && prev.origin_taluk_id !== prev.destination_taluk_id) {
            return prev;
          }
          return {
            origin_taluk_id: nextTaluks[0].taluk_id,
            destination_taluk_id: nextTaluks[1].taluk_id,
          };
        });
      }
      return nextTaluks.length >= 2;
    } catch (err) {
      console.error("Travel taluk load error:", err);
      setTaluksError("We couldn't load the origin and destination zones.");
      return false;
    } finally {
      setTaluksLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;

    const loadWithRetry = async () => {
      const loaded = await loadTaluks();
      if (!loaded && !cancelled) {
        retryTimer = globalThis.setTimeout(() => {
          if (!cancelled) {
            loadTaluks();
          }
        }, 2500);
      }
    };

    loadWithRetry();

    return () => {
      cancelled = true;
      if (retryTimer) {
        globalThis.clearTimeout(retryTimer);
      }
    };
  }, [loadTaluks]);

  useEffect(() => {
    if (!trackLocation) {
      setUserLocation(null);
      setLocationError("");
      return undefined;
    }

    if (!navigator.geolocation) {
      setLocationError("Live location is not available in this browser.");
      return undefined;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLocationError("");
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => {
        setLocationError("We could not read your live location.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [trackLocation]);

  const currentPositions = useMemo(
    () => pathToLeafletPositions(result?.current_path?.route || []),
    [result],
  );

  const safePositions = useMemo(
    () => pathToLeafletPositions(result?.safer_path?.route || []),
    [result],
  );

  const accidentZones = useMemo(
    () => (result?.accident_zones || []).slice(0, 36),
    [result],
  );

  const routesDiffer = Boolean(result?.route_diverges);
  const originPoint = result?.origin || null;
  const destinationPoint = result?.destination || null;
  const sameZoneSelected =
    form.origin_taluk_id && form.origin_taluk_id === form.destination_taluk_id;

  const visibleBounds = useMemo(() => {
    const bounds = [...currentPositions];
    if (safePositions.length > 0) {
      bounds.push(...safePositions);
    }
    if (originPoint?.lat && originPoint?.lng) {
      bounds.push([originPoint.lat, originPoint.lng]);
    }
    if (destinationPoint?.lat && destinationPoint?.lng) {
      bounds.push([destinationPoint.lat, destinationPoint.lng]);
    }
    if (userLocation?.lat && userLocation?.lng) {
      bounds.push([userLocation.lat, userLocation.lng]);
    }
    return bounds;
  }, [currentPositions, destinationPoint, originPoint, safePositions, userLocation]);

  const fastestRoute = result?.fastest_route ?? null;
  const saferRoute = result?.safer_route ?? null;
  const comparison = result?.comparison ?? null;
  const routingPolicy = result?.routing_policy ?? null;
  const currentDistance =
    fastestRoute?.distance_km ??
    result?.current_path?.distanceKm ??
    result?.current_path?.distance_km ??
    null;
  const safeDistance =
    saferRoute?.distance_km ??
    result?.safer_path?.distanceKm ??
    result?.safer_path?.distance_km ??
    null;
  const currentDuration =
    fastestRoute?.eta_min ??
    result?.current_path?.durationMin ??
    result?.current_path?.duration_min ??
    null;
  const safeDuration =
    saferRoute?.eta_min ??
    result?.safer_path?.durationMin ??
    result?.safer_path?.duration_min ??
    null;
  const currentAccidentHits =
    fastestRoute?.accident_zones_crossed ?? result?.current_path?.accidentZoneHits ?? 0;
  const safeAccidentHits =
    saferRoute?.accident_zones_crossed ?? result?.safer_path?.accidentZoneHits ?? 0;
  const currentNearbyHits =
    fastestRoute?.accident_zones_nearby ?? result?.current_path?.nearZoneHits ?? 0;
  const safeNearbyHits =
    saferRoute?.accident_zones_nearby ?? result?.safer_path?.nearZoneHits ?? 0;
  const currentRiskLabel = fastestRoute?.risk_score ?? result?.current_path?.risk_label ?? "n/a";
  const safeRiskLabel = saferRoute?.risk_score ?? result?.safer_path?.risk_label ?? "n/a";
  const currentRiskValue =
    fastestRoute?.risk_score_value ?? result?.current_path?.riskScoreValue ?? null;
  const safeRiskValue =
    saferRoute?.risk_score_value ?? result?.safer_path?.riskScoreValue ?? null;
  const riskReduction = comparison?.risk_reduction ?? result?.risk_reduction ?? 0;
  const extraDistanceKm = comparison?.distance_delta_km ?? result?.distance_delta_km ?? 0;
  const extraDurationMin = comparison?.duration_delta_min ?? result?.duration_delta_min ?? null;
  const extraDistancePct =
    comparison?.distance_increase_pct ?? saferRoute?.distance_increase_pct ?? null;
  const extraEtaPct = comparison?.eta_increase_pct ?? saferRoute?.eta_increase_pct ?? null;
  const zonesAvoided = comparison?.zones_avoided ?? saferRoute?.zones_avoided ?? 0;
  const selectedRouteBalanced =
    comparison?.selected_route_balanced ??
    saferRoute?.within_balance_limits ??
    true;
  const selectionProfile =
    comparison?.selection_profile ?? saferRoute?.selection_profile ?? null;
  const fastOriginSnap = result?.snap_debug?.fast?.origin ?? null;
  const fastDestinationSnap = result?.snap_debug?.fast?.destination ?? null;
  const isFallbackRoute =
    result?.current_path?.source?.startsWith("fallback") ||
    result?.safer_path?.source?.startsWith("fallback");
  const noSaferDetourFound = !routesDiffer && currentAccidentHits > 0;

  const handleAnalyse = async () => {
    if (!form.origin_taluk_id || !form.destination_taluk_id || sameZoneSelected) {
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      const advisoryResponse = await axios.get(
        apiUrl("/api/navigation/taluks/route"),
        {
          params: {
            ...form,
            mode: "compare",
          },
        },
      );

      const advisory = advisoryResponse.data;
      if (advisory?.status !== "ok") {
        setResult(advisory);
        setErrorMessage(advisory?.message || "Route analysis failed.");
        return;
      }

      setResult(advisory);
      if (advisory?.current_path?.source?.startsWith("fallback")) {
        setNoticeMessage(
          "OSRM was unavailable, so this preview has fallen back to an approximate straight-line route.",
        );
      } else if (
        !advisory?.route_diverges &&
        (advisory?.current_path?.accidentZoneHits ?? 0) > 0
      ) {
        setNoticeMessage(
          "The advisor checked extra road detours, but no better real-road corridor reduced the accident-zone exposure for this trip.",
        );
      } else if (advisory?.safer_path?.source?.startsWith("osrm-safe")) {
        setNoticeMessage(
          "The backend compared the fastest route with a safest-route profile before recommending the lower-risk drive.",
        );
      } else {
        setNoticeMessage(
          "The backend built fastest and safest road options and screened both against predicted accident zones.",
        );
      }
    } catch (error) {
      console.error("Navigation route advisory error:", error);
      setResult(null);
      setErrorMessage("We couldn't analyse that trip right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const openGoogleMaps = (pathType, { useDeviceOrigin = false } = {}) => {
    const selectedPath =
      pathType === "safer" ? result?.safer_path || null : result?.current_path || null;
    const namedOriginQuery = selectedPath?.maps_origin_query || result?.origin_query || "";
    const namedDestinationQuery =
      selectedPath?.maps_destination_query || result?.destination_query || "";
    const namedWaypointQueries = selectedPath?.maps_waypoint_queries || [];
    const namedUrl = buildGoogleMapsDirectionsUrlFromQueries({
      originQuery: namedOriginQuery,
      destinationQuery: namedDestinationQuery,
      waypointQueries: namedWaypointQueries,
      useDeviceOrigin,
    });
    if (namedUrl && (namedWaypointQueries.length > 0 || pathType === "current")) {
      window.open(namedUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const requestPoints = selectedPath?.request_coordinates || [];
    const routePoints = requestPoints.length >= 2 ? requestPoints : selectedPath?.route || [];
    const strategy =
      requestPoints.length > 2
        ? "explicit"
        : pathType === "safer" && routesDiffer
          ? "corridor"
          : "direct";
    const url = buildGoogleMapsDirectionsUrl(routePoints, {
      strategy,
      useDeviceOrigin,
      maxWaypoints: Math.max(
        2,
        requestPoints.length > 2
          ? requestPoints.length - 2
          : pathType === "safer" && routesDiffer
            ? 6
            : 2,
      ),
    });

    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="flex-1 overflow-hidden bg-gray-950 text-white">
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-b border-gray-800 bg-gray-950 p-5 lg:border-b-0 lg:border-r">
          <h2 className="mb-2 text-xl font-bold">Travel Safety Advisor</h2>
          <p className="mb-5 text-sm text-gray-400">
            Pick any two taluks, find the road route, and compare the fastest
            corridor with the safest available drive across Tamil Nadu.
          </p>

          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">
            Origin Zone
          </label>
          <select
            value={form.origin_taluk_id}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, origin_taluk_id: event.target.value }))
            }
            className="mb-4 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
            disabled={taluksLoading || taluks.length === 0}
          >
            {taluks.length === 0 && (
              <option value="">
                {taluksLoading ? "Loading zones..." : "No zones available"}
              </option>
            )}
            {taluks.map((taluk) => (
              <option key={taluk.taluk_id} value={taluk.taluk_id}>
                {taluk.taluk}, {taluk.district}
              </option>
            ))}
          </select>

          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">
            Destination Zone
          </label>
          <select
            value={form.destination_taluk_id}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, destination_taluk_id: event.target.value }))
            }
            className="mb-4 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
            disabled={taluksLoading || taluks.length === 0}
          >
            {taluks.length === 0 && (
              <option value="">
                {taluksLoading ? "Loading zones..." : "No zones available"}
              </option>
            )}
            {taluks.map((taluk) => (
              <option key={taluk.taluk_id} value={taluk.taluk_id}>
                {taluk.taluk}, {taluk.district}
              </option>
            ))}
          </select>

          {taluksError && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              <p>{taluksError}</p>
              <button
                onClick={loadTaluks}
                className="mt-2 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/20"
              >
                Retry loading zones
              </button>
            </div>
          )}

          {sameZoneSelected && (
            <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Pick two different zones so the app can compare a real trip.
            </p>
          )}

          <button
            onClick={handleAnalyse}
            disabled={loading || sameZoneSelected || taluksLoading || taluks.length < 2}
            className="mb-3 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? "Finding Route..." : "Find Route"}
          </button>

          <button
            onClick={() => setTrackLocation((prev) => !prev)}
            className="mb-5 w-full rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
          >
            {trackLocation ? "Stop Live Location" : "Start Live Location"}
          </button>

          {noticeMessage && (
            <div className="mb-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm text-cyan-100">
              {noticeMessage}
            </div>
          )}

          {locationError && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              {locationError}
            </div>
          )}

          {errorMessage && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              {errorMessage}
            </div>
          )}

          {result?.status === "ok" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Recommendation
                  </p>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-200">
                    {selectionProfileLabel(selectionProfile)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold text-emerald-300">
                  {result.recommendation}
                </p>
                <div className="mt-3 grid gap-2 text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>Accident buffers</span>
                    <span>{routingPolicy?.strict_buffer_m ?? "n/a"} m</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Warning radius</span>
                    <span>{routingPolicy?.warning_buffer_m ?? "n/a"} m</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Safer route avoided</span>
                    <span>{zonesAvoided} zones</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Fast vs Safe
                </p>
                <div className="grid gap-3">
                  <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-blue-100">Fastest Route</p>
                      <span className={`text-xs font-semibold ${routeRiskTone(currentRiskLabel)}`}>
                        {currentRiskLabel}
                      </span>
                    </div>
                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Distance</span>
                        <span>{formatDistance(currentDistance)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">ETA</span>
                        <span>{formatMinutes(currentDuration)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Crossed zones</span>
                        <span>{currentAccidentHits}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Nearby zones</span>
                        <span>{currentNearbyHits}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Risk score value</span>
                        <span>{currentRiskValue ?? "n/a"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-emerald-100">Safer Route</p>
                      <span className={`text-xs font-semibold ${routeRiskTone(safeRiskLabel)}`}>
                        {safeRiskLabel}
                      </span>
                    </div>
                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Distance</span>
                        <span>{formatDistance(safeDistance)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">ETA</span>
                        <span>{formatMinutes(safeDuration)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Crossed zones</span>
                        <span>{safeAccidentHits}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Nearby zones</span>
                        <span>{safeNearbyHits}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Zones avoided</span>
                        <span>{zonesAvoided}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Risk score value</span>
                        <span>{safeRiskValue ?? "n/a"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Balance Guardrails
                </p>
                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-cyan-300">Exposure reduction</span>
                    <span>{riskReduction > 0 ? `${riskReduction} pts` : "No gain"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-cyan-300">Extra distance</span>
                    <span>{formatDelta(extraDistanceKm, "km")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-cyan-300">Distance increase</span>
                    <span>{formatPercent(extraDistancePct)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-cyan-300">Extra drive time</span>
                    <span>{formatDelta(extraDurationMin, "min")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-cyan-300">ETA increase</span>
                    <span>{formatPercent(extraEtaPct)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-cyan-300">Within route limits</span>
                    <span className={selectedRouteBalanced ? "text-emerald-300" : "text-amber-300"}>
                      {selectedRouteBalanced ? "Yes" : "Fallback"}
                    </span>
                  </div>
                </div>
                <div className="mt-3 rounded-lg bg-gray-950/60 px-3 py-2 text-xs text-slate-300">
                  Max distance increase {routingPolicy?.max_distance_increase_pct ?? "n/a"}% and
                  max ETA increase {routingPolicy?.max_eta_increase_pct ?? "n/a"}%.
                </div>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Drive With Google Maps
                </p>
                <div className="grid gap-2">
                  <button
                    onClick={() => openGoogleMaps("current")}
                    className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-left text-sm font-medium text-blue-100 transition hover:bg-blue-500/20"
                  >
                    Open fastest route in Google Maps
                  </button>
                  <button
                    onClick={() => openGoogleMaps("safer")}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-left text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/20"
                  >
                    Open safest route in Google Maps
                  </button>
                  <button
                    onClick={() => openGoogleMaps("safer", { useDeviceOrigin: true })}
                    className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-left text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/20"
                  >
                    Start safest drive from my current location
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  The exported route uses the corridor we analysed in the backend
                  so you can switch from preview mode to turn-by-turn navigation.
                </p>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Accident Alerts On Fast Route
                </p>
                {(result.alerts || []).length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No buffered accident zones were detected on the fastest route.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {result.alerts.map((alert) => (
                      <div
                        key={`${alert.district}-${alert.taluk}`}
                        className="rounded-lg bg-gray-950/60 p-3 text-sm"
                      >
                        <p className="font-semibold text-white">
                          {alert.taluk}, {alert.district}
                        </p>
                        <p className="text-gray-400">
                          Accident score: {alert.predicted_accident ?? "n/a"} | Route distance
                          to zone: {alert.min_distance_km ?? "n/a"} km | Buffer{" "}
                          {alert.strict_buffer_m ?? "n/a"} m
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(fastOriginSnap || fastDestinationSnap) && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    OSRM Snap Debug
                  </p>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-blue-300">Origin snap distance</span>
                    <span>
                      {Number.isFinite(fastOriginSnap?.snap_distance_m)
                        ? `${fastOriginSnap.snap_distance_m} m`
                        : "n/a"}
                    </span>
                  </div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-blue-300">Destination snap distance</span>
                    <span>
                      {Number.isFinite(fastDestinationSnap?.snap_distance_m)
                        ? `${fastDestinationSnap.snap_distance_m} m`
                        : "n/a"}
                    </span>
                  </div>
                  <div className="rounded-lg bg-gray-950/60 px-3 py-2 text-xs text-slate-300">
                    Origin snapped to {fastOriginSnap?.name || "unknown road"} and
                    destination snapped to {fastDestinationSnap?.name || "unknown road"}.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative min-h-[440px] lg:min-h-0">
          <MapContainer
            center={[10.7905, 78.7047]}
            zoom={7}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="(C) OpenStreetMap contributors"
            />

            <RouteViewport positions={visibleBounds} />

            {safePositions.length > 1 && (
              <Polyline
                positions={safePositions}
                pathOptions={{ color: ROUTE_COLORS.safe, weight: 8, opacity: 0.5 }}
              >
                <Tooltip sticky opacity={0.95}>
                  {zonesAvoided > 0
                    ? `Safer route avoids ${zonesAvoided} accident-prone areas`
                    : "Safest available road route"}
                </Tooltip>
              </Polyline>
            )}

            {currentPositions.length > 1 && (
              <Polyline
                positions={currentPositions}
                pathOptions={{ color: ROUTE_COLORS.fast, weight: 4, opacity: 0.95 }}
              >
                <Tooltip sticky opacity={0.95}>
                  Fastest route
                </Tooltip>
              </Polyline>
            )}

            {accidentZones.map((zone) => (
              <Circle
                key={`${zone.taluk_id || zone.taluk}-${zone.district}`}
                center={[zone.lat, zone.lng]}
                radius={Math.max(150, Number(zone.buffer_radius_m) || 350)}
                pathOptions={zoneStyle(zone)}
              >
                <Tooltip direction="top" opacity={0.95}>
                  <div className="space-y-1 text-xs">
                    <p className="font-semibold">
                      {zone.taluk}, {zone.district}
                    </p>
                    <p>{zoneTooltipLabel(zone)}</p>
                    <p>Accident score: {zone.predicted_accident ?? "n/a"}</p>
                    <p>Buffer radius: {zone.buffer_radius_m ?? "n/a"} m</p>
                    <p>Fastest route distance: {zone.fastest_distance_km ?? "n/a"} km</p>
                    <p>Safer route distance: {zone.safer_distance_km ?? "n/a"} km</p>
                  </div>
                </Tooltip>
              </Circle>
            ))}

            {originPoint?.lat && originPoint?.lng && (
              <CircleMarker
                center={[originPoint.lat, originPoint.lng]}
                radius={9}
                pathOptions={{
                  color: ROUTE_COLORS.origin,
                  fillColor: ROUTE_COLORS.origin,
                  fillOpacity: 0.9,
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                  Origin
                </Tooltip>
              </CircleMarker>
            )}

            {destinationPoint?.lat && destinationPoint?.lng && (
              <CircleMarker
                center={[destinationPoint.lat, destinationPoint.lng]}
                radius={9}
                pathOptions={{
                  color: ROUTE_COLORS.destination,
                  fillColor: ROUTE_COLORS.destination,
                  fillOpacity: 0.9,
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                  Destination
                </Tooltip>
              </CircleMarker>
            )}

            {userLocation?.lat && userLocation?.lng && (
              <CircleMarker
                center={[userLocation.lat, userLocation.lng]}
                radius={7}
                pathOptions={{
                  color: "#0F172A",
                  fillColor: ROUTE_COLORS.user,
                  fillOpacity: 1,
                  opacity: 1,
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                  Your location
                  {Number.isFinite(userLocation.accuracy) &&
                    ` (${Math.round(userLocation.accuracy)} m)`}
                </Tooltip>
              </CircleMarker>
            )}
          </MapContainer>

          <div className="absolute bottom-6 right-6 z-[1000] rounded-xl border border-gray-700/70 bg-gray-950/85 p-3 text-xs text-white shadow-xl backdrop-blur-md">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-sky-400" />
              <span>Source</span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-amber-400" />
              <span>Destination</span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <div className="h-2.5 w-8 rounded-full bg-blue-500" />
              <span>Fastest route</span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <div className="h-2.5 w-8 rounded-full bg-emerald-500" />
              <span>Safest route</span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full border border-emerald-400 bg-emerald-500/20" />
              <span>Avoided accident zones</span>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full border border-red-400 bg-red-500/20" />
              <span>Crossed accident zones</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-white" />
              <span>Live location</span>
            </div>
            {loading && (
              <p className="mt-3 text-[11px] text-slate-300">
                Building the fastest and safest road routes and checking accident exposure...
              </p>
            )}
            {!loading && isFallbackRoute && (
              <p className="mt-3 text-[11px] text-amber-200">
                Live road directions were unavailable, so this preview is approximate.
              </p>
            )}
            {!loading && result?.status === "ok" && noSaferDetourFound && (
              <p className="mt-3 text-[11px] text-amber-200">
                No safer road detour cleared the accident corridor, so both previews use the
                same route.
              </p>
            )}
            {!loading && result?.status === "ok" && !routesDiffer && !noSaferDetourFound && (
              <p className="mt-3 text-[11px] text-slate-300">
                The safest option follows the same road corridor as the fastest route.
              </p>
            )}
            {!loading && result?.status === "ok" && zonesAvoided > 0 && (
              <p className="mt-3 text-[11px] text-emerald-200">
                Safer route avoids {zonesAvoided} accident-prone areas.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
