import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
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

export default function Map({ filters = {}, onDistrictClick }) {
  const [markers, setMarkers] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showDistricts, setShowDistricts] = useState(true);
  const [activeDistrict, setActiveDistrict] = useState(null);

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

  const handleDistrictClick = (district) => {
    setActiveDistrict(district);
    onDistrictClick && onDistrictClick(district);
  };

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
            const isActive = activeDistrict === m.district;

            return (
              <CircleMarker
                key={i}
                center={[m.lat, m.lng]}
                radius={isActive ? getRadius(m.total) + 4 : getRadius(m.total)}
                pathOptions={{
                  color: isActive ? "#ffffff" : color,
                  fillColor: color,
                  fillOpacity: isActive ? 1 : 0.7,
                  weight: isActive ? 3 : 2,
                }}
                eventHandlers={{
                  click: () => handleDistrictClick(m.district),
                  mouseover: (e) => {
                    e.target.setStyle({ fillOpacity: 1, weight: 3 });
                  },
                  mouseout: (e) => {
                    if (activeDistrict !== m.district) {
                      e.target.setStyle({ fillOpacity: 0.7, weight: 2 });
                    }
                  },
                }}
              />
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
            />
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
        <p className="text-gray-500 text-xs mt-2">
          Click a dot to see risk profile
        </p>
      </div>
    </div>
  );
}
