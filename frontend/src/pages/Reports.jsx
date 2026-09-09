import { useEffect, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { TrendingUp, Package, CheckCircle, AlertTriangle, RefreshCw, Printer, Calendar, ShieldAlert, FileText, Mail, Download, Send, X, CheckCircle2 } from "lucide-react";
import api, { getErrorMessage } from "../api/client";

const COLORS = ["#16a34a", "#f59e0b", "#3b82f6", "#ef4444", "#64748b"];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl p-3 text-xs shadow-xl">
      <p className="text-brand-300 font-semibold mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

export default function Reports() {
  const [overview, setOverview] = useState([]);
  const [byStatus, setByStatus] = useState([]);
  const [bySource, setBySource] = useState([]);
  const [staff, setStaff] = useState([]);
  const [riderPerf, setRiderPerf] = useState([]);
  const [sla, setSla] = useState(null);
  const [days, setDays] = useState(7);
  const [inventoryPerf, setInventoryPerf] = useState([]);
  const [loading, setLoading] = useState(true);

  // Monthly Report State
  const [selectedMonth, setSelectedMonth] = useState("2026-08");
  const [monthlyData, setMonthlyData] = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  // Email Report Modal State
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendSuccessMsg, setSendSuccessMsg] = useState("");
  const [sendErrorMsg, setSendErrorMsg] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [ov, bs, bsrc, st, rp, s, ip] = await Promise.all([
        api.get(`/api/reports/overview?days=${days}`),
        api.get("/api/reports/by-status"),
        api.get("/api/reports/by-source"),
        api.get("/api/reports/staff-performance"),
        api.get("/api/reports/rider-performance"),
        api.get("/api/reports/sla-summary"),
        api.get("/api/reports/inventory-performance"),
      ]);
      setOverview(ov.data);
      setByStatus(bs.data.map((d) => ({ ...d, name: d.status.replace(/_/g, " ") })));
      setBySource(bsrc.data.map((d) => ({ ...d, name: (d.source || "unknown").replace(/_/g, " ").toUpperCase() })));
      setStaff(st.data);
      setRiderPerf(rp.data);
      setSla(s.data);
      setInventoryPerf(ip.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMonthly = async () => {
    setMonthlyLoading(true);
    try {
      const res = await api.get(`/api/reports/monthly-inventory?month=${selectedMonth}`);
      setMonthlyData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setMonthlyLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [days]);
  useEffect(() => { fetchMonthly(); }, [selectedMonth]);

  const handlePrintReport = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    try {
      const todayStr = new Date().toISOString().split("T")[0];
      const res = await api.get(`/api/reports/download-pdf-report?date_str=${todayStr}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Navaal_Operations_Report_${todayStr}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert("Failed to download PDF report: " + getErrorMessage(err));
    }
  };

  const handleSendEmailReport = async (e) => {
    e.preventDefault();
    setIsSendingEmail(true);
    setSendSuccessMsg("");
    setSendErrorMsg("");

    try {
      const todayStr = new Date().toISOString().split("T")[0];
      const payload = {
        recipient_email: emailRecipient.trim() || undefined,
        date_str: todayStr,
        custom_notes: customNotes.trim() || undefined,
        include_pdf: true,
      };
      const res = await api.post("/api/reports/send-email-report", payload);
      setSendSuccessMsg(res.data.message || "Daily PDF report sent successfully!");
      setTimeout(() => {
        setShowEmailModal(false);
        setSendSuccessMsg("");
        setCustomNotes("");
      }, 2500);
    } catch (err) {
      setSendErrorMsg(getErrorMessage(err));
    } finally {
      setIsSendingEmail(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
      {/* Printable CSS Rules */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; font-family: sans-serif; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .card { background: transparent !important; border: 1px solid #ddd !important; box-shadow: none !important; color: black !important; page-break-inside: avoid; }
          .table th { background: #f3f4f6 !important; color: black !important; border: 1px solid #ccc !important; }
          .table td { border: 1px solid #ddd !important; color: black !important; }
          h1, h2, h3, p, span { color: black !important; }
        }
        .print-only { display: none; }
      `}</style>

      {/* Corporate Print Header (Visible only when printing) */}
      <div className="print-only mb-6 border-b-2 border-black pb-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-wide">Navaal Organic Foods</h1>
            <p className="text-sm text-gray-600">Official Monthly Inventory, Receivings & Spoilage Working Audit</p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>Report Period: {selectedMonth}</p>
            <p>Generated: {new Date().toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Screen Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold text-white">Reports & Business Intelligence</h1>
          <p className="text-brand-500 text-sm">Monthly inventory working, spoilages, and sales analytics</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <select className="select w-32 sm:w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button onClick={fetchAll} className="btn-secondary" title="Refresh analytics">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={handleDownloadPDF} className="btn-secondary flex items-center gap-1.5 text-xs sm:text-sm">
            <Download className="w-4 h-4 text-emerald-400" /> PDF Download
          </button>
          <button onClick={() => setShowEmailModal(true)} className="btn-primary flex items-center gap-1.5 text-xs sm:text-sm bg-emerald-700 hover:bg-emerald-600 border-emerald-600">
            <Mail className="w-4 h-4" /> Email PDF Report
          </button>
          <button onClick={handlePrintReport} className="btn-secondary flex items-center gap-1.5 text-xs sm:text-sm">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {/* Email PDF Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs no-print">
          <div className="card w-full max-w-lg space-y-4 border border-emerald-500/40 bg-surface-900 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-surface-800">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold text-white">Send PDF Operations Report</h3>
              </div>
              <button onClick={() => setShowEmailModal(false)} className="text-surface-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {sendSuccessMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{sendSuccessMsg}</span>
              </div>
            )}

            {sendErrorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{sendErrorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSendEmailReport} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-surface-300 block mb-1">
                  Target Recipient Email Address (Leave blank to use default configured email)
                </label>
                <input
                  type="email"
                  placeholder="e.g. director@navaalfood.com"
                  className="input w-full"
                  value={emailRecipient}
                  onChange={(e) => setEmailRecipient(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-surface-300 block mb-1">
                  Executive Remarks / Custom Notes (Optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="Add custom management remarks or audit observations to include in the PDF report..."
                  className="input w-full text-xs"
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                />
              </div>

              <div className="p-3 bg-surface-800/80 rounded-lg border border-surface-700 text-xs text-surface-400 space-y-1">
                <p className="font-semibold text-emerald-400">📄 PDF Report Includes:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Daily Order Volume & Delivered Revenue Metrics</li>
                  <li>SLA Compliance Rate & Pipeline Breakdown</li>
                  <li>Inventory Restocks & Spoilages Summary</li>
                  <li>Detailed Line Item Order Log</li>
                </ul>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="btn-secondary text-xs"
                  disabled={isSendingEmail}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSendingEmail}
                  className="btn-primary flex items-center gap-2 text-xs bg-emerald-600 hover:bg-emerald-500"
                >
                  {isSendingEmail ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Sending PDF Report...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" /> Send PDF Report Now
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {loading ? (
        <div className="flex items-center justify-center py-20 no-print">
          <p className="text-brand-500 animate-pulse">Loading reports & analytics...</p>
        </div>
      ) : (
        <>
          {/* Monthly Inventory & Spoilage Working Section */}
          <div className="card space-y-4 border border-brand-800/40 bg-surface-900">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-surface-800">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-brand-400" />
                <div>
                  <h2 className="text-base font-bold text-white uppercase tracking-wider">
                    Monthly Inventory & Spoilage Audit Record
                  </h2>
                  <p className="text-xs text-brand-500">
                    Detailed record of receivings, sales, spoilages/damaged stock, and current physical inventory
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 no-print">
                <label className="text-xs text-brand-400 font-semibold flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Month:
                </label>
                <select
                  className="select text-xs w-36"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                >
                  <option value="2026-08">August 2026</option>
                  <option value="2026-07">July 2026</option>
                  <option value="2026-06">June 2026</option>
                </select>
              </div>
            </div>

            {monthlyLoading || !monthlyData ? (
              <p className="text-xs text-brand-500 py-4 animate-pulse">Loading monthly audit data...</p>
            ) : (
              <>
                {/* Monthly Summary Metric Boxes */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-surface-850 p-3 rounded-xl border border-surface-800 text-center">
                    <p className="text-xs text-brand-500 uppercase tracking-wider font-semibold">Bulk Received</p>
                    <p className="text-2xl font-bold text-emerald-400 mt-1">
                      {monthlyData.total_received_units.toLocaleString()} <span className="text-xs text-brand-400 font-normal">units</span>
                    </p>
                  </div>
                  <div className="bg-surface-850 p-3 rounded-xl border border-surface-800 text-center">
                    <p className="text-xs text-brand-500 uppercase tracking-wider font-semibold">Bulk Sold</p>
                    <p className="text-2xl font-bold text-brand-300 mt-1">
                      {monthlyData.total_sold_units.toLocaleString()} <span className="text-xs text-brand-400 font-normal">units</span>
                    </p>
                  </div>
                  <div className="bg-surface-850 p-3 rounded-xl border border-red-900/30 text-center">
                    <p className="text-xs text-red-400 uppercase tracking-wider font-semibold">Spoilage Loss</p>
                    <p className="text-2xl font-bold text-red-400 mt-1">
                      PKR {monthlyData.total_spoilage_cost.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-surface-850 p-3 rounded-xl border border-surface-800 text-center">
                    <p className="text-xs text-brand-500 uppercase tracking-wider font-semibold">Ending Stock Value</p>
                    <p className="text-2xl font-bold text-white mt-1">
                      PKR {monthlyData.total_inventory_value.toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Monthly Itemized Audit Table */}
                <div className="table-wrap mt-4">
                  <table className="table">
                    <thead className="thead">
                      <tr>
                        <th className="th">Product Catalog Item</th>
                        <th className="th">Item Type</th>
                        <th className="th">Received / Restocked</th>
                        <th className="th">Units Sold</th>
                        <th className="th">Spoilage / Damaged</th>
                        <th className="th">Spoilage Cost</th>
                        <th className="th">Current Available Stock</th>
                        <th className="th">Inventory Valuation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyData.items.map((it) => (
                        <tr key={it.product_id} className="tr-hover">
                          <td className="td font-medium text-white">
                            <p>{it.name}</p>
                            <p className="text-[11px] font-mono text-brand-500">{it.sku}</p>
                          </td>
                          <td className="td">
                            {it.is_subitem ? (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-brand-950/60 text-brand-350 border border-brand-850">
                                Retail Pack ({it.multiplier} {it.unit}s)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-900/40">
                                Bulk Base Stock
                              </span>
                            )}
                          </td>
                          <td className="td text-emerald-400 font-semibold">
                            {it.received_qty > 0 ? `+${it.received_qty} ${it.unit}s` : "—"}
                          </td>
                          <td className="td text-brand-300 font-medium">
                            {it.sold_qty > 0 ? `${it.sold_qty} ${it.unit}s` : "—"}
                          </td>
                          <td className="td">
                            {it.spoiled_qty > 0 ? (
                              <span className="text-red-400 font-bold">
                                -{it.spoiled_qty} {it.unit}s
                              </span>
                            ) : (
                              <span className="text-brand-600">—</span>
                            )}
                          </td>
                          <td className="td">
                            {it.spoilage_cost > 0 ? (
                              <span className="text-red-400 font-semibold">
                                PKR {it.spoilage_cost.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-brand-600">—</span>
                            )}
                          </td>
                          <td className="td font-bold text-white">
                            {it.current_stock} {it.unit}s
                          </td>
                          <td className="td font-semibold text-brand-300">
                            {!it.is_subitem ? `PKR ${it.inventory_value.toLocaleString()}` : <span className="text-brand-600 text-xs">(Derived)</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Printable Signature Line for Official Audits */}
          <div className="print-only mt-12 pt-8 border-t border-gray-400">
            <div className="grid grid-cols-2 gap-12 text-sm text-gray-700">
              <div>
                <p className="font-bold">Prepared By (Warehouse Manager):</p>
                <div className="h-12 border-b border-gray-400 mt-2"></div>
                <p className="text-xs mt-1">Signature & Date</p>
              </div>
              <div>
                <p className="font-bold">Approved By (Business Owner):</p>
                <div className="h-12 border-b border-gray-400 mt-2"></div>
                <p className="text-xs mt-1">Signature & Date</p>
              </div>
            </div>
          </div>

          {/* SLA Summary */}
          {sla && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 no-print">
              <div className="card text-center">
                <p className="text-3xl font-bold text-white">{sla.total_rts_orders}</p>
                <p className="text-xs text-brand-500 mt-1 uppercase tracking-wider">Total RTS Orders</p>
              </div>
              <div className="card text-center">
                <p className="text-3xl font-bold text-brand-400">{sla.on_time}</p>
                <p className="text-xs text-brand-500 mt-1 uppercase tracking-wider">On Time</p>
              </div>
              <div className="card text-center">
                <p className="text-3xl font-bold text-red-400">{sla.breached}</p>
                <p className="text-xs text-brand-500 mt-1 uppercase tracking-wider">SLA Breached</p>
              </div>
              <div className="card text-center">
                <p className={`text-3xl font-bold ${sla.breach_percentage > 20 ? "text-red-400" : "text-amber-400"}`}>
                  {sla.breach_percentage}%
                </p>
                <p className="text-xs text-brand-500 mt-1 uppercase tracking-wider">Breach Rate</p>
              </div>
            </div>
          )}

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 no-print">
            {/* Overview Chart */}
            <div className="card">
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-5">
                Daily Order Volume — Last {days} Days
              </h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={overview} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#132e17" />
                  <XAxis dataKey="date" tick={{ fill: "#4ade80", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#4ade80", fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: "#86efac", fontSize: 12 }} />
                  <Bar dataKey="orders" name="Orders" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="delivered" name="Delivered" fill="#4ade80" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="late" name="Late" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Revenue Line */}
            <div className="card">
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-5">Revenue Trend</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={overview}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#132e17" />
                  <XAxis dataKey="date" tick={{ fill: "#4ade80", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#4ade80", fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="revenue" name="Revenue (PKR)" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Pie Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 no-print">
            <div className="card">
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-5">Orders by Status</h2>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={byStatus} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`} labelLine={{ stroke: "#4ade80" }}>
                    {byStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-5">Orders by Source</h2>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={bySource} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`} labelLine={{ stroke: "#4ade80" }}>
                    {bySource.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detailed Order Source & Rider Tracking Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 no-print">
            {/* Orders by Source Table */}
            <div className="card">
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-4">
                Orders Received by Source Channel
              </h2>
              <div className="table-wrap">
                <table className="table">
                  <thead className="thead">
                    <tr>
                      <th className="th">Source Channel</th>
                      <th className="th">Total Orders</th>
                      <th className="th">Delivered</th>
                      <th className="th">Share (%)</th>
                      <th className="th">Channel Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySource.map((s) => (
                      <tr key={s.source} className="tr-hover">
                        <td className="td font-medium text-white uppercase">{s.source}</td>
                        <td className="td text-brand-300 font-bold">{s.count}</td>
                        <td className="td text-emerald-400">{s.delivered_count || s.count}</td>
                        <td className="td text-brand-400 font-semibold">{s.percentage ? `${s.percentage}%` : "—"}</td>
                        <td className="td font-semibold text-brand-300">
                          PKR {(s.total_revenue || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Per-Order Rider Dispatch & Cash Collection Table */}
            <div className="card">
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-4">
                Per-Order Rider Dispatch & Cash Collection
              </h2>
              <div className="table-wrap">
                <table className="table">
                  <thead className="thead">
                    <tr>
                      <th className="th">Rider Name</th>
                      <th className="th">Assigned Orders</th>
                      <th className="th">Out for Delivery</th>
                      <th className="th">Delivered</th>
                      <th className="th">COD Cash Collected</th>
                      <th className="th">Success %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riderPerf.length === 0 ? (
                      <tr><td colSpan={6} className="td text-center text-brand-600">No rider activity recorded yet</td></tr>
                    ) : (
                      riderPerf.map((r) => (
                        <tr key={r.rider_name} className="tr-hover">
                          <td className="td font-bold text-white">{r.rider_name}</td>
                          <td className="td text-brand-300">{r.total_orders}</td>
                          <td className="td text-amber-400">{r.out_for_delivery_orders}</td>
                          <td className="td text-emerald-400 font-bold">{r.delivered_orders}</td>
                          <td className="td font-bold text-emerald-300">
                            PKR {r.total_cod_collected.toLocaleString()}
                          </td>
                          <td className="td">
                            <span className={`font-bold ${r.success_rate >= 80 ? "text-emerald-400" : "text-amber-400"}`}>
                              {r.success_rate}%
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Staff Performance */}
          <div className="card no-print">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-4">Staff Operations Performance</h2>
            <div className="table-wrap">
              <table className="table">
                <thead className="thead">
                  <tr>
                    <th className="th">Name</th>
                    <th className="th">Role</th>
                    <th className="th">Total Orders</th>
                    <th className="th">Delivered</th>
                    <th className="th">Late Orders</th>
                    <th className="th">Success Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.name} className="tr-hover">
                      <td className="td font-medium text-white">{s.name}</td>
                      <td className="td text-brand-500 capitalize">{s.role}</td>
                      <td className="td text-brand-300">{s.total_orders}</td>
                      <td className="td text-brand-400">{s.delivered}</td>
                      <td className="td text-red-400">{s.late_orders}</td>
                      <td className="td">
                        <span className={`font-semibold ${s.total_orders > 0 && (s.delivered / s.total_orders) >= 0.8 ? "text-brand-400" : "text-amber-400"}`}>
                          {s.total_orders > 0 ? `${Math.round((s.delivered / s.total_orders) * 100)}%` : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
