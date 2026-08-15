import { useEffect, useState } from "react";
import { X, AlertTriangle, Info, CheckCircle } from "lucide-react";

const ICON_MAP = {
  sla_alert_1: { icon: AlertTriangle, cls: "text-amber-400 bg-amber-900/40 border-amber-700/50" },
  sla_alert_2: { icon: AlertTriangle, cls: "text-red-400 bg-red-900/40 border-red-700/50" },
  sla_manager: { icon: AlertTriangle, cls: "text-red-400 bg-red-900/50 border-red-600/60" },
  sla_owner:   { icon: AlertTriangle, cls: "text-red-300 bg-red-900/60 border-red-500/70" },
  info:        { icon: Info,          cls: "text-blue-400 bg-blue-900/30 border-blue-700/40" },
  success:     { icon: CheckCircle,   cls: "text-brand-400 bg-brand-900/30 border-brand-700/40" },
};

export default function NotificationToast({ notifications, onDismiss }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {notifications.map((n) => {
        const kind = ICON_MAP[n.type] || ICON_MAP.info;
        const Icon = kind.icon;
        return (
          <div
            key={n.id}
            className={`
              flex items-start gap-3 p-4 rounded-xl border shadow-2xl
              animate-slide-up backdrop-blur-sm ${kind.cls}
            `}
          >
            <Icon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">{n.order_number}</p>
              <p className="text-xs mt-0.5 text-current opacity-80 line-clamp-2">{n.message}</p>
            </div>
            <button
              onClick={() => onDismiss(n.id)}
              className="text-current opacity-60 hover:opacity-100 transition-opacity shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
