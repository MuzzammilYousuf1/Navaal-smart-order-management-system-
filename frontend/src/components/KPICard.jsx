import { TrendingUp, TrendingDown } from "lucide-react";

export default function KPICard({ label, value, icon: Icon, color = "green", sub, trend }) {
  const colorMap = {
    green:  "text-brand-400 bg-brand-900/30",
    amber:  "text-amber-400 bg-amber-900/30",
    blue:   "text-blue-400 bg-blue-900/30",
    red:    "text-red-400 bg-red-900/30",
    slate:  "text-slate-400 bg-slate-800/50",
    purple: "text-purple-400 bg-purple-900/30",
  };
  const iconCls = colorMap[color] || colorMap.green;

  return (
    <div className="kpi-card animate-slide-up">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconCls}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && (
          <span className={`flex items-center gap-0.5 text-xs font-semibold ${trend >= 0 ? "text-brand-400" : "text-red-400"}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div>
        <p className="kpi-value">{value ?? "—"}</p>
        <p className="kpi-label">{label}</p>
        {sub && <p className="text-xs text-brand-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
