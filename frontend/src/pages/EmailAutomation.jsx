import { useEffect, useState } from "react";
import { Mail, Clock, RefreshCw, CheckCircle, AlertTriangle, Settings, Send, Save } from "lucide-react";
import api from "../api/client";

export default function EmailAutomation() {
  const [settings, setSettings] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSettings = () => {
    setLoading(true);
    setMessage("");
    setError("");
    api.get("/api/reports/email-settings")
      .then(({ data }) => {
        setSettings(data);
        setItems(data.items || []);
      })
      .catch((err) => setError(err.response?.data?.detail || "Could not load email settings."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSettings(); }, []);

  const handleFieldChange = (key, field, value) => {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    );
  };

  const saveSetting = async (item) => {
    setSavingKey(item.key);
    setMessage("");
    setError("");

    // Validate email strings if present
    if (item.recipient_emails && item.recipient_emails.trim()) {
      const parts = item.recipient_emails.split(",").map((s) => s.strip ? s.strip() : s.trim());
      for (const email of parts) {
        if (!email.includes("@") || email.includes(" ")) {
          setError(`Invalid recipient email address: "${email}". Format should be user@domain.com`);
          setSavingKey("");
          return;
        }
      }
    }

    try {
      await api.put("/api/reports/email-settings", {
        key: item.key,
        enabled: Boolean(item.enabled),
        send_time: item.send_time || undefined,
        recipient_emails: item.recipient_emails || "",
      });
      setMessage(`Saved settings for ${item.label}`);
      // Refresh settings from server to get updated dynamic trigger labels
      const { data } = await api.get("/api/reports/email-settings");
      setSettings(data);
      setItems(data.items || []);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save email settings.");
    } finally {
      setSavingKey("");
    }
  };

  const sendTestReport = async () => {
    setSendingTest(true);
    setMessage("");
    setError("");
    try {
      const { data } = await api.post("/api/reports/send-email-report");
      setMessage(data.message || "Test daily report email successfully sent!");
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to send test report email. Verify server SMTP credentials.");
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Mail className="w-6 h-6 text-brand-400" /> Email Automation & Daily Reports
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">Automated background report schedules & instant management notifications.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={sendTestReport} className="btn-emerald text-xs flex items-center gap-1.5" disabled={sendingTest}>
            <Send className={`w-3.5 h-3.5 ${sendingTest ? "animate-spin" : ""}`} /> {sendingTest ? "Sending Test..." : "Send Test Report Now"}
          </button>
          <button onClick={loadSettings} className="btn-secondary text-xs flex items-center gap-1.5" disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {message && <div className="card border border-emerald-700/50 bg-emerald-950/30 text-emerald-300 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4 shrink-0" />{message}</div>}
      {error && <div className="card border border-red-700/50 bg-red-950/30 text-red-300 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}

      <div className="card space-y-4">
        <div className="flex items-center justify-between border-b border-surface-700 pb-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="font-bold text-white">Configured Automated Notifications</h2>
              <p className="text-xs text-brand-500">The daily report is sent automatically by the background server at the configured Pakistan time. No manual sending needed daily.</p>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-brand-500 py-4">Loading email settings...</p>
        ) : (
          items.map((item) => (
            <div key={item.key} className="rounded-xl border border-surface-700 bg-surface-800 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <p className="font-semibold text-white">{item.label}</p>
                <p className="text-xs text-emerald-400 font-mono mt-0.5">{item.trigger}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {item.send_time !== undefined && item.send_time !== null && (
                  <label className="flex items-center gap-1.5 text-xs text-brand-300 bg-surface-900 border border-surface-700 rounded-lg px-2.5 py-1.5">
                    <Clock className="w-3.5 h-3.5 text-brand-400" />
                    <span className="text-[11px] text-brand-500 font-medium">Schedule:</span>
                    <input
                      type="time"
                      className="bg-transparent border-none text-xs font-mono text-emerald-300 focus:outline-none"
                      value={item.send_time}
                      onChange={(e) => handleFieldChange(item.key, "send_time", e.target.value)}
                    />
                  </label>
                )}
                <input
                  type="text"
                  className="input py-1.5 px-3 w-full sm:w-64 text-xs"
                  value={item.recipient_emails || ""}
                  placeholder="Recipient email(s), comma separated"
                  title="Leave blank to use default Admin/Manager recipient emails"
                  onChange={(e) => handleFieldChange(item.key, "recipient_emails", e.target.value)}
                />
                <label className="flex items-center gap-2 text-xs text-brand-300 cursor-pointer bg-surface-900 border border-surface-700 rounded-lg px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={Boolean(item.enabled)}
                    onChange={(e) => handleFieldChange(item.key, "enabled", e.target.checked)}
                    className="rounded border-emerald-600 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>{item.enabled ? "Enabled" : "Disabled"}</span>
                </label>
                <button
                  onClick={() => saveSetting(item)}
                  className="btn-emerald text-xs py-1.5 px-3 flex items-center gap-1"
                  disabled={savingKey === item.key}
                >
                  <Save className={`w-3.5 h-3.5 ${savingKey === item.key ? "animate-spin" : ""}`} />
                  {savingKey === item.key ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ))
        )}

        {settings && !settings.smtp_configured && (
          <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-3.5 text-xs text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold text-amber-200">SMTP Server Credentials Required</p>
              <p className="mt-0.5 text-amber-300/90">
                To enable automatic email delivery, ensure <code className="bg-amber-900/40 px-1 py-0.5 rounded text-amber-200">SMTP_HOST</code>, <code className="bg-amber-900/40 px-1 py-0.5 rounded text-amber-200">SMTP_USERNAME</code>, <code className="bg-amber-900/40 px-1 py-0.5 rounded text-amber-200">SMTP_PASSWORD</code>, and <code className="bg-amber-900/40 px-1 py-0.5 rounded text-amber-200">SMTP_FROM_EMAIL</code> are configured in your server environment file.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card border border-surface-700 text-xs text-brand-500 space-y-2">
        <p className="font-semibold text-brand-300">Automated Background Email System Overview</p>
        <p>• <strong>Daily Operations Report:</strong> Runs automatically on the server every day at the scheduled Pakistan time (e.g. 10:15 AM or 8:00 PM). Contains key financial totals, status counts, rider metrics, stock changes, and attaches a corporate PDF report.</p>
        <p>• <strong>Low Stock & Backorder Alerts:</strong> Triggered instantly when inventory is low or an order cannot be fulfilled.</p>
        <p>• <strong>Inventory Received Alerts:</strong> Sent immediately whenever restock quantities are entered.</p>
        <p>• <strong>SLA Escalation Alerts:</strong> Sent at 45, 60, 75, and 90 minute delays if an order exceeds SLA bounds.</p>
      </div>
    </div>
  );
}
