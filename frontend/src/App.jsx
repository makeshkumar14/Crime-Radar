import { useState } from "react";
import Map from "./components/Map";
import Sidebar from "./components/Sidebar";
import StatsBar from "./components/StatsBar";

function App() {
  const [filters, setFilters] = useState({});

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950">
      <Sidebar onFilter={setFilters} />
      <div className="flex flex-col flex-1">
        <StatsBar />
        <Map filters={filters} />
      </div>
    </div>
  );
}

export default App;
