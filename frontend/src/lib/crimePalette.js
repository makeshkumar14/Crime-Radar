export const CATEGORY_COLORS = {
  "State Security": "#DC2626",
  Violent: "#EF4444",
  "Public Nuisance": "#F43F5E",
  Property: "#F59E0B",
  Burglary: "#F97316",
  Fraud: "#3B82F6",
  "Women Safety": "#EC4899",
  Kidnapping: "#BE123C",
  "Public Order": "#06B6D4",
  NDPS: "#8B5CF6",
  Gambling: "#6366F1",
  "Arms Act": "#7C3AED",
  "Excise Act": "#84CC16",
  "Cow Protection": "#65A30D",
  "SC/ST Act": "#10B981",
  "Mining Act": "#0F766E",
  ITPA: "#A855F7",
  "Goonda Act": "#9333EA",
  Accident: "#FB923C",
};

export function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || "#64748B";
}
