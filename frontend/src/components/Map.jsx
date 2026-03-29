import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  ZoomControl,
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

export default function Map() {
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get("http://localhost:8000/api/fir/all")
      .then((res) => {
        // Group by district and sum counts
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
  }, []);

  if (loading)
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <p className="text-white text-xl">Loading crime data...</p>
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
        {markers.map((m, i) => {
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
                  Total crimes: <strong>{m.total}</strong>
                  <br />
                  Top crime: <strong>{topCrime ? topCrime[0] : "N/A"}</strong>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

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
      </div>
    </div>
  );
}
