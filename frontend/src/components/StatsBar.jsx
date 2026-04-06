import { useEffect, useState } from "react";
import axios from "axios";

// Same COLORS array used in Analytics.jsx pie chart
const CATEGORY_COLORS = [
  "#EF4444",
  "#F59E0B",
  "#22C55E",
  "#3B82F6",
  "#A855F7",
  "#06B6D4",
  "#F97316",
  "#EC4899",
];

export default function StatsBar({
  activeView,
  is3D,
  setIs3D,
  refreshKey,
  onOpenFIRModal,
}) {
  const [stats, setStats] = useState({
    total: 0,
    topCrime: "N/A",
    topCrimeColor: CATEGORY_COLORS[0],
    districts: 0,
    stations: 0,
  });

  useEffect(() => {
    Promise.all([
      axios.get("http://localhost:8000/api/crimes/summary"),
      axios.get("http://localhost:8000/api/fir/map-layers"),
    ])
      .then(([summaryRes, mapRes]) => {
        const summary = summaryRes.data.summary || [];
        const total = summary.reduce((sum, row) => sum + row.total_count, 0);
    const topCrime = summary[0]?.category || "N/A";
        const topCrimeIndex = 0; // top crime is always index 0 (sorted by count)
        setStats({
          total,
          topCrime,
          topCrimeColor: CATEGORY_COLORS[topCrimeIndex],
          districts: mapRes.data.summary.districts,
          stations: mapRes.data.summary.stations,
        });
      })
      .catch((error) => console.error(error));
  }, [refreshKey]);

  const cards = [
    {
      label: "Synthetic Incident Load",
      value: stats.total.toLocaleString(),
      color: "text-white",
    },
    {
      label: "Districts Mapped",
      value: stats.districts,
      color: "text-blue-400",
    },
    {
      label: "Stations Covered",
      value: stats.stations,
      color: "text-cyan-400",
    },
    {
      label: "Top Crime Type",
      value: stats.topCrime,
      color: "",
      style: { color: stats.topCrimeColor },
    },
    {
      label: "Data Window",
      value: "2024 - 2026",
      color: "text-green-400",
    },
  ];

  return (
    <div className="w-full bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center gap-4">
      <div className="mr-4">
        <p className="text-gray-500 text-xs">Tamil Nadu Police</p>
        <p className="text-white text-sm font-bold">Crime Hotspot Dashboard</p>
      </div>

      <div className="h-8 w-px bg-gray-700" />

      {cards.map(({ label, value, color, style }, index) => (
        <div key={index} className="flex flex-col">
          <span className="text-gray-500 text-xs">{label}</span>
          <span className={`${color} text-sm font-bold`} style={style}>{value}</span>
        </div>
      ))}

      {activeView === "map" && (
        <>
          <div className="h-8 w-px bg-gray-700 mx-2" />
          <div className="flex items-center gap-2">
            <span className="text-[#64748b] text-[11px] font-semibold">
              MAP MODE:
            </span>
            <button
              onClick={() => setIs3D(false)}
              style={{
                fontSize: "11px",
                padding: "2px 12px",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                background: !is3D ? "#3B82F6" : "#1e293b",
                color: !is3D ? "white" : "#64748b",
              }}
            >
              2D Map
            </button>
            <button
              onClick={() => setIs3D(true)}
              style={{
                fontSize: "11px",
                padding: "2px 12px",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                background: is3D ? "#3B82F6" : "#1e293b",
                color: is3D ? "white" : "#64748b",
              }}
            >
              3D Map
            </button>
            <button
              onClick={onOpenFIRModal}
              style={{
                fontSize: "11px",
                padding: "2px 12px",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                background: "#059669",
                color: "white",
                marginLeft: "4px",
              }}
            >
              Inject FIR
            </button>
            <span className="text-[#64748b] text-[11px] font-semibold ml-2">
              {is3D
                ? "Drag to rotate | Right click to tilt"
                : "Click district to see risk profile"}
            </span>
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-2 bg-green-900 px-3 py-1 rounded-full">
        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
        <span className="text-green-400 text-xs font-bold">LIVE DATA</span>
      </div>
    </div>
  );
}
