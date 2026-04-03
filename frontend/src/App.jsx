import { useState } from "react";
import Map from "./components/Map";
import Map3D from "./components/Map3D";
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
  const [is3D, setIs3D] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950">
      {/* Sidebar */}
      <div style={{ display: "flex", transition: "width 0.3s ease" }}>
        {sidebarOpen && (
          <Sidebar
            onFilter={setFilters}
            activeView={activeView}
            onViewChange={setActiveView}
          />
        )}
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
          }}
        >
          {sidebarOpen ? "◀" : "▶"}
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <StatsBar />

        {/* 2D / 3D toggle bar */}
        {activeView === "map" && (
          <div
            style={{
              background: "#0f172a",
              borderBottom: "1px solid #1e293b",
              padding: "4px 16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ color: "#64748b", fontSize: "11px" }}>
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
              3D Map ✨
            </button>
            <span style={{ color: "#475569", fontSize: "10px" }}>
              {is3D
                ? "Drag to rotate · Right click to tilt"
                : "Click district to see risk profile"}
            </span>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {activeView === "map" && (
            <>
              {is3D ? (
                <Map3D
                  filters={filters}
                  onDistrictClick={setSelectedDistrict}
                />
              ) : (
                <Map filters={filters} onDistrictClick={setSelectedDistrict} />
              )}

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
                }}
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
