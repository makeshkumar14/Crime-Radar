import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { buildGoogleMapsDirectionsUrl } from "../lib/roadRouting";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

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

function accidentMarkerRadius(zone) {
  const accidentLoad = Number(zone?.predicted_accident) || 0;
  return Math.max(4, Math.min(10, 4 + accidentLoad / 3));
}

export default function TravelAdvisor() {
  const [taluks, setTaluks] = useState([]);
  const [form, setForm] = useState({
    origin_taluk_id: "",
    destination_taluk_id: "",
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [trackLocation, setTrackLocation] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState("");

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/api/fir/taluks`)
      .then((res) => {
        setTaluks(res.data.taluks);
        if (res.data.taluks.length >= 2) {
          setForm({
            origin_taluk_id: res.data.taluks[0].taluk_id,
            destination_taluk_id: res.data.taluks[1].taluk_id,
          });
        }
      })
      .catch((err) => console.error("Travel taluk load error:", err));
  }, []);

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
    () => (result?.accident_zones || []).slice(0, 30),
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
  }, [currentPositions, destinationPoint, originPoint, routesDiffer, safePositions, userLocation]);

  const currentDistance =
    result?.current_path?.distanceKm ?? result?.current_path?.distance_km ?? null;
  const safeDistance =
    result?.safer_path?.distanceKm ?? result?.safer_path?.distance_km ?? null;
  const currentDuration =
    result?.current_path?.durationMin ?? result?.current_path?.duration_min ?? null;
  const safeDuration =
    result?.safer_path?.durationMin ?? result?.safer_path?.duration_min ?? null;
  const currentAccidentExposure = result?.current_path?.accidentExposure ?? 0;
  const safeAccidentExposure = result?.safer_path?.accidentExposure ?? 0;
  const currentAccidentHits = result?.current_path?.accidentZoneHits ?? 0;
  const safeAccidentHits = result?.safer_path?.accidentZoneHits ?? 0;
  const currentSafetyScore = result?.current_path?.safety_score ?? null;
  const safeSafetyScore = result?.safer_path?.safety_score ?? null;
  const riskReduction = result?.risk_reduction ?? 0;
  const extraDistanceKm = result?.distance_delta_km ?? 0;
  const extraDurationMin = result?.duration_delta_min ?? null;
  const fastOriginSnap = result?.snap_debug?.fast?.origin ?? null;
  const fastDestinationSnap = result?.snap_debug?.fast?.destination ?? null;
  const isFallbackRoute =
    result?.current_path?.source?.startsWith("fallback") ||
    result?.safer_path?.source?.startsWith("fallback");

  const handleAnalyse = async () => {
    if (!form.origin_taluk_id || !form.destination_taluk_id || sameZoneSelected) {
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      const advisoryResponse = await axios.get(
        `${API_BASE_URL}/api/navigation/taluks/route`,
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
    const routePoints =
      pathType === "safer"
        ? result?.safer_path?.route || []
        : result?.current_path?.route || [];
    const strategy = pathType === "safer" && routesDiffer ? "corridor" : "direct";
    const url = buildGoogleMapsDirectionsUrl(routePoints, {
      strategy,
      useDeviceOrigin,
      maxWaypoints: pathType === "safer" && routesDiffer ? 6 : 2,
    });

    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="flex-1 overflow-hidden bg-gray-950 text-white">
      <div className="grid h-full grid-cols-[340px_1fr]">
        <div className="border-r border-gray-800 bg-gray-950 p-5">
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
          >
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
          >
            {taluks.map((taluk) => (
              <option key={taluk.taluk_id} value={taluk.taluk_id}>
                {taluk.taluk}, {taluk.district}
              </option>
            ))}
          </select>

          {sameZoneSelected && (
            <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Pick two different zones so the app can compare a real trip.
            </p>
          )}

          <button
            onClick={handleAnalyse}
            disabled={loading || sameZoneSelected}
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
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Recommendation
                </p>
                <p className="mt-2 text-sm font-semibold text-emerald-300">
                  {result.recommendation}
                </p>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Route Comparison
                </p>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-blue-300">Fastest route accident exposure</span>
                  <span>{currentAccidentExposure}</span>
                </div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-blue-300">Fastest route accident zones</span>
                  <span>{currentAccidentHits}</span>
                </div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-blue-300">Fastest route distance</span>
                  <span>{currentDistance} km</span>
                </div>
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="text-blue-300">Fastest route safety score</span>
                  <span>{currentSafetyScore ?? "n/a"}</span>
                </div>

                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-emerald-300">Safest route exposure</span>
                  <span>{safeAccidentExposure}</span>
                </div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-emerald-300">Safest route accident zones</span>
                  <span>{safeAccidentHits}</span>
                </div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-emerald-300">Safest route distance</span>
                  <span>{safeDistance} km</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-300">Safest route safety score</span>
                  <span>{safeSafetyScore ?? "n/a"}</span>
                </div>

                <div className="mb-2 mt-3 flex items-center justify-between text-sm">
                  <span className="text-blue-300">Fastest route ETA</span>
                  <span>{formatMinutes(currentDuration)}</span>
                </div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-emerald-300">Safest route ETA</span>
                  <span>{formatMinutes(safeDuration)}</span>
                </div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-cyan-300">Exposure reduction</span>
                  <span>{riskReduction > 0 ? `${riskReduction} pts` : "No gain"}</span>
                </div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-cyan-300">Extra distance</span>
                  <span>{extraDistanceKm > 0 ? `+${extraDistanceKm} km` : "None"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-cyan-300">Extra drive time</span>
                  <span>
                    {Number.isFinite(extraDurationMin) && extraDurationMin > 0
                      ? `+${extraDurationMin} min`
                      : "None"}
                  </span>
                </div>
                <div className="mt-3 rounded-lg bg-gray-950/60 px-3 py-2 text-xs text-slate-300">
                  {routesDiffer
                    ? "A safest-route corridor was found and scored against predicted accident zones before being recommended."
                    : "No meaningfully safer detour was found for this origin-destination pair."}
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
                    No accident-heavy zones were detected on the selected route.
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
                          to zone: {alert.min_distance_km ?? "n/a"} km
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

        <div className="relative">
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
              />
            )}

            {currentPositions.length > 1 && (
              <Polyline
                positions={currentPositions}
                pathOptions={{ color: ROUTE_COLORS.fast, weight: 4, opacity: 0.95 }}
              />
            )}

            {accidentZones.map((zone) => (
              <CircleMarker
                key={`${zone.taluk_id || zone.taluk}-${zone.district}`}
                center={[zone.lat, zone.lng]}
                radius={accidentMarkerRadius(zone)}
                pathOptions={{
                  color: ROUTE_COLORS.accident,
                  fillColor: ROUTE_COLORS.accident,
                  fillOpacity: 0.65,
                  opacity: 0.95,
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                  {zone.taluk}, {zone.district} | Accident score {zone.predicted_accident}
                </Tooltip>
              </CircleMarker>
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
              <div className="h-3 w-3 rounded-full bg-red-500" />
              <span>Accident zones</span>
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
            {!loading && result?.status === "ok" && !routesDiffer && (
              <p className="mt-3 text-[11px] text-slate-300">
                The safest option follows the same road corridor as the fastest route.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
