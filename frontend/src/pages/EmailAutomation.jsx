import { useEffect, useState } from "react";
import { Mail, Clock, RefreshCw, CheckCircle, AlertTriangle, Settings } from "lucide-react";
import api from "../api/client";

export default function EmailAutomation() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSettings = () => {
    setLoading(true);
    api.get("/api/reports/email-settings")
      .then(({ data }) => setSettings(data))
      .catch((err) => setError(err.response?.data?.detail || "Could not load email settings."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSettings(); }, []);

  const updateSetting = async (item, changes) => {
    const next = { ...item, ...changes };
    setSaving(item.key);
    setMessage("");
    setError("");
    try {
      await api.put("/api/reports/email-settings", {
        key: item.key,
        enabled: next.enabled,
        send_time: next.send_time || undefined,
        recipient_emails: next.recipient_emails || "",
      });
      setSettings((current) => ({
        ...current,
        items: current.items.map((entry) => entry.key === item.key ? next : entry),
      }));
      setMessage("Email settings saved.");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save email settings.");
    } finally {
      setSaving("");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Mail className="w-6 h-6 text-brand-400" /> Email Automation
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">Control which management notifications are sent and when.</p>
        </div>
        <button onClick={loadSettings} className="btn-secondary text-xs" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {message && <div className="card border border-emerald-700/50 bg-emerald-950/30 text-emerald-300 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4" />{message}</div>}
      {error && <div className="card border border-red-700/50 bg-red-950/30 text-red-300 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{error}</div>}

      <div className="card space-y-4">
        <div className="flex items-center gap-2 border-b border-surface-700 pb-3">
          <Settings className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="font-bold text-white">Configured notifications</h2>
            <p className="text-xs text-brand-500">Set recipient email(s) per notification, separated by commas. Leave blank to use the configured owner plus active Admin/Manager emails.</p>
          </div>
        </div>

        {loading ? <p className="text-sm text-brand-500">Loading...</p> : settings?.items?.map((item) => (
          <div key={item.key} className="rounded-xl border border-surface-700 bg-surface-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-white">{item.label}</p>
              <p className="text-xs text-brand-500 mt-1">{item.trigger}</p>
            </div>
            <div className="flex items-center gap-4">
              {item.send_time && (
                <label className="flex items-center gap-2 text-xs text-brand-300">
                  <Clock className="w-4 h-4" />
                  <input type="time" className="input py-1 px-2 w-24 text-xs" value={item.send_time} onChange={(e) => updateSetting(item, { send_time: e.target.value })} />
                </label>
              )}
              <input
                type="text"
                className="input py-1 px-2 w-64 text-xs"
                value={item.recipient_emails || ""}
                placeholder="Recipient email(s), comma separated"
                title="Leave blank to use the configured owner and Admin/Manager emails"
                onChange={(e) => updateSetting(item, { recipient_emails: e.target.value })}
              />
              <label className="flex items-center gap-2 text-xs text-brand-300 cursor-pointer">
                <input type="checkbox" checked={item.enabled} disabled={saving === item.key} onChange={(e) => updateSetting(item, { enabled: e.target.checked })} className="rounded border-emerald-600 text-emerald-600" />
                {item.enabled ? "Enabled" : "Disabled"}
              </label>
            </div>
          </div>
        ))}

        {settings && !settings.smtp_configured && (
          <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-3 text-xs text-amber-300">
            SMTP is not configured on the server. The settings can be saved, but messages will not send until SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL are added to the VPS .env file.
          </div>
        )}
      </div>

      <div className="card border border-surface-700 text-xs text-brand-500 space-y-2">
        <p className="font-semibold text-brand-300">Currently implemented email events</p>
        <p>• Low-stock/backorder alert: sent immediately when an order needs more stock.</p>
        <p>• Inventory-restock alert: sent immediately after stock is received.</p>
        <p>• Daily operations report: sent at the selected Pakistan time (default 10:15 AM) with totals, statuses, per-rider orders/deliveries/returns/amounts, inventory activity, and the detailed order log.</p>
        <p>• SLA delay/escalation alert: optional immediate emails at 45, 60, 75, and 90 minutes.</p>
        <p>Gate-pass notifications remain inside the application because a gate pass is generated on demand.</p>
      </div>
    </div>
  );
}
