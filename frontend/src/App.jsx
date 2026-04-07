import { useCallback, useEffect, useState } from "react";
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
import OpsAssistant from "./components/OpsAssistant";
import DistrictCompareView from "./components/DistrictCompareView";
import { downloadApiPdf } from "./lib/download";

const FIR_HIGHLIGHT_DURATION_MS = 30000;
const WATCHLIST_STORAGE_KEY = "crimeradar-watchlist-v1";

function App() {
  const [filters, setFilters] = useState({});
  const [activeView, setActiveView] = useState("map");
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [selectedTaluk, setSelectedTaluk] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [riskCardOpen, setRiskCardOpen] = useState(true);
  const [is3D, setIs3D] = useState(false);
  const [isFirModalOpen, setIsFirModalOpen] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [firHighlight, setFirHighlight] = useState(null);
  const [latestFirImpact, setLatestFirImpact] = useState(null);
  const [womenSafetyContext, setWomenSafetyContext] = useState(null);
  const [accidentContext, setAccidentContext] = useState(null);
  const [travelContext, setTravelContext] = useState(null);
  const [relocationContext, setRelocationContext] = useState(null);
  const [compareContext, setCompareContext] = useState(null);
  const [comparePreset, setComparePreset] = useState(null);
  const [watchlistTalukIds, setWatchlistTalukIds] = useState(() => {
    try {
      const stored = globalThis.localStorage?.getItem(WATCHLIST_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!firHighlight) {
      return undefined;
    }

    const timer = globalThis.setTimeout(() => {
      setFirHighlight(null);
    }, FIR_HIGHLIGHT_DURATION_MS);

    return () => globalThis.clearTimeout(timer);
  }, [firHighlight]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        WATCHLIST_STORAGE_KEY,
        JSON.stringify(watchlistTalukIds),
      );
    } catch (error) {
      console.error("Watchlist save error:", error);
    }
  }, [watchlistTalukIds]);

  const handleFirCreated = useCallback((payload) => {
    const entry = payload?.entry || payload || {};
    setDataRefreshKey((value) => value + 1);
    setLatestFirImpact(payload?.impact_summary || null);
    if (entry?.district) {
      setFilters((current) => ({
        ...current,
        district: entry.district,
      }));
      setSelectedDistrict(entry.district);
    }
    if (entry?.taluk_id) {
      setSelectedTaluk(entry);
    }
    setFirHighlight({
      district: entry?.district || null,
      taluk_id: entry?.taluk_id || null,
      taluk: entry?.taluk || null,
      createdAt: Date.now(),
    });
  }, []);

  const handleWomenSafetyContextChange = useCallback((context) => {
    setWomenSafetyContext(context);
  }, []);

  const handleAccidentContextChange = useCallback((context) => {
    setAccidentContext(context);
  }, []);

  const handleTravelContextChange = useCallback((context) => {
    setTravelContext(context);
  }, []);

  const handleRelocationContextChange = useCallback((context) => {
    setRelocationContext(context);
  }, []);

  const handleCompareContextChange = useCallback((context) => {
    setCompareContext(context);
  }, []);

  const handleHighlightTaluk = useCallback((zone) => {
    if (!zone?.district) {
      return;
    }
    setActiveView("map");
    setSelectedDistrict(zone.district);
    setSelectedTaluk(zone);
    setFilters((current) => ({
      ...current,
      district: zone.district,
    }));
    setFirHighlight({
      district: zone.district,
      taluk_id: zone.taluk_id || null,
      taluk: zone.taluk || zone.zone_name || null,
      createdAt: Date.now(),
    });
  }, []);

  const handleToggleWatchlist = useCallback((zone) => {
    const talukId = zone?.taluk_id;
    if (!talukId) {
      return;
    }
    setWatchlistTalukIds((current) =>
      current.includes(talukId)
        ? current.filter((item) => item !== talukId)
        : [...current, talukId],
    );
  }, []);

  const handleAssistantAction = useCallback(
    async (action) => {
      if (!action?.type) {
        return;
      }

      if (action.type === "switch_view" && action.view) {
        setActiveView(action.view);
        return;
      }

      if (action.type === "focus_district" && action.district) {
        setActiveView("map");
        setSelectedDistrict(action.district);
        setSelectedTaluk(null);
        setFilters((current) => ({
          ...current,
          district: action.district,
        }));
        return;
      }

      if (action.type === "highlight_taluk") {
        handleHighlightTaluk(action);
        return;
      }

      if (action.type === "compare_districts") {
        setComparePreset({
          left_district: action.left_district,
          right_district: action.right_district,
        });
        setActiveView("compare");
        return;
      }

      if (action.type === "download_report") {
        if (action.report === "operations") {
          await downloadApiPdf("/api/reports/operations-pdf", {
            params: action.params || {},
            filename: `operations-report-${Date.now()}.pdf`,
          });
        }
        if (action.report === "scenario") {
          await downloadApiPdf("/api/reports/scenario-pdf", {
            params: action.params || {},
            filename: `scenario-report-${Date.now()}.pdf`,
          });
        }
      }
    },
    [handleHighlightTaluk],
  );

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-gray-950">
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

      <div className="flex flex-1 flex-col overflow-hidden">
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
                  onDistrictClick={(district) => {
                    setSelectedDistrict(district);
                    setSelectedTaluk(null);
                  }}
                  refreshKey={dataRefreshKey}
                  highlightTarget={firHighlight}
                />
              ) : (
                <Map
                  filters={filters}
                  onDistrictClick={(district) => {
                    setSelectedDistrict(district);
                    setSelectedTaluk(null);
                  }}
                  onTalukClick={setSelectedTaluk}
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

              {riskCardOpen && (
                <RiskCard
                  district={selectedDistrict}
                  filters={filters}
                  selectedTaluk={selectedTaluk}
                  watchlistTalukIds={watchlistTalukIds}
                  onToggleWatchlist={handleToggleWatchlist}
                  onHighlightTaluk={handleHighlightTaluk}
                  latestFirImpact={latestFirImpact}
                />
              )}
            </>
          )}

          {activeView === "compare" && (
            <DistrictCompareView
              filters={filters}
              preset={comparePreset}
              onContextChange={handleCompareContextChange}
              watchlistTalukIds={watchlistTalukIds}
              onToggleWatchlist={handleToggleWatchlist}
              onHighlightTaluk={handleHighlightTaluk}
            />
          )}

          {activeView === "women-safety" && (
            <ScenarioZoneView
              scenario="women_safety"
              title="Women Safety Prediction"
              accentColor="#af1b1b"
              pointColor="#999999"
              limit={50}
              onContextChange={handleWomenSafetyContextChange}
            />
          )}

          {activeView === "accident-zones" && (
            <ScenarioZoneView
              scenario="accident"
              title="Accident Zone Prediction"
              accentColor="#af1b1b"
              pointColor="#999999"
              limit={50}
              onContextChange={handleAccidentContextChange}
            />
          )}

          {activeView === "analytics" && <Analytics />}

          {activeView === "travel" && (
            <TravelAdvisor onContextChange={handleTravelContextChange} />
          )}

          {activeView === "relocation" && (
            <AreaSafetyReport onContextChange={handleRelocationContextChange} />
          )}
        </div>
      </div>

      <FIRInjectModal
        open={isFirModalOpen}
        onClose={() => setIsFirModalOpen(false)}
        onCreated={handleFirCreated}
      />

      <OpsAssistant
        activeView={activeView}
        filters={filters}
        compareContext={compareContext}
        scenarioContext={
          activeView === "accident-zones" ? accidentContext : womenSafetyContext
        }
        travelContext={travelContext}
        relocationContext={relocationContext}
        onAction={handleAssistantAction}
      />
    </div>
  );
}

export default App;
