import { useState } from "react";
import Map from "./components/Map";
import Sidebar from "./components/Sidebar";
import StatsBar from "./components/StatsBar";
import Analytics from "./components/Analytics";
import RiskCard from "./components/RiskCard";

function App() {
  const [filters, setFilters] = useState({});
  const [activeView, setActiveView] = useState("map");
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [riskCardOpen, setRiskCardOpen] = useState(true);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950">
      {/* Sidebar with toggle */}
      <div
        style={{
          display: "flex",
          transition: "width 0.3s ease",
        }}
      >
        {sidebarOpen && (
          <Sidebar
            onFilter={setFilters}
            activeView={activeView}
            onViewChange={setActiveView}
          />
        )}
        {/* Sidebar toggle button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            width: "18px",
            background: "#1e293b",
            border: "none",
            borderRight: "1px solid #334155",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#64748b",
            fontSize: "10px",
            zIndex: 1000,
            transition: "background 0.2s",
          }}
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarOpen ? "◀" : "▶"}
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <StatsBar />
        <div className="flex flex-1 overflow-hidden">
          {activeView === "map" && (
            <>
              <Map filters={filters} onDistrictClick={setSelectedDistrict} />

              {/* Risk card toggle button */}
              <button
                onClick={() => setRiskCardOpen(!riskCardOpen)}
                style={{
                  width: "18px",
                  background: "#1e293b",
                  border: "none",
                  borderLeft: "1px solid #334155",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                  fontSize: "10px",
                  zIndex: 1000,
                  transition: "background 0.2s",
                }}
                title={
                  riskCardOpen ? "Collapse risk panel" : "Expand risk panel"
                }
              >
                {riskCardOpen ? "▶" : "◀"}
              </button>

              {riskCardOpen && <RiskCard district={selectedDistrict} />}
            </>
          )}
          {activeView === "analytics" && <Analytics />}
        </div>
      </div>
    </div>
  );
}

export default App;
