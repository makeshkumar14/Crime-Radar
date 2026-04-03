import { useEffect, useState } from "react";
import axios from "axios";

export default function StatsBar({ activeView, is3D, setIs3D }) {
  const [stats, setStats] = useState({
    total: 0,
    topCrime: "N/A",
    districts: 0,
  });

  useEffect(() => {
    axios
      .get("http://localhost:8000/api/crimes/summary")
      .then((res) => {
        const data = res.data.summary;
        const total = data.reduce((sum, r) => sum + r.total_count, 0);
        const topCrime = data[0]?.category || "N/A";
        setStats((prev) => ({ ...prev, total, topCrime }));
      })
      .catch((err) => console.error(err));

    axios
      .get("http://localhost:8000/api/fir/districts")
      .then((res) => {
        setStats((prev) => ({
          ...prev,
          districts: res.data.districts.length,
        }));
      })
      .catch((err) => console.error(err));
  }, []);

  const cards = [
    {
      label: "Total Crime Records",
      value: stats.total.toLocaleString(),
      color: "text-white",
    },
    {
      label: "Districts Mapped",
      value: stats.districts,
      color: "text-blue-400",
    },
    { label: "Top Crime Type", value: stats.topCrime, color: "text-amber-400" },
    { label: "Data Years", value: "2001 - 2014", color: "text-green-400" },
  ];

  return (
    <div className="w-full bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center gap-4">
      <div className="mr-4">
        <p className="text-gray-500 text-xs">Tamil Nadu Police</p>
        <p className="text-white text-sm font-bold">Crime Hotspot Dashboard</p>
      </div>

      <div className="h-8 w-px bg-gray-700" />

      {cards.map(({ label, value, color }, i) => (
        <div key={i} className="flex flex-col">
          <span className="text-gray-500 text-xs">{label}</span>
          <span className={`${color} text-sm font-bold`}>{value}</span>
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
            <span className="text-[#64748b] text-[11px] font-semibold ml-2">
              {is3D
                ? "Drag to rotate · Right click to tilt"
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
