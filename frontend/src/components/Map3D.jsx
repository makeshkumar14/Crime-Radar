import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";

/* 🔑 ADD YOUR KEY HERE */
const API_KEY = "jYCiT4YmtkMVvqlo7hnB";

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

export default function Map3D() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);

  const [markers, setMarkers] = useState([]);
  const [mapStyle, setMapStyle] = useState("street");

  /* ===============================
     🗺️ INIT MAP
  =============================== */
  useEffect(() => {
    if (map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLES.street.style,
      center: [78.7, 10.9],
      zoom: 7.5,
      pitch: 0,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map.current.on("load", () => {
      console.log("MAP LOADED");
    });
  }, []);

  /* ===============================
     📊 FETCH DATA
  =============================== */
  useEffect(() => {
    axios.get("http://127.0.0.1:8000/api/fir/all").then((res) => {
      const districtMap = {};

      res.data.data.forEach((rec) => {
        if (!districtMap[rec.district]) {
          districtMap[rec.district] = {
            district: rec.district,
            lat: rec.lat,
            lng: rec.lng,
            total: 0,
          };
        }
        districtMap[rec.district].total += rec.count;
      });

      setMarkers(Object.values(districtMap));
    });
  }, []);

  /* ===============================
     📍 RENDER MARKERS (ONLY ONE PLACE)
  =============================== */
  useEffect(() => {
    if (!map.current) return;

    const renderMarkers = () => {
      // clear old
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      console.log("ADDING MARKERS:", markers);

      markers.forEach((m) => {
        if (!m.lat || !m.lng) return;

        const el = document.createElement("div");

        // 🔥 CLEAR VISIBLE MARKER
        el.style.width = "20px";
        el.style.height = "20px";
        el.style.background = "red";
        el.style.borderRadius = "50%";
        el.style.border = "2px solid white";
        el.style.boxShadow = "0 0 10px red";

        const marker = new maplibregl.Marker({
          element: el,
          anchor: "center",
        })
          .setLngLat([m.lng, m.lat])
          .addTo(map.current);

        markersRef.current.push(marker);
      });
    };

    if (map.current.isStyleLoaded()) {
      renderMarkers();
    } else {
      map.current.once("load", renderMarkers);
    }
  }, [markers]);

  /* ===============================
     🎨 CHANGE STYLE (CLEAN)
  =============================== */
  const changeStyle = (styleKey) => {
    setMapStyle(styleKey);
    if (!map.current) return;

    map.current.setStyle(MAP_STYLES[styleKey].style);

    // 🔥 trigger re-render
    setTimeout(() => {
      setMarkers((prev) => [...prev]);
    }, 500);
  };

  return (
    <div className="relative h-screen w-full">
      {/* 🗺️ MAP */}
      <div ref={mapContainer} style={{ height: "100%", width: "100%" }} />

      {/* 🎛️ STYLE SWITCH */}
      <div className="absolute top-4 left-4 z-50 bg-gray-900 p-2 rounded">
        {Object.entries(MAP_STYLES).map(([key, style]) => (
          <button
            key={key}
            onClick={() => changeStyle(key)}
            className={`block text-xs px-3 py-1 mb-1 rounded ${
              mapStyle === key ? "bg-blue-600 text-white" : "text-gray-400"
            }`}
          >
            {style.label}
          </button>
        ))}
      </div>
    </div>
  );
}
