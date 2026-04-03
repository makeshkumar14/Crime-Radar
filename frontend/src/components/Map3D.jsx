import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";

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

export default function Map3D({ filters = {}, onDistrictClick }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [markers, setMarkers] = useState([]);
  const [mapStyle, setMapStyle] = useState("street");
  const markersRef = useRef([]);

  const MAP_STYLES = {
    street: {
      label: "Street",
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    },
    satellite: {
      label: "Satellite",
      style: {
        version: 8,
        sources: {
          satellite: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
          },
        },
        layers: [{ id: "satellite", type: "raster", source: "satellite" }],
      },
    },
    dark: {
      label: "Dark",
      style: {
        version: 8,
        sources: {
          dark: {
            type: "raster",
            tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
            tileSize: 256,
          },
        },
        layers: [{ id: "dark", type: "raster", source: "dark" }],
      },
    },
  };

  // Init map
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

    map.current.on("load", () => {
      // Add 3D terrain effect using hillshade
      map.current.addSource("hillshade", {
        type: "raster-dem",
        url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
        tileSize: 256,
      });

      map.current.setTerrain({
        source: "hillshade",
        exaggeration: 1.5,
      });

      map.current.addLayer({
        id: "hillshade-layer",
        type: "hillshade",
        source: "hillshade",
        paint: {
          "hillshade-shadow-color": "#473B24",
          "hillshade-highlight-color": "#FFFFFF",
          "hillshade-accent-color": "#BB8247",
          "hillshade-illumination-direction": 315,
          "hillshade-exaggeration": 0.5,
        },
      });
    });
  }, []);

  // Fetch crime data
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
              categories: {},
            };
          }
          districtMap[key].total += record.count;
          districtMap[key].categories[record.category] =
            (districtMap[key].categories[record.category] || 0) + record.count;
        });
        setMarkers(Object.values(districtMap));
      });
  }, [filters]);

  // Add markers to map
  useEffect(() => {
    if (!map.current) return;

    // Remove old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    markers.forEach((m) => {
      const risk = getRiskLevel(m.total);
      const color = RISK_COLORS[risk];

      // Create custom marker element
      const el = document.createElement("div");
      el.style.cssText = `
        width: ${risk === "HIGH" ? "20px" : risk === "MEDIUM" ? "14px" : "10px"};
        height: ${risk === "HIGH" ? "20px" : risk === "MEDIUM" ? "14px" : "10px"};
        background: ${color};
        border-radius: 50%;
        border: 2px solid white;
        cursor: pointer;
        box-shadow: 0 0 8px ${color};
      `;

      el.addEventListener("click", () => {
        onDistrictClick && onDistrictClick(m.district);
        new maplibregl.Popup({ offset: 25 })
          .setLngLat([m.lng, m.lat])
          .setHTML(
            `
            <div style="font-family: monospace; padding: 8px; min-width: 150px;">
              <strong style="font-size: 13px;">${m.district}</strong><br/>
              <span style="color: ${color}; font-weight: bold;">${risk} RISK</span><br/>
              Total crimes: <strong>${m.total.toLocaleString()}</strong>
            </div>
          `,
          )
          .addTo(map.current);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([m.lng, m.lat])
        .addTo(map.current);

      markersRef.current.push(marker);
    });
  }, [markers]);

  // Change map style
  const changeStyle = (styleKey) => {
    setMapStyle(styleKey);
    if (!map.current) return;
    map.current.setStyle(MAP_STYLES[styleKey].style);

    // Re-add terrain after style change
    map.current.once("styledata", () => {
      try {
        if (!map.current.getSource("hillshade")) {
          map.current.addSource("hillshade", {
            type: "raster-dem",
            url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
            tileSize: 256,
          });
          map.current.setTerrain({ source: "hillshade", exaggeration: 1.5 });
        }
      } catch (e) {}
    });
  };

  return (
    <div className="flex-1 relative">
      <div ref={mapContainer} style={{ height: "100%", width: "100%" }} />

      {/* Map style switcher */}
      <div
        className="absolute top-4 left-4 z-[1000] bg-gray-900
                      rounded-lg p-2 border border-gray-700"
      >
        <p className="text-white text-xs font-bold mb-2">MAP STYLE</p>
        {Object.entries(MAP_STYLES).map(([key, style]) => (
          <button
            key={key}
            onClick={() => changeStyle(key)}
            className={`block w-full text-xs px-3 py-1 rounded
                       text-left mb-1 transition-colors
                       ${
                         mapStyle === key
                           ? "bg-blue-600 text-white"
                           : "text-gray-400 hover:bg-gray-800"
                       }`}
          >
            {style.label}
          </button>
        ))}
      </div>

      {/* 3D controls */}
      <div
        className="absolute top-4 right-4 z-[1000] bg-gray-900
                      rounded-lg p-2 border border-gray-700"
      >
        <p className="text-white text-xs font-bold mb-2">3D CONTROLS</p>
        <button
          className="block w-full text-xs px-3 py-1 rounded
                     text-left mb-1 text-gray-300 hover:bg-gray-800"
          onClick={() => map.current?.setPitch(0)}
        >
          Flat view
        </button>
        <button
          className="block w-full text-xs px-3 py-1 rounded
                     text-left mb-1 text-gray-300 hover:bg-gray-800"
          onClick={() => map.current?.setPitch(45)}
        >
          Tilt 45°
        </button>
        <button
          className="block w-full text-xs px-3 py-1 rounded
                     text-left mb-1 text-gray-300 hover:bg-gray-800"
          onClick={() => map.current?.setPitch(60)}
        >
          Tilt 60°
        </button>
        <button
          className="block w-full text-xs px-3 py-1 rounded
                     text-left text-gray-300 hover:bg-gray-800"
          onClick={() => {
            map.current?.flyTo({
              center: [78.7047, 10.7905],
              zoom: 6.5,
              pitch: 45,
              bearing: -10,
              duration: 1500,
            });
          }}
        >
          Reset view
        </button>
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
        <p className="text-gray-500 text-xs mt-2">
          Drag to rotate · Scroll to zoom
        </p>
      </div>
    </div>
  );
}
