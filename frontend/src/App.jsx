import { useEffect, useState } from "react";
import Map from "./components/Map";
import Map3D from "./components/Map3D";
import Sidebar from "./components/Sidebar";
import StatsBar from "./components/StatsBar";
import Analytics from "./components/Analytics";
import RiskCard from "./components/RiskCard";
import TravelAdvisor from "./components/TravelAdvisor";
import AreaSafetyReport from "./components/AreaSafetyReport";
import FIRInjectModal from "./components/FIRInjectModal";
import ScenarioZoneView from "./components/ScenarioZoneView";

const FIR_HIGHLIGHT_DURATION_MS = 30000;

function App() {
  const [filters, setFilters] = useState({});
  const [activeView, setActiveView] = useState("map");
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [riskCardOpen, setRiskCardOpen] = useState(true);
  const [is3D, setIs3D] = useState(false);
  const [isFirModalOpen, setIsFirModalOpen] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [firHighlight, setFirHighlight] = useState(null);

  useEffect(() => {
    if (!firHighlight) {
      return undefined;
    }

    const timer = globalThis.setTimeout(() => {
      setFirHighlight(null);
    }, FIR_HIGHLIGHT_DURATION_MS);

    return () => globalThis.clearTimeout(timer);
  }, [firHighlight]);

  const handleFirCreated = (entry) => {
    setDataRefreshKey((value) => value + 1);
    if (entry?.district) {
      setFilters((current) => ({
        ...current,
        district: entry.district,
      }));
      setSelectedDistrict(entry.district);
    }
    setFirHighlight({
      district: entry?.district || null,
      taluk_id: entry?.taluk_id || null,
      taluk: entry?.taluk || null,
      createdAt: Date.now(),
    });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950">
      <div style={{ display: "flex", transition: "width 0.3s ease" }}>
        {sidebarOpen && (
          <Sidebar
            onFilter={setFilters}
            activeView={activeView}
            onViewChange={setActiveView}
            externalFilters={filters}
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
          {sidebarOpen ? "<" : ">"}
        </button>
      </div>

      <div className="flex flex-col flex-1 overflow-hidden">
        <StatsBar
          activeView={activeView}
          is3D={is3D}
          setIs3D={setIs3D}
          refreshKey={dataRefreshKey}
          onOpenFIRModal={() => setIsFirModalOpen(true)}
        />

        <div className="flex flex-1 overflow-hidden">
          {activeView === "map" && (
            <>
              {is3D ? (
                <Map3D
                  filters={filters}
                  onDistrictClick={setSelectedDistrict}
                  refreshKey={dataRefreshKey}
                  highlightTarget={firHighlight}
                />
              ) : (
                <Map
                  filters={filters}
                  onDistrictClick={setSelectedDistrict}
                  refreshKey={dataRefreshKey}
                  highlightTarget={firHighlight}
                />
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
                {riskCardOpen ? ">" : "<"}
              </button>

              {riskCardOpen && <RiskCard district={selectedDistrict} />}
            </>
          )}
          {activeView === "women-safety" && (
            <ScenarioZoneView
              scenario="women_safety"
              title="Women Safety Prediction"
              accentColor="#af1b1b"
              pointColor="#999999"
              limit={50}
            />
          )}
          {activeView === "accident-zones" && (
            <ScenarioZoneView
              scenario="accident"
              title="Accident Zone Prediction"
              accentColor="#af1b1b"
              pointColor="#999999"
              limit={50}
            />
          )}
          {activeView === "analytics" && <Analytics />}
          {activeView === "travel" && <TravelAdvisor />}
          {activeView === "relocation" && <AreaSafetyReport />}
        </div>
      </div>

      <FIRInjectModal
        open={isFirModalOpen}
        onClose={() => setIsFirModalOpen(false)}
        onCreated={handleFirCreated}
      />
    </div>
  );
}

export default App;
