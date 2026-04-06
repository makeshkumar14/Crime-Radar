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
    <div className="w-full bg-black border-b border-white/5 px-4 py-2 flex items-center gap-4">
      <div className="mr-4">
        <p className="text-[#999999] text-xs font-semibold tracking-wider">Tamil Nadu Police</p>
        <p className="text-white text-sm font-black uppercase tracking-tight">Crime Radar Dashboard</p>
      </div>

      <div className="h-8 w-px bg-white/5" />

      {cards.map(({ label, value, color, style }, index) => (
        <div key={index} className="flex flex-col">
          <span className="text-[#999999] text-[10px] font-bold uppercase tracking-wider">{label}</span>
          <span className={`${color} text-sm font-black`} style={style}>{value}</span>
        </div>
      ))}

      {activeView === "map" && (
        <>
          <div className="h-8 w-px bg-white/5 mx-2" />
          <div className="flex items-center gap-2">
            <span className="text-[#999999] text-[10px] font-bold uppercase tracking-wider">
              MAP MODE:
            </span>
            <button
              onClick={() => setIs3D(false)}
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-all rounded"
              style={{
                background: !is3D ? "#af1b1b" : "rgba(255,255,255,0.05)",
                color: !is3D ? "white" : "#999999",
              }}
            >
              2D Map
            </button>
            <button
              onClick={() => setIs3D(true)}
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-all rounded"
              style={{
                background: is3D ? "#af1b1b" : "rgba(255,255,255,0.05)",
                color: is3D ? "white" : "#999999",
              }}
            >
              3D Map
            </button>
            <button
              onClick={onOpenFIRModal}
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-all rounded ml-2"
              style={{
                background: "white",
                color: "black",
              }}
            >
              Inject FIR
            </button>
            <span className="text-[#999999] text-[10px] font-medium ml-2 uppercase tracking-wide">
              {is3D
                ? "Drag to rotate | Right click to tilt"
                : "Click district for risk profile"}
            </span>
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-2 bg-red-950/30 border border-red-900/40 px-3 py-1 rounded-full">
        <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
        <span className="text-red-400 text-[10px] font-black uppercase tracking-wider">LIVE FEED</span>
      </div>
    </div>
  );
}
