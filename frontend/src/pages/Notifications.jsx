import { useEffect, useState } from "react";
import { Bell, AlertTriangle, Info, RefreshCw } from "lucide-react";
import api from "../api/client";
import { format } from "date-fns";

const TYPE_CONFIG = {
  sla_alert_1: { icon: AlertTriangle, cls: "text-amber-400", label: "SLA Alert (45 min)" },
  sla_alert_2: { icon: AlertTriangle, cls: "text-orange-400", label: "SLA Alert (60 min)" },
  sla_manager: { icon: AlertTriangle, cls: "text-red-400",    label: "Manager Escalation" },
  sla_owner:   { icon: AlertTriangle, cls: "text-red-300",    label: "Owner Escalation" },
  info:        { icon: Info,          cls: "text-blue-400",   label: "Info" },
  system:      { icon: Bell,          cls: "text-brand-400",  label: "System" },
};

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/notifications?limit=100");
      setNotifications(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alert Center</h1>
          <p className="text-brand-500 text-sm mt-0.5">SLA breaches and system notifications</p>
        </div>
        <button onClick={fetch} className="btn-secondary">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-brand-500 animate-pulse">Loading alerts...</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="card text-center py-20">
          <Bell className="w-16 h-16 text-brand-800 mx-auto mb-4" />
          <p className="text-brand-500 font-semibold">No alerts yet</p>
          <p className="text-brand-700 text-sm mt-1">SLA alerts will appear here when orders are delayed</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => {
            const cfg = TYPE_CONFIG[n.notification_type] || TYPE_CONFIG.info;
            const Icon = cfg.icon;
            return (
              <div key={n.id} className="card hover:border-surface-600 transition-colors">
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl bg-surface-800 flex items-center justify-center shrink-0 ${cfg.cls}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <span className={`text-xs font-bold uppercase tracking-wider ${cfg.cls}`}>{cfg.label}</span>
                        {n.subject && (
                          <p className="text-sm font-semibold text-white mt-0.5">{n.subject}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-brand-500">
                          {n.sent_at ? format(new Date(n.sent_at + "Z"), "dd MMM, HH:mm:ss") : "—"}
                        </p>
                        <span className={`
                          text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full
                          ${n.delivery_status === "sent" ? "bg-brand-900/40 text-brand-400" : "bg-surface-700 text-brand-600"}
                        `}>
                          {n.delivery_status}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-brand-300 mt-2 leading-relaxed">{n.message}</p>
                    {n.recipient && (
                      <p className="text-xs text-brand-600 mt-1">To: {n.recipient}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
