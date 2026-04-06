import { useState, useEffect } from "react";
import axios from "axios";

const RISK_COLORS = {
  HIGH: "#EF4444",
  MEDIUM: "#F59E0B",
  LOW: "#22C55E",
};

const RISK_ICONS = {
  HIGH: "🔴",
  MEDIUM: "🟡",
  LOW: "🟢",
};

const MONTH_NAMES = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export default function RiskCard({ district }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!district) return;
    setLoading(true);
    axios
      .get(`http://localhost:8000/api/predict/risk-score?district=${district}`)
      .then((res) => {
        setData(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [district]);

  // Default state — no district selected
  if (!district)
    return (
      <div
        style={{
          width: "220px",
          height: "100%",
          background: "#000000",
          borderLeft: "1px solid rgba(255,255,255,0.05)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          gap: "12px",
        }}
      >
        <div style={{ fontSize: "32px" }}>🗺</div>
        <p
          style={{
            color: "#999999",
            fontSize: "11px",
            textAlign: "center",
            lineHeight: 1.6,
            fontWeight: "bold",
            textTransform: "uppercase",
            letterSpacing: "0.1em"
          }}
        >
          Select a district
        </p>
      </div>
    );

  if (loading)
    return (
      <div
        style={{
          width: "220px",
          height: "100%",
          background: "#000000",
          borderLeft: "1px solid rgba(255,255,255,0.05)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p style={{ color: "#999999", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>Analysing...</p>
      </div>
    );

  if (!data) return null;

  const color = RISK_COLORS[data.risk_level] === "#EF4444" ? "#af1b1b" : 
                RISK_COLORS[data.risk_level] === "#F59E0B" ? "#df2c2c" : "#999999";
  const icon = RISK_ICONS[data.risk_level] || "⚪";

  // Find peak month from breakdown
  const peakMonth = data.breakdown?.reduce(
    (max, r) => (r.total_crimes > (max?.total_crimes || 0) ? r : max),
    null,
  );

  return (
    <div
      style={{
        width: "220px",
        minHeight: "100%",
        background: "#000000",
        borderLeft: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Risk header */}
      <div
        style={{
          background: color + "22",
          borderBottom: `2px solid ${color}`,
          padding: "12px 16px",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            color: "#ffffff",
            fontWeight: "bold",
            letterSpacing: "2px",
            marginBottom: "4px",
          }}
        >
          RISK ASSESSMENT
        </div>
        <div
          style={{
            fontSize: "18px",
            fontWeight: "bold",
            color: color,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {icon} {data.risk_level} RISK
        </div>
      </div>

      {/* District name */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            color: "#ffffff",
            fontWeight: "bold",
            letterSpacing: "1px",
            marginBottom: "4px",
          }}
        >
          DISTRICT
        </div>
        <div
          style={{
            fontSize: "15px",
            fontWeight: "bold",
            color: "#f1f5f9",
          }}
        >
          {data.district}
        </div>
      </div>

      {/* Risk score bar */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e293b" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "6px",
          }}
        >
          <span
            style={{ fontSize: "10px", color: "#64748b", letterSpacing: "1px" }}
          >
            RISK SCORE
          </span>
          <span style={{ fontSize: "14px", fontWeight: "bold", color }}>
            {data.risk_score}/100
          </span>
        </div>
        {/* Progress bar */}
        <div
          style={{
            width: "100%",
            height: "6px",
            background: "#1e293b",
            borderRadius: "3px",
          }}
        >
          <div
            style={{
              width: `${data.risk_score}%`,
              height: "100%",
              background: color,
              borderRadius: "3px",
              transition: "width 0.8s ease",
            }}
          />
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e293b" }}>
        <div
          style={{
            fontSize: "11px",
            color: "#ffffff",
            fontWeight: "bold",
            letterSpacing: "1px",
            marginBottom: "8px",
          }}
        >
          CRIME STATISTICS
        </div>

        {[
          { label: "Total Crimes", value: data.total_crimes?.toLocaleString() },
          { label: "Categories", value: data.categories || 0 },
          { label: "Top Crime", value: peakMonth?.category || "N/A" },
        ].map(({ label, value }, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "6px",
            }}
          >
            <span style={{ fontSize: "12px", color: "#ffffff", fontWeight: "bold" }}>{label}</span>
            <span
              style={{ fontSize: "12px", fontWeight: "bold", color: "#f1f5f9" }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Crime breakdown */}
      <div style={{ padding: "12px 16px", flex: 1 }}>
        <div
          style={{
            fontSize: "11px",
            color: "#ffffff",
            fontWeight: "bold",
            letterSpacing: "1px",
            marginBottom: "8px",
          }}
        >
          CRIME BREAKDOWN
        </div>
        {data.breakdown?.slice(0, 5).map((item, i) => {
          const maxCrimes = data.breakdown[0]?.total_crimes || 1;
          const pct = Math.round((item.total_crimes / maxCrimes) * 100);
          const catColors = {
            Violent: "#EF4444",
            Property: "#F59E0B",
            "Women Safety": "#EC4899",
            Burglary: "#8B5CF6",
            Fraud: "#3B82F6",
            "Public Order": "#06B6D4",
            NDPS: "#F97316",
          };
          const catColor = catColors[item.category] || "#64748b";

          return (
            <div key={i} style={{ marginBottom: "8px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "3px",
                }}
              >
                <span style={{ fontSize: "10px", color: catColor }}>
                  {item.category}
                </span>
                <span style={{ fontSize: "10px", color: catColor }}>
                  {item.total_crimes?.toLocaleString()}
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "3px",
                  background: "#1e293b",
                  borderRadius: "2px",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: catColor,
                    borderRadius: "2px",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Recommendation */}
      <div
        style={{
          padding: "12px 16px",
          background: color + "11",
          borderTop: `1px solid ${color}44`,
        }}
      >
        <div
          style={{
            fontSize: "10px",
            color: "#64748b",
            letterSpacing: "1px",
            marginBottom: "6px",
          }}
        >
          RECOMMENDATION
        </div>
        <div style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>
          {data.risk_level === "HIGH"
            ? "⚠ Increase patrol frequency. Deploy additional units to this zone."
            : data.risk_level === "MEDIUM"
              ? "◉ Monitor closely. Regular patrol schedule recommended."
              : "✓ Standard patrol schedule. Low crime activity detected."}
        </div>
      </div>
    </div>
  );
}
