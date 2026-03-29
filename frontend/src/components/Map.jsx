import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Popup,
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

function getRiskLevel(count) {
  if (count > 500) return "HIGH";
  if (count > 200) return "MEDIUM";
  return "LOW";
}

function getRadius(count) {
  if (count > 500) return 18;
  if (count > 200) return 12;
  return 7;
}

function MapController({ markers, filters }) {
  const map = useMap();

  useEffect(() => {
    if (filters.district && markers.length > 0) {
      const district = markers.find((m) => m.district === filters.district);
      if (district) {
        map.flyTo([district.lat, district.lng], 10, { duration: 1.5 });
      }
    } else if (markers.length > 0) {
      map.flyTo([10.7905, 78.7047], 7, { duration: 1.5 });
    }
  }, [filters, markers]);

  return null;
}

export default function Map({ filters = {} }) {
  const [markers, setMarkers] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showDistricts, setShowDistricts] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.year) params.append("year", filters.year);
    if (filters.district) params.append("district", filters.district);
    if (filters.category) params.append("category", filters.category);

    const url = `http://localhost:8000/api/fir/all?${params.toString()}`;

    setLoading(true);
    axios
      .get(url)
      .then((res) => {
        const districtMap = {};
        res.data.data.forEach((record) => {
          const key = record.district;
          if (!districtMap[key]) {
            districtMap[key] = {
              district: record.district,
              lat: record.lat,
              lng: record.lng,
              total: 0,
              categories: {},
            };
          }
          districtMap[key].total += record.count;
          districtMap[key].categories[record.category] =
            (districtMap[key].categories[record.category] || 0) + record.count;
        });
        setMarkers(Object.values(districtMap));
        setLoading(false);
      })
      .catch((err) => {
        console.error("API error:", err);
        setLoading(false);
      });
  }, [filters]);

  useEffect(() => {
    axios
      .get("http://localhost:8000/api/hotspots/all")
      .then((res) => setHotspots(res.data.hotspots))
      .catch((err) => console.error("Hotspot error:", err));
  }, []);

  if (loading)
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <p className="text-white text-xl animate-pulse">
          Loading crime data...
        </p>
      </div>
    );

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
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap"
        />

        <MapController markers={markers} filters={filters} />

        {/* District markers */}
        {showDistricts &&
          markers.map((m, i) => {
            const risk = getRiskLevel(m.total);
            const color = RISK_COLORS[risk];
            const topCrime = Object.entries(m.categories).sort(
              (a, b) => b[1] - a[1],
            )[0];

            return (
              <CircleMarker
                key={i}
                center={[m.lat, m.lng]}
                radius={getRadius(m.total)}
                pathOptions={{
                  color: color,
                  fillColor: color,
                  fillOpacity: 0.7,
                  weight: 2,
                }}
              >
                <Popup>
                  <div style={{ minWidth: "160px" }}>
                    <strong style={{ fontSize: "14px" }}>{m.district}</strong>
                    <br />
                    <span style={{ color: color, fontWeight: "bold" }}>
                      {risk} RISK
                    </span>
                    <br />
                    Total crimes: <strong>{m.total.toLocaleString()}</strong>
                    <br />
                    Top crime: <strong>{topCrime ? topCrime[0] : "N/A"}</strong>
                    <br />
                    <hr style={{ margin: "6px 0" }} />
                    {Object.entries(m.categories)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4)
                      .map(([cat, count]) => (
                        <div key={cat} style={{ fontSize: "11px" }}>
                          {cat}: <strong>{count.toLocaleString()}</strong>
                        </div>
                      ))}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

        {/* KMeans hotspot zones */}
        {showHotspots &&
          hotspots.map((h, i) => (
            <Circle
              key={`hotspot-${i}`}
              center={[h.center_lat, h.center_lng]}
              radius={h.radius_km * 1000}
              pathOptions={{
                color: RISK_COLORS[h.risk_level],
                fillColor: RISK_COLORS[h.risk_level],
                fillOpacity: 0.12,
                weight: 2,
                dashArray: "6 4",
              }}
            >
              <Popup>
                <div style={{ minWidth: "180px" }}>
                  <strong style={{ fontSize: "14px" }}>
                    Hotspot Zone {h.cluster_id + 1}
                  </strong>
                  <br />
                  <span
                    style={{
                      color: RISK_COLORS[h.risk_level],
                      fontWeight: "bold",
                    }}
                  >
                    {h.risk_level} RISK · Score {h.risk_score}/100
                  </span>
                  <br />
                  Total crimes:{" "}
                  <strong>{h.crime_count.toLocaleString()}</strong>
                  <br />
                  Top crime: <strong>{h.top_crime}</strong>
                </div>
              </Popup>
            </Circle>
          ))}
      </MapContainer>

      {/* Layer toggles */}
      <div
        className="absolute top-4 right-4 z-[1000] bg-gray-900
                      rounded-lg p-3 border border-gray-700"
      >
        <p className="text-white text-xs font-bold mb-2">LAYERS</p>
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showDistricts}
            onChange={(e) => setShowDistricts(e.target.checked)}
          />
          <span className="text-gray-300 text-xs">District markers</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showHotspots}
            onChange={(e) => setShowHotspots(e.target.checked)}
          />
          <span className="text-gray-300 text-xs">ML Hotspot zones</span>
        </label>
      </div>

      {/* Legend */}
      <div
        className="absolute bottom-8 left-4 z-[1000] bg-gray-900
                      rounded-lg p-3 border border-gray-700"
      >
        <p className="text-white text-xs font-bold mb-2">RISK LEVEL</p>
        {Object.entries(RISK_COLORS).map(([level, color]) => (
          <div key={level} className="flex items-center gap-2 mb-1">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-gray-300 text-xs">{level}</span>
          </div>
        ))}
        <hr className="border-gray-700 my-2" />
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full border-2
                          border-red-500 bg-transparent"
          />
          <span className="text-gray-300 text-xs">ML Hotspot</span>
        </div>
      </div>
    </div>
  );
}
