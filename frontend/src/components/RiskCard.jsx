import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { apiUrl } from "../lib/api";

const RISK_COLORS = {
  HIGH: "#EF4444",
  MEDIUM: "#F59E0B",
  LOW: "#22C55E",
};

const CONFIDENCE_TONE = {
  STRONG: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  MODERATE: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  CAUTION: "border-rose-500/30 bg-rose-500/10 text-rose-100",
};

function buildWatchlistQuery(talukIds = []) {
  const query = new URLSearchParams();
  talukIds.forEach((id) => query.append("taluk_ids", id));
  return query.toString();
}

function CompactMetric({ label, value, tone = "text-white" }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#888888]">
        {label}
      </p>
      <p className={`mt-2 text-xl font-black ${tone}`}>{value}</p>
    </div>
  );
}

export default function RiskCard({
  district,
  filters = {},
  selectedTaluk = null,
  watchlistTalukIds = [],
  onToggleWatchlist,
  onHighlightTaluk,
  latestFirImpact = null,
}) {
  const [profile, setProfile] = useState(null);
  const [watchlist, setWatchlist] = useState([]);
  const [selectedExplanation, setSelectedExplanation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  useEffect(() => {
    if (!district) {
      setProfile(null);
      return;
    }

    setLoading(true);
    axios
      .get(apiUrl("/api/insights/district-profile"), {
        params: {
          district,
          year: filters.year || undefined,
          category: filters.category || undefined,
        },
      })
      .then((response) => {
        setProfile(response.data);
      })
      .catch((error) => {
        console.error("Risk card profile error:", error);
        setProfile(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [district, filters.category, filters.year]);

  useEffect(() => {
    if (!selectedTaluk?.taluk_id || !district) {
      setSelectedExplanation(null);
      return;
    }

    axios
      .get(apiUrl("/api/insights/taluk-explanation"), {
        params: {
          taluk_id: selectedTaluk.taluk_id,
          district,
          year: filters.year || undefined,
          category: filters.category || undefined,
        },
      })
      .then((response) => {
        setSelectedExplanation(response.data);
      })
      .catch((error) => {
        console.error("Selected taluk explanation error:", error);
        setSelectedExplanation(null);
      });
  }, [district, filters.category, filters.year, selectedTaluk?.taluk_id]);

  useEffect(() => {
    if (!watchlistTalukIds.length) {
      setWatchlist([]);
      return;
    }

    const query = buildWatchlistQuery(watchlistTalukIds);
    setWatchlistLoading(true);
    axios
      .get(apiUrl(`/api/insights/watchlist?${query}`))
      .then((response) => {
        setWatchlist(response.data?.zones || []);
      })
      .catch((error) => {
        console.error("Watchlist snapshot error:", error);
        setWatchlist([]);
      })
      .finally(() => {
        setWatchlistLoading(false);
      });
  }, [watchlistTalukIds]);

  const explanation = selectedExplanation || profile?.explanation || null;
  const confidence = profile?.confidence || {};
  const firImpact = useMemo(() => {
    if (!latestFirImpact) return null;
    if (district && latestFirImpact.district !== district) return null;
    return latestFirImpact;
  }, [district, latestFirImpact]);

  if (!district) {
    return (
      <div className="flex w-[380px] min-h-full shrink-0 flex-col border-l border-white/5 bg-black text-white">
        <div className="border-b border-white/5 px-5 py-5">
          <p className="text-[11px] font-black uppercase tracking-[0.32em] text-[#af1b1b]">
            Ops Insight Rail
          </p>
          <h3 className="mt-3 text-2xl font-black uppercase tracking-tight">Risk + Watchlist</h3>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Click a district or ask Radar AI to focus one. This panel shows why a zone is risky,
            prediction confidence, bookmarked taluks, and FIR impact changes.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="rounded-[28px] border border-white/5 bg-white/5 p-5">
            <p className="text-sm font-semibold text-slate-300">No district selected yet.</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Select a district from the operations map or use a Radar AI action card.
            </p>
          </div>

          <div className="mt-5 rounded-[28px] border border-white/5 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#888888]">
                Watchlist
              </p>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200">
                {watchlistTalukIds.length} saved
              </span>
            </div>
            <div className="mt-3 space-y-3">
              {watchlistLoading ? (
                <p className="text-sm text-slate-400">Refreshing bookmarked zones...</p>
              ) : watchlist.length ? (
                watchlist.map((zone) => (
                  <div
                    key={zone.taluk_id}
                    className="rounded-2xl border border-white/5 bg-black/60 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-white">{zone.taluk}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#999999]">
                          {zone.district}
                        </p>
                      </div>
                      <span
                        className="rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-black"
                        style={{ backgroundColor: zone.color }}
                      >
                        {zone.risk_level}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-300">
                      <span>Live {zone.live_total}</span>
                      <span>Accident {zone.predicted_accident}</span>
                    </div>
                    <button
                      onClick={() => onHighlightTaluk?.(zone)}
                      className="mt-3 rounded-2xl border border-[#af1b1b]/35 bg-[#7f1d1d]/35 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-[#991b1b]/45"
                    >
                      Highlight On Map
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">No bookmarked taluks yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-[380px] min-h-full shrink-0 flex-col border-l border-white/5 bg-black text-white">
      <div
        className="border-b border-white/5 px-5 py-5"
        style={{ boxShadow: `inset 0 -1px 0 rgba(255,255,255,0.04), inset 0 0 120px ${RISK_COLORS[profile?.risk_level] || "#7f1d1d"}12` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.32em] text-[#af1b1b]">
              Live District Insight
            </p>
            <h3 className="mt-3 text-3xl font-black uppercase tracking-tight">
              {district}
            </h3>
          </div>
          <span
            className="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
            style={{
              borderColor: `${RISK_COLORS[profile?.risk_level] || "#ef4444"}55`,
              backgroundColor: `${RISK_COLORS[profile?.risk_level] || "#ef4444"}22`,
              color: "#fff6f6",
            }}
          >
            {profile?.risk_level || "Loading"} Risk
          </span>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-slate-400">Loading district intelligence...</p>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <CompactMetric label="Live Load" value={profile?.incident_total || 0} />
            <CompactMetric label="Risk Score" value={profile?.risk_score || 0} tone="text-[#ffd2d2]" />
            <CompactMetric
              label="Confidence"
              value={`${confidence.score || 0}/100`}
              tone="text-[#ffe2b8]"
            />
            <CompactMetric
              label="Saved Zones"
              value={watchlistTalukIds.length}
              tone="text-[#f2d4d4]"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="rounded-[28px] border border-white/5 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#888888]">
                Explain Why Risky
              </p>
              <p className="mt-2 text-lg font-black text-white">
                {explanation?.taluk || "No selected taluk"}
              </p>
            </div>
            {explanation && (
              <button
                onClick={() => onToggleWatchlist?.(explanation)}
                className="rounded-full border border-[#af1b1b]/35 bg-[#af1b1b]/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#ffd2d2] transition hover:bg-[#af1b1b]/25"
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
                  {explanation.risk_level}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-200">
                  {explanation.dominant_category}
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {explanation.reasons?.map((reason) => (
                  <div
                    key={reason}
                    className="rounded-2xl border border-white/5 bg-black/60 px-3 py-2 text-sm leading-6 text-slate-100"
                  >
                    {reason}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <span
                  className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                    CONFIDENCE_TONE[explanation.confidence?.label] || CONFIDENCE_TONE.CAUTION
                  }`}
                >
                  {explanation.confidence?.label || "CAUTION"}
                </span>
                <span className="text-xs text-slate-400">
                  Confidence {explanation.confidence?.score || 0}/100
                </span>
              </div>
              <button
                onClick={() => onHighlightTaluk?.(explanation)}
                className="mt-4 rounded-2xl border border-[#ef4444]/35 bg-[#7f1d1d]/35 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-[#991b1b]/45"
              >
                Highlight On Map
              </button>
            </>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              Click a taluk on the map to get a live explanation for why it is currently red, yellow, or green.
            </p>
          )}
        </div>

        <div className="mt-5 rounded-[28px] border border-white/5 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#888888]">
                Confidence Score
              </p>
              <p className="mt-2 text-2xl font-black text-white">
                {confidence.score || 0}/100
              </p>
            </div>
            <span
              className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                CONFIDENCE_TONE[confidence.label] || CONFIDENCE_TONE.CAUTION
              }`}
            >
              {confidence.label || "CAUTION"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            This district confidence comes from {confidence.coverage_months || 0} live months,
            {(confidence.total_incidents || 0).toLocaleString()} incident records, and{" "}
            {confidence.category_count || 0} observed crime categories.
          </p>
        </div>

        <div className="mt-5 rounded-[28px] border border-white/5 bg-white/5 p-5">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#888888]">
            Accident Blackspot Reasoning
          </p>
          {profile?.accident_reasoning?.zone ? (
            <>
              <p className="mt-3 text-lg font-black text-white">
                #{profile.accident_reasoning.zone.rank} {profile.accident_reasoning.zone.taluk}
              </p>
              <div className="mt-4 space-y-2">
                {profile.accident_reasoning.factors?.map((factor) => (
                  <div
                    key={factor}
                    className="rounded-2xl border border-white/5 bg-black/60 px-3 py-2 text-sm leading-6 text-slate-100"
                  >
                    {factor}
                  </div>
                ))}
              </div>
              {profile.accident_reasoning.nearby_stretches?.length > 0 && (
                <div className="mt-4 space-y-2">
                  {profile.accident_reasoning.nearby_stretches.map((item) => (
                    <div
                      key={`${item.taluk}-${item.distance_km}`}
                      className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-50"
                    >
                      {item.taluk}, {item.district} | {item.predicted_count} predicted |{" "}
                      {item.distance_km} km away
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">No accident reasoning is available.</p>
          )}
        </div>

        <div className="mt-5 rounded-[28px] border border-white/5 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#888888]">
              Watchlist
            </p>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200">
              {watchlistTalukIds.length} saved
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {watchlistLoading ? (
              <p className="text-sm text-slate-400">Refreshing bookmarked zones...</p>
            ) : watchlist.length ? (
              watchlist.map((zone) => (
                <div
                  key={zone.taluk_id}
                  className="rounded-2xl border border-white/5 bg-black/60 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-white">{zone.taluk}</p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#999999]">
                        {zone.district}
                      </p>
                    </div>
                    <span
                      className="rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-black"
                      style={{ backgroundColor: zone.color || RISK_COLORS[zone.risk_level] }}
                    >
                      {zone.risk_level}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <span>Live {zone.live_total}</span>
                    <span>Women {zone.predicted_women_safety}</span>
                    <span>Accident {zone.predicted_accident}</span>
                    <span>{zone.dominant_category}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => onHighlightTaluk?.(zone)}
                      className="rounded-2xl border border-[#af1b1b]/35 bg-[#7f1d1d]/35 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-[#991b1b]/45"
                    >
                      Highlight
                    </button>
                    <button
                      onClick={() => onToggleWatchlist?.(zone)}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-white/10"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No bookmarked taluks yet.</p>
            )}
          </div>
        </div>

        {firImpact && (
          <div className="mt-5 rounded-[28px] border border-[#af1b1b]/30 bg-[#7f1d1d]/15 p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#ffd2d2]">
              Before vs After FIR Impact
            </p>
            <p className="mt-3 text-lg font-black text-white">
              {firImpact.taluk}, {firImpact.district}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-100">{firImpact.summary}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <CompactMetric
                label="Taluk Load"
                value={`${firImpact.taluk_total_before} → ${firImpact.taluk_total_after}`}
                tone="text-[#ffd2d2]"
              />
              <CompactMetric
                label="District Load"
                value={`${firImpact.district_total_before} → ${firImpact.district_total_after}`}
                tone="text-[#ffd2d2]"
              />
              <CompactMetric
                label="Taluk Rank"
                value={`${firImpact.taluk_rank_before || "-"} → ${firImpact.taluk_rank_after || "-"}`}
                tone="text-[#ffd2d2]"
              />
              <CompactMetric
                label="District Rank"
                value={`${firImpact.district_rank_before || "-"} → ${firImpact.district_rank_after || "-"}`}
                tone="text-[#ffd2d2]"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
