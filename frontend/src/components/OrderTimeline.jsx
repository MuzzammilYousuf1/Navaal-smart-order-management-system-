import { format } from "date-fns";
import { CheckCircle2, Circle } from "lucide-react";

const STATUS_LABELS = {
  pending:          { label: "Order Created",       color: "text-slate-400 border-slate-600" },
  ready_to_ship:    { label: "Ready to Ship",       color: "text-amber-400 border-amber-600" },
  out_for_delivery: { label: "Out for Delivery",    color: "text-blue-400 border-blue-600" },
  delivered:        { label: "Delivered",           color: "text-brand-400 border-brand-600" },
  cancelled:        { label: "Cancelled",           color: "text-red-400 border-red-600" },
};

function TimelineStep({ entry, isLast }) {
  const statusInfo = STATUS_LABELS[entry.new_status] || { label: entry.new_status, color: "text-brand-400 border-brand-600" };

  return (
    <div className="flex gap-4">
      {/* Line + icon */}
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 bg-surface-900 ${statusInfo.color}`}>
          <CheckCircle2 className="w-4 h-4" />
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-surface-700 my-1" />}
      </div>

      {/* Content */}
      <div className={`pb-6 ${isLast ? "" : ""}`}>
        <p className={`text-sm font-semibold ${statusInfo.color.split(" ")[0]}`}>
          {statusInfo.label}
        </p>
        <p className="text-xs text-brand-500 mt-0.5">
          {entry.changed_at
            ? format(new Date(entry.changed_at + (entry.changed_at.endsWith("Z") ? "" : "Z")), "dd MMM yyyy, HH:mm:ss")
            : "—"}
        </p>
        {entry.changed_by && (
          <p className="text-xs text-brand-600 mt-0.5">By: {entry.changed_by}</p>
        )}
        {entry.note && (
          <p className="text-xs text-brand-500 mt-1 italic">{entry.note}</p>
        )}
      </div>
    </div>
  );
}

export default function OrderTimeline({ history = [] }) {
  if (!history.length) {
    return <p className="text-brand-600 text-sm">No timeline events yet.</p>;
  }

  const sorted = [...history].sort(
    (a, b) => new Date(a.changed_at) - new Date(b.changed_at)
  );

  return (
    <div className="space-y-0">
      {sorted.map((entry, i) => (
        <TimelineStep key={entry.id} entry={entry} isLast={i === sorted.length - 1} />
      ))}
    </div>
  );
}
