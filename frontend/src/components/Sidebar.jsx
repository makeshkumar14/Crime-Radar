import { useEffect, useState } from "react";
import axios from "axios";

const NAV_ITEMS = [
  { id: "map", label: "Operations Map", description: "Statewide zones, hotspots, patrols" },
  { id: "women-safety", label: "Women Safety", description: "Top 20 forecast zones and derived safety markers" },
  { id: "accident-zones", label: "Accident Zones", description: "Top 20 forecast corridors with isolated overlays" },
  { id: "analytics", label: "Analytics", description: "Trends, category mix, seasonal view" },
  { id: "travel", label: "Travel Advisor", description: "Safer route around crime corridors" },
  { id: "relocation", label: "Relocation Report", description: "Family safety assessment by area" },
];

const INITIAL_FILTERS = {
  year: "",
  district: "",
  category: "",
};

export default function Sidebar({ onFilter, activeView, onViewChange }) {
  const [pendingFilters, setPendingFilters] = useState(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(INITIAL_FILTERS);
  const [options, setOptions] = useState({
    years: [],
    districts: [],
    categories: [],
  });

  useEffect(() => {
    Promise.all([
      axios.get("http://localhost:8000/api/fir/years"),
      axios.get("http://localhost:8000/api/fir/districts"),
      axios.get("http://localhost:8000/api/fir/categories"),
    ])
      .then(([yearsRes, districtsRes, categoriesRes]) => {
        setOptions({
          years: yearsRes.data.years || [],
          districts: districtsRes.data.districts || [],
          categories: categoriesRes.data.categories || [],
        });
      })
      .catch((error) => {
        console.error("Sidebar options error:", error);
      });
  }, []);

  useEffect(() => {
    const next = {};
    if (appliedFilters.year) next.year = Number(appliedFilters.year);
    if (appliedFilters.district) next.district = appliedFilters.district;
    if (appliedFilters.category) next.category = appliedFilters.category;
    onFilter(next);
  }, [appliedFilters, onFilter]);

  const setPendingValue = (key, value) => {
    setPendingFilters((prev) => ({ ...prev, [key]: value }));
  };

  const applyFilters = () => {
    setAppliedFilters(pendingFilters);
  };

  const resetFilters = () => {
    setPendingFilters(INITIAL_FILTERS);
    setAppliedFilters(INITIAL_FILTERS);
  };

  const hasPendingChanges =
    JSON.stringify(pendingFilters) !== JSON.stringify(appliedFilters);

  return (
    <aside className="flex h-full w-[280px] flex-col border-r border-gray-800 bg-gray-950 text-white">
      <div className="border-b border-blue-500/50 bg-[#0b1423] px-5 py-4">
        <div className="leading-[0.92]">
          <p className="text-[2.15rem] font-black uppercase tracking-[0.04em] text-white">
            Crime
          </p>
          <p className="mt-1 text-[2.15rem] font-black uppercase tracking-[0.04em] text-amber-400">
            Radar
          </p>
        </div>
        <p className="mt-3 max-w-[15rem] text-[0.72rem] italic leading-5 text-slate-400">
          Predictive Crime Hotspot Mapping for Smarter Policing
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
            Views
          </p>
          <div className="space-y-2">
            {NAV_ITEMS.map((item) => {
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-blue-500 bg-blue-600/15"
                      : "border-gray-800 bg-gray-900/60 hover:border-gray-700 hover:bg-gray-900"
                  }`}
                >
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <p className="mt-1 text-xs text-gray-400">{item.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
                Map Filters
              </p>
              <p className="mt-1 text-xs text-gray-400">
                These filters apply to the operations map and 3D view.
              </p>
            </div>
            <button
              onClick={resetFilters}
              className="rounded-lg border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-300 transition hover:border-gray-600 hover:text-white"
            >
              Reset
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                Year
              </label>
              <select
                value={pendingFilters.year}
                onChange={(event) => setPendingValue("year", event.target.value)}
                className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white"
              >
                <option value="">All years</option>
                {options.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                District
              </label>
              <select
                value={pendingFilters.district}
                onChange={(event) => setPendingValue("district", event.target.value)}
                className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white"
              >
                <option value="">All districts</option>
                {options.districts.map((district) => (
                  <option key={district} value={district}>
                    {district}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                Crime Category
              </label>
              <select
                value={pendingFilters.category}
                onChange={(event) => setPendingValue("category", event.target.value)}
                className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white"
              >
                <option value="">All categories</option>
                {options.categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Apply Filters button */}
          <button
            onClick={applyFilters}
            className={`mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              hasPendingChanges
                ? "bg-blue-600 text-white hover:bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.4)]"
                : "bg-gray-800 text-gray-500 cursor-default"
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              {hasPendingChanges && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-300" />
              )}
              Apply Filters
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
