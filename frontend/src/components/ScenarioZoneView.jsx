import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Circle,
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const TN_CENTER = [10.7905, 78.7047];

const MAP_STYLES = {
  street: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap",
    label: "Street",
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "© CartoDB",
    label: "Dark",
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "© OpenTopoMap",
    label: "Terrain",
    maxZoom: 17,
  },
};

const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      query.append(key, value);
    }
  });
  return query.toString();
}

function ScenarioMapController({ center, zoom }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.1 });
  }, [center, zoom, map]);

  return null;
}

function getPointRadius(weight) {
  if (weight >= 2.5) return 7;
  if (weight >= 1.5) return 6;
  if (weight >= 0.8) return 5;
  return 4;
}

export default function ScenarioZoneView({
  scenario,
  title,
  subtitle,
  accentColor,
  pointColor,
}) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [mapStyle, setMapStyle] = useState("street");
  const [showDerivedPoints, setShowDerivedPoints] = useState(true);
  const [district, setDistrict] = useState("");
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState(String(currentMonth));
  const [options, setOptions] = useState({ districts: [], years: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get("http://localhost:8000/api/fir/districts"),
      axios.get("http://localhost:8000/api/fir/years"),
    ])
      .then(([districtRes, yearRes]) => {
        const yearValues = new Set([
          ...((yearRes.data.years || []).map((item) => Number(item))),
          currentYear,
        ]);
        setOptions({
          districts: districtRes.data.districts || [],
          years: Array.from(yearValues).sort((a, b) => a - b),
        });
      })
      .catch((error) => {
        console.error("Scenario filter options error:", error);
      });
  }, [currentYear]);

  useEffect(() => {
    const query = buildQuery({
      scenario,
      district,
      year: Number(year),
      month: Number(month),
      limit: 20,
    });

    setLoading(true);
    axios
      .get(`http://localhost:8000/api/predict/scenario-zones?${query}`)
      .then((response) => {
        setData(response.data);
      })
      .catch((error) => {
        console.error("Scenario prediction error:", error);
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [district, month, scenario, year]);

  const topZone = data?.zones?.[0] || null;
  const mapCenter = topZone ? [topZone.lat, topZone.lng] : TN_CENTER;
  const mapZoom = district && topZone ? 9 : 7;
  const visibleZones = data?.zones || [];
  const visiblePoints = showDerivedPoints ? data?.incident_points || [] : [];
  const headlineCards = [
    {
      label: "Top Zones",
      value: data?.summary?.zones || 0,
    },
    {
      label: "Derived Incidents",
      value: data?.summary?.derived_points || 0,
    },
    {
      label: "Peak District",
      value: data?.summary?.peak_district || "N/A",
    },
    {
      label: "Peak Forecast",
      value: data?.summary?.peak_prediction || 0,
    },
  ];

  const forecastLabel = useMemo(() => {
    const monthLabel =
      MONTH_OPTIONS.find((item) => String(item.value) === String(month))?.label || "Current month";
    return `${monthLabel} ${year}`;
  }, [month, year]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-950">
        <p className="text-base text-white animate-pulse">
          Building {title.toLowerCase()} prediction map...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden bg-gray-950 text-white">
      <aside className="w-[360px] shrink-0 overflow-y-auto border-r border-white/10 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.95),_rgba(2,6,23,1))] p-5">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.35em]"
            style={{ color: accentColor }}
          >
            Separate Prediction Surface
          </p>
          <h2 className="mt-3 text-3xl font-black leading-none">{title}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">{subtitle}</p>
          <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-slate-300">
            Derived markers on this page are generated from the prediction engine at request time.
            They align to your existing seeded taluk geometry but are not inserted into
            <span className="px-1 text-white">fir_records</span>
            or the previous dummy data tables.
          </p>
        </div>

        <div className="mt-5 rounded-[28px] border border-white/10 bg-slate-900/80 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-400">
            Scenario Controls
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                District
              </label>
              <select
                value={district}
                onChange={(event) => setDistrict(event.target.value)}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
              >
                <option value="">All districts</option>
                {options.districts.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Forecast Year
                </label>
                <select
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                >
                  {options.years.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Forecast Month
                </label>
                <select
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                >
                  {MONTH_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={showDerivedPoints}
                onChange={(event) => setShowDerivedPoints(event.target.checked)}
                className="h-4 w-4"
                style={{ accentColor }}
              />
              Show dense derived incident markers
            </label>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {headlineCards.map((card) => (
            <div
              key={card.label}
              className="rounded-[24px] border border-white/10 bg-white/5 p-4"
            >
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                {card.label}
              </p>
              <p className="mt-2 text-xl font-black text-white">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-[28px] border border-white/10 bg-slate-900/85 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-400">
                Forecast Window
              </p>
              <p className="mt-2 text-lg font-bold text-white">{forecastLabel}</p>
            </div>
            <div
              className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.22em]"
              style={{ backgroundColor: `${accentColor}22`, color: accentColor }}
            >
              Top 20
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {visibleZones.length ? (
              visibleZones.slice(0, 8).map((zone) => (
                <div
                  key={zone.taluk_id}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        #{zone.rank} {zone.taluk}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                        {zone.district}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black" style={{ color: accentColor }}>
                        {zone.predicted_count}
                      </p>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                        predicted
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-300">
                    <span>Index {zone.prediction_index}</span>
                    <span>{zone.predicted_top_category}</span>
                    <span>{zone.risk_level}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                No zones matched this scenario and filter window.
              </p>
            )}
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-4">
          <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p
                  className="text-[11px] font-semibold uppercase tracking-[0.34em]"
                  style={{ color: accentColor }}
                >
                  Precision Mapping
                </p>
                <h3 className="mt-2 text-xl font-black text-white">
                  Zone envelopes with dense derived point overlay
                </h3>
              </div>
              <div className="flex gap-2">
                {Object.entries(MAP_STYLES).map(([key, style]) => (
                  <button
                    key={key}
                    onClick={() => setMapStyle(key)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      mapStyle === key
                        ? "text-white"
                        : "bg-slate-900 text-slate-400"
                    }`}
                    style={
                      mapStyle === key
                        ? { backgroundColor: accentColor }
                        : undefined
                    }
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              The circles show forecast zone envelopes, while the smaller markers distribute
              isolated dummy incidents inside each zone to make the prediction surface easier to
              read without touching the original seeded dataset.
            </p>
          </div>

          <div className="rounded-[30px] border border-white/10 bg-slate-900/90 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-400">
              Model Notes
            </p>
            <div className="mt-4 space-y-3">
              {(data?.notes || []).map((note) => (
                <p
                  key={note}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-slate-300"
                >
                  {note}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 rounded-[32px] border border-white/10 bg-slate-950/70 p-3">
          <div className="h-full overflow-hidden rounded-[26px]">
            <MapContainer
              center={TN_CENTER}
              zoom={7}
              style={{ height: "100%", width: "100%" }}
              zoomControl={false}
            >
              <ZoomControl position="bottomright" />
              <TileLayer
                key={mapStyle}
                url={MAP_STYLES[mapStyle].url}
                attribution={MAP_STYLES[mapStyle].attribution}
                maxZoom={MAP_STYLES[mapStyle].maxZoom || 19}
              />
              <ScenarioMapController center={mapCenter} zoom={mapZoom} />

              {visibleZones.map((zone) => (
                <Circle
                  key={zone.taluk_id}
                  center={[zone.lat, zone.lng]}
                  radius={zone.radius_km * 1000}
                  pathOptions={{
                    color: accentColor,
                    fillColor: accentColor,
                    fillOpacity: 0.16,
                    weight: zone.rank <= 5 ? 2.5 : 1.6,
                    dashArray: zone.rank <= 5 ? "6 4" : "4 4",
                  }}
                >
                  <Tooltip direction="top">
                    <div className="min-w-[170px] text-xs">
                      <p className="font-bold text-slate-900">
                        #{zone.rank} {zone.taluk}
                      </p>
                      <p className="mt-1 text-slate-700">{zone.district}</p>
                      <p className="mt-2 text-slate-900">
                        Predicted count: {zone.predicted_count}
                      </p>
                      <p className="text-slate-700">Prediction index: {zone.prediction_index}</p>
                      <p className="text-slate-700">Risk: {zone.risk_level}</p>
                    </div>
                  </Tooltip>
                </Circle>
              ))}

              {visiblePoints.map((point) => (
                <CircleMarker
                  key={point.point_id}
                  center={[point.lat, point.lng]}
                  radius={getPointRadius(point.weight)}
                  pathOptions={{
                    color: pointColor,
                    fillColor: pointColor,
                    fillOpacity: 0.84,
                    weight: 1,
                  }}
                >
                  <Tooltip direction="top">
                    <div className="text-xs">
                      <p className="font-bold text-slate-900">{point.taluk}</p>
                      <p className="mt-1 text-slate-700">{point.district}</p>
                      <p className="mt-2 text-slate-900">Derived weight: {point.weight}</p>
                    </div>
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
