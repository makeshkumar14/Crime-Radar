import { useEffect, useState } from "react";
import axios from "axios";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = [
  "#EF4444",
  "#F59E0B",
  "#22C55E",
  "#3B82F6",
  "#A855F7",
  "#06B6D4",
  "#F97316",
  "#EC4899",
];

export default function Analytics() {
  const [trend, setTrend] = useState([]);
  const [summary, setSummary] = useState([]);
  const [seasonal, setSeasonal] = useState([]);
  const [highRisk, setHighRisk] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get("http://localhost:8000/api/crimes/trend"),
      axios.get("http://localhost:8000/api/crimes/summary"),
      axios.get("http://localhost:8000/api/predict/seasonal-ml"),
      axios.get("http://localhost:8000/api/predict/high-risk-districts"),
    ])
      .then(([trendRes, summaryRes, seasonalRes, highRiskRes]) => {
        setTrend(trendRes.data.trend);
        setSummary(summaryRes.data.summary.slice(0, 6));
        setHighRisk(highRiskRes.data.high_risk.slice(0, 8));

        const monthMap = {};
        (seasonalRes.data.predictions || []).forEach((row) => {
          const key = `${row.year}-${String(row.month).padStart(2, "0")}`;
          if (!monthMap[key]) {
            monthMap[key] = {
              label: `${row.month_name} ${String(row.year).slice(-2)}`,
              order: key,
              total: 0,
            };
          }
          monthMap[key].total += row.predicted_cases;
        });

        setSeasonal(
          Object.values(monthMap)
            .sort((a, b) => a.order.localeCompare(b.order))
            .map((row) => ({
              month: row.label,
              total: Number(row.total.toFixed(2)),
            })),
        );

        setLoading(false);
      })
      .catch((error) => {
        console.error("Analytics error:", error);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <p className="text-white animate-pulse">Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-gray-950 overflow-y-auto p-4">
      <h2 className="text-white font-bold text-lg mb-4">
        Tamil Nadu Crime Analytics
      </h2>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-xs font-bold mb-3">
            YEAR-ON-YEAR CRIME TREND
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="year" stroke="#9CA3AF" tick={{ fontSize: 11 }} />
              <YAxis stroke="#9CA3AF" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#111827", border: "none" }}
                labelStyle={{ color: "#F9FAFB" }}
              />
              <Line
                type="monotone"
                dataKey="cases"
                stroke="#3B82F6"
                strokeWidth={2}
                dot={{ fill: "#3B82F6", r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-xs font-bold mb-3">
            SEASONAL ML FORECAST
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={seasonal}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" stroke="#9CA3AF" tick={{ fontSize: 11 }} />
              <YAxis stroke="#9CA3AF" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#111827", border: "none" }}
                labelStyle={{ color: "#F9FAFB" }}
              />
              <Bar dataKey="total" fill="#F59E0B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-xs font-bold mb-3">
            CRIME CATEGORY BREAKDOWN
          </p>
          <div className="flex items-center">
            <ResponsiveContainer width="60%" height={200}>
              <PieChart>
                <Pie
                  data={summary}
                  dataKey="total_count"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                >
                  {summary.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#111827", border: "none" }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1">
              {summary.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-gray-300 text-xs">{item.category}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-xs font-bold mb-3">
            TOP HIGH RISK DISTRICTS
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={highRisk} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" stroke="#9CA3AF" tick={{ fontSize: 10 }} />
              <YAxis
                type="category"
                dataKey="district"
                stroke="#9CA3AF"
                tick={{ fontSize: 10 }}
                width={80}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#111827", border: "none" }}
                labelStyle={{ color: "#F9FAFB" }}
              />
              <Bar
                dataKey="total_crimes"
                fill="#EF4444"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
