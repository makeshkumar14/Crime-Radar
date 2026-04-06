import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { fetchRoadRoute } from "../lib/roadRouting";

const ROUTE_COLORS = {
  current: "#EF4444",
  safer: "#22C55E",
};

function RouteViewport({ positions }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length < 2) return;
    map.fitBounds(positions, {
      padding: [48, 48],
      maxZoom: 10,
    });
  }, [map, positions]);

  return null;
}

export default function TravelAdvisor() {
  const [taluks, setTaluks] = useState([]);
  const [form, setForm] = useState({
    origin_taluk_id: "",
    destination_taluk_id: "",
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [routeVisuals, setRouteVisuals] = useState({
    current: null,
    safer: null,
  });
  const [routeVisualState, setRouteVisualState] = useState("idle");

  useEffect(() => {
    axios
      .get("http://localhost:8000/api/fir/taluks")
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
    let cancelled = false;

    if (result?.status !== "ok") {
      setRouteVisuals({ current: null, safer: null });
      setRouteVisualState("idle");
      return undefined;
    }

    setRouteVisualState("loading");

    Promise.all([
      fetchRoadRoute(result.current_path?.route || []),
      fetchRoadRoute(result.safer_path?.route || []),
    ])
      .then(([current, safer]) => {
        if (cancelled) return;
        setRouteVisuals({ current, safer });
        setRouteVisualState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setRouteVisuals({ current: null, safer: null });
        setRouteVisualState("idle");
      });

    return () => {
      cancelled = true;
    };
  }, [result]);

  const currentPositions = useMemo(
    () => routeVisuals.current?.coordinates || [],
    [routeVisuals],
  );

  const safePositions = useMemo(
    () => routeVisuals.safer?.coordinates || [],
    [routeVisuals],
  );

  const visibleBounds = useMemo(
    () => [...currentPositions, ...safePositions],
    [currentPositions, safePositions],
  );

  const currentDistance = routeVisuals.current?.distanceKm ?? result?.current_path?.distance_km;
  const safeDistance = routeVisuals.safer?.distanceKm ?? result?.safer_path?.distance_km;
  const currentDuration = routeVisuals.current?.durationMin;
  const safeDuration = routeVisuals.safer?.durationMin;
  const isFallbackRoute =
    routeVisuals.current?.source === "fallback" || routeVisuals.safer?.source === "fallback";

  const handleAnalyse = async () => {
    if (!form.origin_taluk_id || !form.destination_taluk_id) return;
    setLoading(true);
    try {
      const response = await axios.get("http://localhost:8000/api/citizen/route-advisory", {
        params: form,
      });
      setResult(response.data);
    } catch (error) {
      console.error("Route advisory error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-hidden bg-gray-950 text-white">
      <div className="grid h-full grid-cols-[340px_1fr]">
        <div className="border-r border-gray-800 bg-gray-950 p-5">
          <h2 className="mb-2 text-xl font-bold">Travel Safety Advisor</h2>
          <p className="mb-5 text-sm text-gray-400">
            Analyse the crime-risk of a planned route and get a safer alternate
            path using forecasted taluk-level risk.
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

          <button
            onClick={handleAnalyse}
            disabled={loading}
            className="mb-5 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? "Analysing Route..." : "Check Route Safety"}
          </button>

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
                  <span className="text-red-300">Current path risk</span>
                  <span>{result.current_path.risk_score}</span>
                </div>
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="text-red-300">Current distance</span>
                  <span>{currentDistance} km</span>
                </div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-emerald-300">Safer path risk</span>
                  <span>{result.safer_path.risk_score}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-300">Safer distance</span>
                  <span>{safeDistance} km</span>
                </div>
                {(currentDuration || safeDuration) && (
                  <>
                    <div className="mb-2 mt-3 flex items-center justify-between text-sm">
                      <span className="text-red-300">Current ETA</span>
                      <span>{currentDuration ? `${currentDuration} min` : "n/a"}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-emerald-300">Safer ETA</span>
                      <span>{safeDuration ? `${safeDuration} min` : "n/a"}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Crime Alerts On Current Path
                </p>
                {(result.alerts || []).length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No high-risk alert zones on the selected path.
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
                          Predicted risk: {alert.risk_score} | Dominant crime:{" "}
                          {alert.predicted_top_category}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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

            {currentPositions.length > 1 && (
              <Polyline
                positions={currentPositions}
                pathOptions={{ color: ROUTE_COLORS.current, weight: 4 }}
              />
            )}

            {safePositions.length > 1 && (
              <Polyline
                positions={safePositions}
                pathOptions={{ color: ROUTE_COLORS.safer, weight: 4, dashArray: "8 6" }}
              />
            )}

            {(result?.current_path?.route || []).map((point) => (
              <CircleMarker
                key={`current-${point.taluk_id}`}
                center={[point.lat, point.lng]}
                radius={5}
                pathOptions={{
                  color: ROUTE_COLORS.current,
                  fillColor: ROUTE_COLORS.current,
                  fillOpacity: 0.9,
                }}
              />
            ))}

            {(result?.safer_path?.route || []).map((point) => (
              <CircleMarker
                key={`safe-${point.taluk_id}`}
                center={[point.lat, point.lng]}
                radius={5}
                pathOptions={{
                  color: ROUTE_COLORS.safer,
                  fillColor: ROUTE_COLORS.safer,
                  fillOpacity: 0.9,
                }}
              />
            ))}
          </MapContainer>

          <div className="absolute bottom-6 left-6 z-[1000] rounded-xl border border-gray-700/70 bg-gray-950/85 p-3 text-xs text-white shadow-xl backdrop-blur-md">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-2.5 w-8 rounded-full bg-red-500" />
              <span>Current route</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-8 rounded-full border border-emerald-300 bg-emerald-500/70" />
              <span>Safer suggested route</span>
            </div>
            {routeVisualState === "loading" && (
              <p className="mt-3 text-[11px] text-slate-300">
                Snapping route to the road network...
              </p>
            )}
            {routeVisualState === "ready" && isFallbackRoute && (
              <p className="mt-3 text-[11px] text-amber-200">
                Road routing is unavailable right now, so this view is approximate.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
