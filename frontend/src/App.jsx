import { useState } from "react";
import Map from "./components/Map";
import Sidebar from "./components/Sidebar";
import StatsBar from "./components/StatsBar";
import Analytics from "./components/Analytics";

function App() {
  const [filters, setFilters] = useState({});
  const [activeView, setActiveView] = useState("map");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950">
      <Sidebar
        onFilter={setFilters}
        activeView={activeView}
        onViewChange={setActiveView}
      />
      <div className="flex flex-col flex-1">
        <StatsBar />
        {activeView === "map" && <Map filters={filters} />}
        {activeView === "analytics" && <Analytics />}
      </div>
    </div>
  );
}

export default App;
