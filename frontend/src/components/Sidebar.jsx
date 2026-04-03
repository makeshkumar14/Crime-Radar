import { useState, useEffect } from "react";
import axios from "axios";

export default function Sidebar({ onFilter, activeView, onViewChange }) {
  const [districts, setDistricts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [years, setYears] = useState([]);
  const [selected, setSelected] = useState({
    district: "",
    category: "",
    year: "",
  });

  useEffect(() => {
    axios
      .get("http://localhost:8000/api/fir/districts")
      .then((res) => setDistricts(res.data.districts));
    axios
      .get("http://localhost:8000/api/fir/categories")
      .then((res) => setCategories(res.data.categories));
    axios
      .get("http://localhost:8000/api/fir/years")
      .then((res) => setYears(res.data.years));
  }, []);

  return (
    <div
      className="w-56 h-screen bg-gray-900 border-r 
                    border-gray-700 flex flex-col"
    >
      {/* Logo */}
      <div className="p-4 border-b border-gray-700">
        <h1
          className="text-amber-400 font-black text-xl 
                       tracking-widest"
        >
          CRIME
        </h1>
        <h1
          className="text-white font-black text-xl 
                       tracking-widest"
        >
          RADAR
        </h1>
        <p className="text-gray-500 text-xs mt-1">Tamil Nadu Police</p>
      </div>

      {/* Nav */}
      <div className="p-3 border-b border-gray-700">
        {[
          { label: "Map View", icon: "🗺", view: "map" },
          { label: "Analytics", icon: "📊", view: "analytics" },
          { label: "Risk Zones", icon: "⚠️", view: "map" },
          { label: "Reports", icon: "📋", view: "map" },
        ].map((item, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 px-3 py-2 
                 rounded-lg mb-1 cursor-pointer text-sm
                 ${
                   activeView === item.view && i < 2
                     ? "bg-blue-600 text-white"
                     : "text-gray-400 hover:bg-gray-800"
                 }`}
            onClick={() => onViewChange(item.view)}
          >
            {item.icon}
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="p-3 flex-1">
        <p
          className="text-gray-500 text-xs font-bold 
                      mb-3 tracking-wider"
        >
          FILTERS
        </p>

        {/* Year */}
        <div className="mb-3">
          <label className="text-gray-400 text-xs mb-1 block">Year</label>
          <select
            className="w-full bg-gray-800 text-white text-xs 
             rounded px-2 py-2 border border-gray-600"
            value={selected.year}
            onChange={(e) => setSelected({ ...selected, year: e.target.value })}
          >
            <option value="">All Years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* District */}
        <div className="mb-3">
          <label className="text-gray-400 text-xs mb-1 block">District</label>
          <select
            className="w-full bg-gray-800 text-white text-xs 
                       rounded px-2 py-2 border border-gray-600"
            value={selected.district}
            onChange={(e) =>
              setSelected({ ...selected, district: e.target.value })
            }
          >
            <option value="">All Districts</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        {/* Category */}
        <div className="mb-3">
          <label className="text-gray-400 text-xs mb-1 block">Crime Type</label>
          <select
            className="w-full bg-gray-800 text-white text-xs 
                       rounded px-2 py-2 border border-gray-600"
            value={selected.category}
            onChange={(e) =>
              setSelected({ ...selected, category: e.target.value })
            }
          >
            <option value="">All Types</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Apply Button */}
        <button
          className="w-full bg-blue-600 hover:bg-blue-700 
                     text-white text-xs font-bold py-2 
                     rounded-lg mt-2"
          onClick={() => onFilter && onFilter(selected)}
        >
          APPLY FILTERS
        </button>

        {/* Reset */}
        <button
          className="w-full bg-gray-800 hover:bg-gray-700
                     text-gray-400 text-xs py-2 rounded-lg mt-2"
          onClick={() => setSelected({ district: "", category: "", year: "" })}
        >
          Reset
        </button>
      </div>


    </div>
  );
}
