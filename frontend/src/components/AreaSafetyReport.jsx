import { useEffect, useState } from "react";
import axios from "axios";

export default function AreaSafetyReport() {
  const [taluks, setTaluks] = useState([]);
  const [selectedTaluk, setSelectedTaluk] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios
      .get("http://localhost:8000/api/fir/taluks")
      .then((res) => {
        setTaluks(res.data.taluks);
        if (res.data.taluks.length > 0) {
          setSelectedTaluk(res.data.taluks[0].taluk_id);
        }
      })
      .catch((err) => console.error("Area safety taluk load error:", err));
  }, []);

  const handleCheck = async () => {
    if (!selectedTaluk) return;
    setLoading(true);
    try {
      const response = await axios.get("http://localhost:8000/api/citizen/area-safety", {
        params: { taluk_id: selectedTaluk },
      });
      setReport(response.data.report);
    } catch (error) {
      console.error("Area safety error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!selectedTaluk) return;
    window.open(
      `http://localhost:8000/api/citizen/area-safety-report?taluk_id=${selectedTaluk}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-2 text-2xl font-bold">Family Relocation Safety Report</h2>
        <p className="mb-6 text-sm text-gray-400">
          Evaluate whether a neighbourhood zone is suitable for family relocation
          using predicted crime load, women safety, accident exposure, and nearby
          comparison.
        </p>

        <div className="mb-6 grid gap-4 rounded-2xl border border-gray-800 bg-gray-900/70 p-5 md:grid-cols-[1fr_180px_180px]">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              Select Area
            </label>
            <select
              value={selectedTaluk}
              onChange={(event) => setSelectedTaluk(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm"
            >
              {taluks.map((taluk) => (
                <option key={taluk.taluk_id} value={taluk.taluk_id}>
                  {taluk.taluk}, {taluk.district}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleCheck}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? "Checking..." : "Generate Safety View"}
          </button>
          <button
            onClick={handleDownload}
            disabled={!selectedTaluk}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-60"
          >
            Download PDF
          </button>
        </div>

        {report && (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Area Summary
                    </p>
                    <h3 className="mt-1 text-xl font-bold">
                      {report.taluk}, {report.district}
                    </h3>
                  </div>
                  <div className="rounded-xl bg-gray-950/70 px-4 py-2 text-right">
                    <p className="text-xs text-gray-400">Grade</p>
                    <p className="text-lg font-bold text-emerald-300">{report.grade}</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["Safety Index", report.safety_index],
                    ["Risk Score", report.risk_score],
                    ["Women Safety", report.women_safety_index],
                    ["Accident Exposure", report.accident_exposure_index],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-gray-950/60 p-4">
                      <p className="text-xs text-gray-400">{label}</p>
                      <p className="mt-1 text-lg font-bold">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Predicted Crime Mix
                </p>
                <div className="space-y-3">
                  {Object.entries(report.categories).slice(0, 8).map(([category, value]) => (
                    <div key={category}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span>{category}</span>
                        <span>{value}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-800">
                        <div
                          className="h-2 rounded-full bg-blue-500"
                          style={{
                            width: `${Math.min(100, (value / report.predicted_total) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Recommendation
                </p>
                <p className="text-sm leading-6 text-gray-200">{report.recommendation}</p>
                <div className="mt-4 rounded-xl bg-gray-950/60 p-4">
                  <p className="text-xs text-gray-400">Dominant Predicted Crime</p>
                  <p className="mt-1 text-lg font-bold text-amber-300">
                    {report.predicted_top_category}
                  </p>
                </div>
                <div className="mt-3 rounded-xl bg-gray-950/60 p-4">
                  <p className="text-xs text-gray-400">Predicted Crime Load</p>
                  <p className="mt-1 text-lg font-bold">{report.predicted_total}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Nearby Comparison
                </p>
                <div className="space-y-3">
                  {report.nearby_comparison.map((item) => (
                    <div key={item.taluk} className="rounded-xl bg-gray-950/60 p-3 text-sm">
                      <p className="font-semibold text-white">{item.taluk}</p>
                      <p className="text-gray-400">
                        Risk score: {item.risk_score} | Predicted cases: {item.predicted_total}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
