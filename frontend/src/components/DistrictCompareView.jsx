import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { apiUrl } from "../lib/api";

const RISK_TONE = {
  HIGH: "border-red-500/35 bg-red-500/10 text-red-100",
  MEDIUM: "border-amber-500/35 bg-amber-500/10 text-amber-100",
  LOW: "border-emerald-500/35 bg-emerald-500/10 text-emerald-100",
};

const CONFIDENCE_TONE = {
  STRONG: "text-emerald-200 border-emerald-500/30 bg-emerald-500/10",
  MODERATE: "text-amber-200 border-amber-500/30 bg-amber-500/10",
  CAUTION: "text-rose-200 border-rose-500/30 bg-rose-500/10",
};

function MetricTile({ label, value, accent = "text-white" }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/50 p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#888888]">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-black ${accent}`}>{value}</p>
    </div>
  );
}

function DistrictCard({
  title,
  profile,
  watchlistTalukIds,
  onToggleWatchlist,
  onHighlightTaluk,
}) {
  if (!profile) {
    return (
      <div className="rounded-[28px] border border-white/5 bg-white/5 p-5">
        <p className="text-sm text-slate-400">Select a district to compare.</p>
      </div>
    );
  }

  const explanation = profile.explanation;
  const confidence = profile.confidence || {};
  const womenPeak = profile.women_safety_peak;
  const accidentPeak = profile.accident_peak;
  const accidentReasoning = profile.accident_reasoning;

  return (
    <div className="rounded-[28px] border border-white/5 bg-white/5 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.34)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-[#8f8f8f]">
            {title}
          </p>
          <h3 className="mt-2 text-3xl font-black uppercase tracking-tight text-white">
            {profile.district}
          </h3>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${
            RISK_TONE[profile.risk_level] || RISK_TONE.LOW
          }`}
        >
          {profile.risk_level} Risk
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MetricTile label="Live Load" value={profile.incident_total || 0} accent="text-white" />
        <MetricTile label="Risk Score" value={profile.risk_score || 0} accent="text-[#fca5a5]" />
        <MetricTile
          label="Women Safety Peak"
          value={womenPeak?.predicted_count ?? 0}
          accent="text-rose-200"
        />
        <MetricTile
          label="Accident Peak"
          value={accidentPeak?.predicted_count ?? 0}
          accent="text-amber-200"
        />
      </div>

      <div className="mt-5 rounded-[24px] border border-white/5 bg-black/45 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8f8f8f]">
              Confidence
            </p>
            <p className="mt-1 text-lg font-black text-white">
              {confidence.score ?? 0}/100
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${
              CONFIDENCE_TONE[confidence.label] || CONFIDENCE_TONE.CAUTION
            }`}
          >
            {confidence.label || "CAUTION"}
          </span>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-300">
          Built from {confidence.coverage_months ?? 0} active months,{" "}
          {confidence.category_count ?? 0} crime categories, and{" "}
          {(confidence.total_incidents ?? 0).toLocaleString()} live incident records.
        </p>
      </div>

      <div className="mt-5 rounded-[24px] border border-white/5 bg-black/45 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8f8f8f]">
              Why Risky
            </p>
            <p className="mt-1 text-lg font-black text-white">
              {explanation?.taluk || "No live taluk explanation"}
            </p>
          </div>
          {explanation && (
            <button
              onClick={() => onToggleWatchlist?.(explanation)}
              className="rounded-full border border-[#af1b1b]/40 bg-[#af1b1b]/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#ffd2d2] transition hover:bg-[#af1b1b]/25"
            >
              {watchlistTalukIds.includes(explanation.taluk_id) ? "Unwatch" : "Watch"}
            </button>
          )}
        </div>
        {explanation ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.18em]">
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-200">
                Rank #{explanation.rank}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-200">
                {explanation.dominant_category}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-200">
                {explanation.risk_level}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {explanation.reasons?.map((reason) => (
                <p
                  key={reason}
                  className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2 text-sm leading-6 text-slate-100"
                >
                  {reason}
                </p>
              ))}
            </div>
            <button
              onClick={() => onHighlightTaluk?.(explanation)}
              className="mt-3 rounded-2xl border border-[#ef4444]/35 bg-[#7f1d1d]/40 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-[#991b1b]/55"
            >
              Highlight On Map
            </button>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No explanation available for the current filters.</p>
        )}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="rounded-[24px] border border-white/5 bg-black/45 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8f8f8f]">
            Crime Mix
          </p>
          <div className="mt-3 space-y-3">
            {(profile.top_categories || []).slice(0, 4).map((item) => (
              <div key={item.category}>
                <div className="flex items-center justify-between text-xs text-slate-200">
                  <span>{item.category}</span>
                  <span>{item.total_count}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-white/5">
                  <div
                    className="h-2 rounded-full bg-[linear-gradient(90deg,#7f1d1d,#ef4444)]"
                    style={{
                      width: `${Math.max(
                        8,
                        Math.min(
                          100,
                          ((item.total_count || 0) /
                            Math.max(...(profile.top_categories || []).map((row) => row.total_count || 1), 1)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/5 bg-black/45 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8f8f8f]">
            Accident Blackspot
          </p>
          {accidentReasoning?.zone ? (
            <>
              <p className="mt-2 text-lg font-black text-white">
                #{accidentReasoning.zone.rank} {accidentReasoning.zone.taluk}
              </p>
              <div className="mt-3 space-y-2">
                {accidentReasoning.factors?.map((factor) => (
                  <p
                    key={factor}
                    className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2 text-sm leading-6 text-slate-100"
                  >
                    {factor}
                  </p>
                ))}
              </div>
              {accidentReasoning.nearby_stretches?.length > 0 && (
                <div className="mt-3 space-y-2">
                  {accidentReasoning.nearby_stretches.map((item) => (
                    <div
                      key={`${item.taluk}-${item.distance_km}`}
                      className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-50"
                    >
                      {item.taluk}, {item.district} | {item.predicted_count} predicted |{" "}
                      {item.distance_km} km
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">No accident blackspot reasoning available.</p>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border border-white/5 bg-black/45 p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8f8f8f]">
          Attention Taluks
        </p>
        <div className="mt-3 space-y-3">
          {(profile.top_taluks || []).slice(0, 4).map((taluk) => (
            <div
              key={taluk.taluk_id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/5 px-3 py-3"
            >
              <div>
                <p className="text-sm font-black uppercase tracking-tight text-white">
                  {taluk.taluk}
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#999999]">
                  {taluk.total} incidents | {taluk.dominant_category}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onToggleWatchlist?.(taluk)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-white/10"
                >
                  {watchlistTalukIds.includes(taluk.taluk_id) ? "Saved" : "Watch"}
                </button>
                <button
                  onClick={() => onHighlightTaluk?.(taluk)}
                  className="rounded-full border border-[#af1b1b]/40 bg-[#af1b1b]/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#ffd2d2] transition hover:bg-[#af1b1b]/25"
                >
                  Highlight
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DistrictCompareView({
  filters = {},
  preset = null,
  onContextChange,
  watchlistTalukIds = [],
  onToggleWatchlist,
  onHighlightTaluk,
}) {
  const [districts, setDistricts] = useState([]);
  const [leftDistrict, setLeftDistrict] = useState("");
  const [rightDistrict, setRightDistrict] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    axios
      .get(apiUrl("/api/fir/districts"))
      .then((response) => {
        const nextDistricts = response.data?.districts || [];
        setDistricts(nextDistricts);
        if (!nextDistricts.length) {
          return;
        }
        setLeftDistrict((current) => current || preset?.left_district || nextDistricts[0]);
        setRightDistrict((current) => {
          if (current) return current;
          if (preset?.right_district) return preset.right_district;
          return nextDistricts[1] || nextDistricts[0];
        });
      })
      .catch((loadError) => {
        console.error("District compare districts error:", loadError);
        setError("District options could not be loaded.");
      });
  }, [preset?.left_district, preset?.right_district]);

  useEffect(() => {
    if (!leftDistrict || !rightDistrict) {
      return;
    }
    setLoading(true);
    setError("");
    axios
      .get(apiUrl("/api/insights/district-compare"), {
        params: {
          left_district: leftDistrict,
          right_district: rightDistrict,
          year: filters.year || undefined,
          category: filters.category || undefined,
        },
      })
      .then((response) => {
        setData(response.data);
      })
      .catch((compareError) => {
        console.error("District compare error:", compareError);
        setError("District comparison could not be generated right now.");
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [filters.category, filters.year, leftDistrict, rightDistrict]);

  useEffect(() => {
    onContextChange?.({
      left_district: leftDistrict,
      right_district: rightDistrict,
      year: filters.year || null,
      category: filters.category || null,
      loaded: !loading,
      has_data: Boolean(data?.left && data?.right),
    });
  }, [data, filters.category, filters.year, leftDistrict, loading, onContextChange, rightDistrict]);

  const compareSummary = useMemo(() => data?.comparison || {}, [data]);

  return (
    <div className="flex flex-1 overflow-hidden bg-black text-white">
      <div className="flex-1 overflow-y-auto p-5">
        <div className="rounded-[32px] border border-white/5 bg-white/5 p-6 shadow-[0_26px_90px_rgba(0,0,0,0.4)]">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.34em] text-[#af1b1b]">
                Live District Compare
              </p>
              <h2 className="mt-3 text-4xl font-black uppercase tracking-tight text-white">
                District vs District
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                Real-time comparison of live incident load, crime mix, women safety pressure,
                accident pressure, confidence, and taluk-level reasoning from the current backend data.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <select
                value={leftDistrict}
                onChange={(event) => setLeftDistrict(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white"
              >
                {districts.map((district) => (
                  <option key={`left-${district}`} value={district}>
                    {district}
                  </option>
                ))}
              </select>
              <select
                value={rightDistrict}
                onChange={(event) => setRightDistrict(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white"
              >
                {districts.map((district) => (
                  <option key={`right-${district}`} value={district}>
                    {district}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  setLeftDistrict(rightDistrict);
                  setRightDistrict(leftDistrict);
                }}
                className="rounded-2xl border border-[#af1b1b]/35 bg-[#7f1d1d]/30 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:bg-[#991b1b]/45"
              >
                Swap
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-4">
            <MetricTile label="Higher Live Load" value={compareSummary.higher_live_load || "N/A"} accent="text-[#ffd2d2]" />
            <MetricTile label="Higher Risk" value={compareSummary.higher_risk || "N/A"} accent="text-[#ffd2d2]" />
            <MetricTile
              label="Women Safety Pressure"
              value={compareSummary.higher_women_safety_pressure || "N/A"}
              accent="text-rose-200"
            />
            <MetricTile
              label="Accident Pressure"
              value={compareSummary.higher_accident_pressure || "N/A"}
              accent="text-amber-200"
            />
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-5 rounded-[28px] border border-white/5 bg-white/5 px-6 py-8 text-center text-sm text-slate-300">
            Building district comparison from the live backend data...
          </div>
        ) : (
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <DistrictCard
              title="District A"
              profile={data?.left}
              watchlistTalukIds={watchlistTalukIds}
              onToggleWatchlist={onToggleWatchlist}
              onHighlightTaluk={onHighlightTaluk}
            />
            <DistrictCard
              title="District B"
              profile={data?.right}
              watchlistTalukIds={watchlistTalukIds}
              onToggleWatchlist={onToggleWatchlist}
              onHighlightTaluk={onHighlightTaluk}
            />
          </div>
        )}
      </div>
    </div>
  );
}
