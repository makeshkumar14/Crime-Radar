import { useEffect, useState } from "react";
import axios from "axios";
import { FlowButton } from "./ui/FlowButton";

const NAV_ITEMS = [
  { id: "map", label: "Operations" },
  { id: "women-safety", label: "Women Safety" },
  { id: "accident-zones", label: "Accident Zones" },
  { id: "analytics", label: "Analytics" },
  { id: "travel", label: "Travel Advisor" },
  { id: "relocation", label: "Relocation" },
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
    <aside className="flex h-full w-[280px] flex-col border-r border-white/5 bg-black text-white">
      <div className="border-b border-white/5 bg-black px-5 py-4">
        <div className="leading-[0.92]">
          <p className="text-[2.15rem] font-black uppercase tracking-[0.04em] text-white">
            Crime
          </p>
          <p className="mt-1 text-[2.15rem] font-black uppercase tracking-[0.04em] text-[#af1b1b]">
            Radar
          </p>
        </div>
        <p className="mt-3 max-w-[15rem] text-[0.72rem] italic leading-5 text-[#999999]">
          Predictive Crime Hotspot Mapping for Smarter Policing
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#999999]">
            Target Views
          </p>
          <div className="space-y-3">
            {NAV_ITEMS.map((item) => (
              <FlowButton 
                key={item.id}
                text={item.label}
                isActive={activeView === item.id}
                onClick={() => onViewChange(item.id)}
                className="w-full !px-3 !py-4 transition-all"
              />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#999999]">
                Filters
              </p>
            </div>
            <button
              onClick={resetFilters}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs font-semibold text-[#999999] transition hover:border-white/20 hover:text-white"
            >
              Reset
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#999999]">
                Year
              </label>
              <select
                value={pendingFilters.year}
                onChange={(event) => setPendingValue("year", event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white"
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
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#999999]">
                District
              </label>
              <select
                value={pendingFilters.district}
                onChange={(event) => setPendingValue("district", event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white"
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
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#999999]">
                Category
              </label>
              <select
                value={pendingFilters.category}
                onChange={(event) => setPendingValue("category", event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white"
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

          <div className="mt-5">
            <FlowButton
              text={hasPendingChanges ? "Apply" : "Locked"}
              onClick={hasPendingChanges ? applyFilters : undefined}
              className={`w-full !px-3 !py-4 !rounded-2xl transition-all ${
                hasPendingChanges 
                  ? "border-[#af1b1b] bg-[#af1b1b]/20" 
                  : "border-white/5 opacity-40 pointer-events-none"
              }`}
            />
          </div>
        </div>
      </div>
    </aside>

  );
}
