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
  const [mapStyle, setMapStyle] = useState("street");
  const [markers, setMarkers] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showDistricts, setShowDistricts] = useState(true);
  const [showWomenSafety, setShowWomenSafety] = useState(false);
  const [showAccident, setShowAccident] = useState(false);
  const [womenMarkers, setWomenMarkers] = useState([]);
  const [accidentMarkers, setAccidentMarkers] = useState([]);
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

  useEffect(() => {
    axios
      .get("http://localhost:8000/api/fir/all?category=Women Safety")
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
            };
          }
          districtMap[key].total += record.count;
        });
        setWomenMarkers(Object.values(districtMap));
      });

    axios
      .get("http://localhost:8000/api/fir/all?category=Violent")
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
            };
          }
          districtMap[key].total += record.count;
        });
        const sorted = Object.values(districtMap)
          .sort((a, b) => b.total - a.total)
          .slice(0, 15);
        setAccidentMarkers(sorted);
      });
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
          key={mapStyle}
          url={MAP_STYLES[mapStyle].url}
          attribution={MAP_STYLES[mapStyle].attribution}
          maxZoom={MAP_STYLES[mapStyle].maxZoom || 19}
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
                  mouseover: (e) =>
                    e.target.setStyle({ fillOpacity: 1, weight: 3 }),
                  mouseout: (e) => {
                    if (activeDistrict !== m.district)
                      e.target.setStyle({ fillOpacity: 0.7, weight: 2 });
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

        {/* Women safety zones */}
        {showWomenSafety &&
          womenMarkers.map((m, i) => (
            <Circle
              key={`women-${i}`}
              center={[m.lat, m.lng]}
              radius={8000}
              pathOptions={{
                color: "#EC4899",
                fillColor: "#EC4899",
                fillOpacity: 0.2,
                weight: 2,
                dashArray: "4 3",
              }}
            />
          ))}

        {/* Accident prone areas */}
        {showAccident &&
          accidentMarkers.map((m, i) => (
            <Circle
              key={`accident-${i}`}
              center={[m.lat, m.lng]}
              radius={10000}
              pathOptions={{
                color: "#F97316",
                fillColor: "#F97316",
                fillOpacity: 0.2,
                weight: 2,
                dashArray: "4 3",
              }}
            />
          ))}
      </MapContainer>

      {/* Map style switcher - top left */}
      <div
        className="absolute top-4 left-4 z-[1000] bg-gray-900/40 backdrop-blur-md
                      rounded-lg p-2 border border-gray-600/30 shadow-lg"
      >
        <p className="text-white text-sm font-bold mb-3 tracking-wide drop-shadow-md">MAP STYLE</p>
        <div className="flex flex-col gap-1.5">
          {Object.entries(MAP_STYLES).map(([key, style]) => (
            <button
              key={key}
              onClick={() => setMapStyle(key)}
              className={`text-sm font-semibold px-3 py-1.5 rounded-md text-left
                         transition-all duration-200 drop-shadow-md
                         ${
                           mapStyle === key
                             ? "bg-blue-600 text-white"
                             : "text-white/90 hover:bg-white/20"
                         }`}
            >
              {style.label}
            </button>
          ))}
        </div>
      </div>

      {/* Layer toggles - top right */}
      <div
        className="absolute top-4 right-4 z-[1000] bg-gray-900/40 backdrop-blur-md
                      rounded-lg p-3 border border-gray-600/30 shadow-lg"
      >
        <p className="text-white text-sm font-bold mb-3 tracking-wide drop-shadow-md">LAYERS</p>
        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={showDistricts}
            onChange={(e) => setShowDistricts(e.target.checked)}
            className="w-4 h-4 cursor-pointer"
          />
          <span className="text-white font-semibold text-sm drop-shadow-md">District markers</span>
        </label>
        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={showHotspots}
            onChange={(e) => setShowHotspots(e.target.checked)}
            className="w-4 h-4 cursor-pointer"
          />
          <span className="text-white font-semibold text-sm drop-shadow-md">ML Hotspot zones</span>
        </label>
        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={showWomenSafety}
            onChange={(e) => setShowWomenSafety(e.target.checked)}
            className="w-4 h-4 cursor-pointer"
          />
          <span className="text-pink-300 font-semibold text-sm drop-shadow-md">Women safety zones</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showAccident}
            onChange={(e) => setShowAccident(e.target.checked)}
            className="w-4 h-4 cursor-pointer"
          />
          <span className="text-orange-300 font-semibold text-sm drop-shadow-md">Accident prone areas</span>
        </label>
      </div>

      {/* Legend - bottom left */}
      <div
        className="absolute bottom-8 left-4 z-[1000] bg-gray-900/40 backdrop-blur-md
                      rounded-lg p-3 border border-gray-600/30 shadow-lg"
      >
        <p className="text-white text-sm font-bold mb-3 tracking-wide drop-shadow-md">RISK LEVEL</p>
        {Object.entries(RISK_COLORS).map(([level, color]) => (
          <div key={level} className="flex items-center gap-2 mb-2">
            <div
              className="w-3.5 h-3.5 rounded-full shadow-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-white font-semibold text-sm drop-shadow-md">{level}</span>
          </div>
        ))}
        <hr className="border-white/20 my-3" />
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-red-500 bg-transparent shadow-sm" />
          <span className="text-white font-semibold text-sm drop-shadow-md">ML Hotspot</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-pink-400 bg-transparent shadow-sm" />
          <span className="text-white font-semibold text-sm drop-shadow-md">Women safety</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-orange-400 bg-transparent shadow-sm" />
          <span className="text-white font-semibold text-sm drop-shadow-md">Accident prone</span>
        </div>
        <p className="text-gray-300 font-medium text-xs mt-3 drop-shadow-md">
          Click a dot to see risk profile
        </p>
      </div>
    </div>
  );
}
