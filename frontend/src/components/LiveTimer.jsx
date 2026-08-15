import { useState, useEffect } from "react";
import { Clock } from "lucide-react";

function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return "--:--";
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  const sign = seconds < 0 ? "-" : "";
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}

export default function LiveTimer({ pickupDeadline, status }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!pickupDeadline || status !== "ready_to_ship") {
      setRemaining(null);
      return;
    }

    const calc = () => {
      const deadline = new Date(pickupDeadline + "Z"); // treat as UTC
      const now = new Date();
      setRemaining((deadline - now) / 1000);
    };

    calc();
    const interval = setInterval(calc, 1000);
    return () => clearInterval(interval);
  }, [pickupDeadline, status]);

  if (remaining === null) return <span className="text-brand-700 text-xs">—</span>;

  const cls =
    remaining > 600 ? "timer-green" :
    remaining > 0   ? "timer-yellow" :
                      "timer-red";

  const label = remaining < 0 ? "LATE" : "Left";

  return (
    <span className={`inline-flex items-center gap-1 ${cls}`}>
      <Clock className="w-3.5 h-3.5" />
      <span>{formatTime(remaining)}</span>
      <span className="text-[10px] opacity-70">{label}</span>
    </span>
  );
}
