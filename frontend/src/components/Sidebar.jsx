import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const NAV_ITEMS = [
  { id: "map", label: "Operations Map", description: "Statewide zones, hotspots, patrols" },
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
  const [filters, setFilters] = useState(INITIAL_FILTERS);
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

  const activeFilters = useMemo(() => {
    const next = {};
    if (filters.year) next.year = Number(filters.year);
    if (filters.district) next.district = filters.district;
    if (filters.category) next.category = filters.category;
    return next;
  }, [filters]);

  useEffect(() => {
    onFilter(activeFilters);
  }, [activeFilters, onFilter]);

  const setFilterValue = (key, value) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  return (
    <aside className="flex h-full w-[320px] flex-col border-r border-gray-800 bg-gray-950 text-white">
      <div className="border-b border-gray-800 px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-400">
          CrimeRadar
        </p>
        <h1 className="mt-2 text-xl font-bold">Tamil Nadu Crime Operations</h1>
        <p className="mt-2 text-sm leading-6 text-gray-400">
          Real geography, synthetic FIR intelligence, ML-assisted patrol focus, and
          citizen safety tools built for the hackathon demo.
        </p>
      </div>

      <div className="border-b border-gray-800 px-4 py-4">
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

      <div className="flex-1 overflow-y-auto px-4 py-4">
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
                value={filters.year}
                onChange={(event) => setFilterValue("year", event.target.value)}
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
                value={filters.district}
                onChange={(event) => setFilterValue("district", event.target.value)}
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
                value={filters.category}
                onChange={(event) => setFilterValue("category", event.target.value)}
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
        </div>

        <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
            Live Story
          </p>
          <div className="mt-3 space-y-3 text-sm text-gray-300">
            <p>Every district and taluk is covered. No blank zones are left on the map.</p>
            <p>Legal sections now include the full hackathon IPC and Act coverage set.</p>
            <p>Citizen features use predicted taluk risk instead of only historical counts.</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-300">
            Demo Honesty Line
          </p>
          <p className="mt-2 text-sm leading-6 text-amber-100/90">
            Administrative geography is real. FIR activity is synthetic for hackathon
            demonstration and aligned for future CCTNS-style integration.
          </p>
        </div>
      </div>
    </aside>
  );
}
