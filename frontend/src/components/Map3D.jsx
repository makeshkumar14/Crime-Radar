import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";

// 🔥 Replace with your MapTiler API key
const API_KEY = "jYCiT4YmtkMVvqlo7hnB";

// Risk colors
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

// ✅ Modern vector styles
const MAP_STYLES = {
  street: {
    label: "Street",
    style: `https://api.maptiler.com/maps/streets/style.json?key=${API_KEY}`,
  },
  satellite: {
    label: "Satellite",
    style: `https://api.maptiler.com/maps/satellite/style.json?key=${API_KEY}`,
  },
  dark: {
    label: "Dark",
    style: `https://api.maptiler.com/maps/darkmatter/style.json?key=${API_KEY}`,
  },
};

export default function Map3D({ filters = {}, onDistrictClick }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);

  const [markers, setMarkers] = useState([]);
  const [mapStyle, setMapStyle] = useState("street");

  // ✅ INIT MAP
  useEffect(() => {
    if (map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLES.street.style,
      center: [78.7047, 10.7905],
      zoom: 6.5,
      pitch: 45,
      bearing: -10,
      antialias: true,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "bottom-right");
    map.current.addControl(new maplibregl.FullscreenControl());

    // Terrain (3D feel)
    map.current.on("load", () => {
      map.current.addSource("terrain", {
        type: "raster-dem",
        url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
        tileSize: 256,
      });

      map.current.setTerrain({
        source: "terrain",
        exaggeration: 1.3,
      });
    });
  }, []);

  // ✅ FETCH DATA
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.year) params.append("year", filters.year);
    if (filters.district) params.append("district", filters.district);
    if (filters.category) params.append("category", filters.category);

    axios
      .get(`http://localhost:8000/api/fir/all?${params.toString()}`)
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

        setMarkers(Object.values(districtMap));
      });
  }, [filters]);

  // ✅ ADD MARKERS
  useEffect(() => {
    if (!map.current) return;

    // Remove old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    markers.forEach((m) => {
      const risk = getRiskLevel(m.total);
      const color = RISK_COLORS[risk];

      const el = document.createElement("div");
      el.style.cssText = `
        width: ${risk === "HIGH" ? "20px" : risk === "MEDIUM" ? "14px" : "10px"};
        height: ${risk === "HIGH" ? "20px" : risk === "MEDIUM" ? "14px" : "10px"};
        background: ${color};
        border-radius: 50%;
        border: 2px solid white;
        cursor: pointer;
        box-shadow: 0 0 10px ${color};
      `;

      el.addEventListener("click", () => {
        onDistrictClick && onDistrictClick(m.district);

        new maplibregl.Popup()
          .setLngLat([m.lng, m.lat])
          .setHTML(
            `
            <div style="font-family: monospace;">
              <strong>${m.district}</strong><br/>
              <span style="color:${color}">${risk} RISK</span><br/>
              Crimes: ${m.total}
            </div>
          `,
          )
          .addTo(map.current);
      });

      const marker = new maplibregl.Marker(el)
        .setLngLat([m.lng, m.lat])
        .addTo(map.current);

      markersRef.current.push(marker);
    });
  }, [markers]);

  // ✅ CHANGE STYLE
  const changeStyle = (styleKey) => {
    setMapStyle(styleKey);

    if (!map.current) return;

    map.current.setStyle(MAP_STYLES[styleKey].style);

    // Re-add terrain after style change
    map.current.once("styledata", () => {
      try {
        map.current.addSource("terrain", {
          type: "raster-dem",
          url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
          tileSize: 256,
        });

        map.current.setTerrain({
          source: "terrain",
          exaggeration: 1.3,
        });
      } catch (e) {}
    });
  };

  return (
    <div className="flex-1 relative">
      <div ref={mapContainer} style={{ height: "100%", width: "100%" }} />

      {/* STYLE SWITCH */}
      <div className="absolute top-4 left-4 z-50 bg-gray-900 p-2 rounded">
        {Object.entries(MAP_STYLES).map(([key, style]) => (
          <button
            key={key}
            onClick={() => changeStyle(key)}
            className={`block text-xs px-3 py-1 mb-1 rounded ${
              mapStyle === key
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:bg-gray-800"
            }`}
          >
            {style.label}
          </button>
        ))}
      </div>

      {/* LEGEND */}
      <div className="absolute bottom-8 left-4 bg-gray-900 p-3 rounded text-xs">
        <p className="text-white font-bold mb-2">Risk Level</p>
        {Object.entries(RISK_COLORS).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full" style={{ background: v }} />
            <span className="text-gray-300">{k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
