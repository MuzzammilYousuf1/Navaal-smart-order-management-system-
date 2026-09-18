import { useEffect, useState } from "react";
import {
  Boxes, AlertTriangle, Plus, RefreshCw, Download, Calendar, Filter,
  Search, ShieldAlert, DollarSign, Edit3, Trash2, CheckCircle, PackageX,
  ArrowUpRight, ArrowDownRight, Layers, FileSpreadsheet
} from "lucide-react";
import api from "../api/client";
import useAuth from "../store/useAuth";

export default function DailyInventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [logs, setLogs] = useState([]);
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [dateRangeOption, setDateRangeOption] = useState("this_month"); // "today" | "yesterday" | "last_7" | "this_month" | "all" | "custom"
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Modals
  const [showLogModal, setShowLogModal] = useState(false);
  const [editingLog, setEditingLog] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    log_date: new Date().toISOString().split("T")[0],
    product_id: "",
    product_name: "",
    category_name: "General",
    added_qty: 0,
    unit_cost: 0,
    total_cost: "",
    spoiled_qty: 0,
    broken_qty: 0,
    notes: "",
  });

  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState("success");

  const showStatus = (msg, type = "success") => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(""), 6000);
  };

  // Helper to compute date range strings
  const getComputedDates = () => {
    const today = new Date();
    const fmt = (d) => d.toISOString().split("T")[0];

    if (dateRangeOption === "today") {
      return { start: fmt(today), end: fmt(today) };
    }
    if (dateRangeOption === "yesterday") {
      const yest = new Date(today);
      yest.setDate(yest.getDate() - 1);
      return { start: fmt(yest), end: fmt(yest) };
    }
    if (dateRangeOption === "last_7") {
      const d7 = new Date(today);
      d7.setDate(d7.getDate() - 7);
      return { start: fmt(d7), end: fmt(today) };
    }
    if (dateRangeOption === "this_month") {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: fmt(firstDay), end: fmt(today) };
    }
    if (dateRangeOption === "custom") {
      return { start: startDate, end: endDate };
    }
    return { start: "", end: "" };
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const { start, end } = getComputedDates();
      const params = {};
      if (start) params.start_date = start;
      if (end) params.end_date = end;
      if (filterCategory) params.category = filterCategory;

      const [logsRes, summaryRes, prodsRes] = await Promise.all([
        api.get("/api/daily-inventory", { params }),
        api.get("/api/daily-inventory/summary", { params: { start_date: start || undefined, end_date: end || undefined } }),
        api.get("/api/inventory/products"),
      ]);

      setLogs(logsRes.data);
      setSummary(summaryRes.data);
      setProducts(prodsRes.data);
    } catch (err) {
      console.error("Failed to load daily inventory logs", err);
      showStatus(err.response?.data?.detail || "Error loading daily inventory", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [dateRangeOption, startDate, endDate, filterCategory]);

  const handleProductSelect = (e) => {
    const pId = e.target.value;
    if (!pId) {
      setFormData((prev) => ({ ...prev, product_id: "", product_name: "", category_name: "General" }));
      return;
    }
    const found = products.find((p) => String(p.id) === String(pId));
    if (found) {
      setFormData((prev) => ({
        ...prev,
        product_id: found.id,
        product_name: found.name,
        category_name: found.category || "General",
        unit_cost: prev.unit_cost || found.unit_price || 0,
      }));
    }
  };

  const openNewLogModal = () => {
    setEditingLog(null);
    const defaultProd = products.find((p) => !p.base_product_id) || products[0];
    setFormData({
      log_date: new Date().toISOString().split("T")[0],
      product_id: defaultProd ? defaultProd.id : "",
      product_name: defaultProd ? defaultProd.name : "",
      category_name: defaultProd ? defaultProd.category || "General" : "General",
      added_qty: 0,
      unit_cost: defaultProd ? defaultProd.unit_price || 0 : 0,
      total_cost: "",
      spoiled_qty: 0,
      broken_qty: 0,
      notes: "",
    });
    setShowLogModal(true);
  };

  const openEditLogModal = (log) => {
    setEditingLog(log);
    setFormData({
      log_date: log.log_date ? log.log_date.split("T")[0] : new Date().toISOString().split("T")[0],
      product_id: log.product_id || "",
      product_name: log.product_name || "",
      category_name: log.category_name || "General",
      added_qty: log.added_qty || 0,
      unit_cost: log.unit_cost || 0,
      total_cost: log.total_cost || 0,
      spoiled_qty: log.spoiled_qty || 0,
      broken_qty: log.broken_qty || 0,
      notes: log.notes || "",
    });
    setShowLogModal(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        log_date: new Date(formData.log_date).toISOString(),
        product_id: formData.product_id ? Number(formData.product_id) : null,
        product_name: formData.product_name,
        category_name: formData.category_name,
        added_qty: Number(formData.added_qty) || 0,
        unit_cost: Number(formData.unit_cost) || 0,
        total_cost: formData.total_cost !== "" ? Number(formData.total_cost) : undefined,
        spoiled_qty: Number(formData.spoiled_qty) || 0,
        broken_qty: Number(formData.broken_qty) || 0,
        notes: formData.notes,
      };

      if (editingLog) {
        await api.put(`/api/daily-inventory/${editingLog.id}`, payload);
        showStatus("Daily inventory log updated successfully!", "success");
      } else {
        await api.post("/api/daily-inventory", payload);
        showStatus("New daily inventory log saved successfully!", "success");
      }

      setShowLogModal(false);
      fetchData();
    } catch (err) {
      showStatus(err.response?.data?.detail || "Failed to save daily log", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteLog = async (logId) => {
    if (!window.confirm("Are you sure you want to delete this daily inventory entry? This will revert any associated stock changes.")) {
      return;
    }
    try {
      await api.delete(`/api/daily-inventory/${logId}`);
      showStatus("Daily log deleted and stock reverted.", "success");
      fetchData();
    } catch (err) {
      showStatus(err.response?.data?.detail || "Failed to delete log", "error");
    }
  };

  const handleExportCSV = async () => {
    try {
      const { start, end } = getComputedDates();
      const params = {};
      if (start) params.start_date = start;
      if (end) params.end_date = end;
      if (filterCategory) params.category = filterCategory;

      const response = await api.get("/api/daily-inventory/export", {
        params,
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `daily_inventory_report_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert("Failed to download CSV report.");
    }
  };

  // Filtered logs list for client-side search
  const filteredLogs = logs.filter((l) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (l.product_name && l.product_name.toLowerCase().includes(term)) ||
      (l.category_name && l.category_name.toLowerCase().includes(term)) ||
      (l.notes && l.notes.toLowerCase().includes(term)) ||
      (l.created_by && l.created_by.toLowerCase().includes(term))
    );
  });

  if (!isAdmin) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Admin Access Required</h2>
        <p className="text-surface-400 max-w-md">
          The Daily Inventory Log & Stock Report page is restricted exclusively to system administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Daily Inventory & Stock Log</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/20 text-brand-300 border border-brand-500/30">
              Admin Exclusive
            </span>
          </div>
          <p className="text-sm text-surface-400 mt-1">
            Track daily stock additions, purchase pricing, spoilage & breakage reports across all egg categories.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="p-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-300 hover:text-white hover:bg-surface-700 transition"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-200 hover:text-white hover:bg-surface-700 font-medium text-sm transition"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={openNewLogModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm shadow-lg shadow-brand-900/40 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Log Daily Entry</span>
          </button>
        </div>
      </div>

      {/* Status Alert */}
      {statusMsg && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between ${
            statusType === "success"
              ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
              : "bg-red-950/40 border-red-500/30 text-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {statusType === "success" ? <CheckCircle className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
            <span>{statusMsg}</span>
          </div>
          <button onClick={() => setStatusMsg("")} className="text-xs font-semibold opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Stock in Hand */}
        <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Working Stock</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Boxes className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-white">
            {summary ? summary.total_stock_in_hand.toLocaleString() : 0}
          </div>
          <p className="text-xs text-surface-400">Total Eggs in Warehouse</p>
        </div>

        {/* Total Added Stock */}
        <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Stock Added</span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4 text-blue-400" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-white">
            {summary ? summary.total_added.toLocaleString() : 0}
          </div>
          <p className="text-xs text-surface-400">Purchased in period</p>
        </div>

        {/* Total Purchase Investment */}
        <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Purchase Cost</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-amber-400" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-amber-300">
            PKR {summary ? summary.total_purchase_cost.toLocaleString() : 0}
          </div>
          <p className="text-xs text-surface-400">Total purchase value</p>
        </div>

        {/* Total Spoiled Eggs */}
        <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Spoiled Stock</span>
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-red-400">
            {summary ? summary.total_spoiled.toLocaleString() : 0}
          </div>
          <p className="text-xs text-surface-400">Expired / Bad eggs</p>
        </div>

        {/* Total Broken Eggs */}
        <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Broken / Damaged</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <PackageX className="w-4 h-4 text-purple-400" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-purple-300">
            {summary ? summary.total_broken.toLocaleString() : 0}
          </div>
          <p className="text-xs text-surface-400">Damaged in transit/handling</p>
        </div>
      </div>

      {/* Category Summary Cards Grid */}
      {summary?.categories && summary.categories.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-surface-300 flex items-center gap-2">
            <Layers className="w-4 h-4 text-brand-400" />
            <span>Category Breakdown Overview</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {summary.categories.map((cat) => (
              <div
                key={cat.category_name}
                className="p-4 rounded-xl bg-surface-900/80 border border-surface-700/60 flex flex-col justify-between space-y-3"
              >
                <div className="flex items-center justify-between border-b border-surface-800 pb-2">
                  <span className="font-bold text-white text-sm">{cat.category_name}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-surface-800 text-brand-300">
                    {cat.total_stock_in_hand.toLocaleString()} in hand
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-surface-400 block">Added:</span>
                    <span className="font-semibold text-blue-400">+{cat.total_added.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-surface-400 block">Cost:</span>
                    <span className="font-semibold text-amber-300">PKR {cat.total_purchase_cost.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-surface-400 block">Spoiled:</span>
                    <span className="font-semibold text-red-400">{cat.total_spoiled.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-surface-400 block">Broken:</span>
                    <span className="font-semibold text-purple-400">{cat.total_broken.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls & Filters Bar */}
      <div className="p-4 rounded-2xl bg-surface-900 border border-surface-700/80 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        {/* Left: Date Presets & Custom */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-surface-400 flex items-center gap-1.5 mr-1">
            <Calendar className="w-3.5 h-3.5 text-brand-400" />
            Period:
          </span>

          {[
            { id: "today", label: "Today" },
            { id: "yesterday", label: "Yesterday" },
            { id: "last_7", label: "Last 7 Days" },
            { id: "this_month", label: "This Month" },
            { id: "all", label: "All Time" },
            { id: "custom", label: "Custom" },
          ].map((preset) => (
            <button
              key={preset.id}
              onClick={() => setDateRangeOption(preset.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                dateRangeOption === preset.id
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-white"
              }`}
            >
              {preset.label}
            </button>
          ))}

          {dateRangeOption === "custom" && (
            <div className="flex items-center gap-2 ml-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-surface-800 border border-surface-700 text-white text-xs rounded-lg px-2.5 py-1.5 focus:border-brand-500 outline-none"
              />
              <span className="text-surface-500 text-xs">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-surface-800 border border-surface-700 text-white text-xs rounded-lg px-2.5 py-1.5 focus:border-brand-500 outline-none"
              />
            </div>
          )}
        </div>

        {/* Right: Search & Category Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-surface-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search item, category or note..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-surface-800 border border-surface-700 text-white placeholder-surface-500 text-xs focus:border-brand-500 outline-none"
            />
          </div>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-surface-800 border border-surface-700 text-white text-xs rounded-xl px-3 py-1.5 focus:border-brand-500 outline-none"
          >
            <option value="">All Categories</option>
            {summary?.categories?.map((cat) => (
              <option key={cat.category_name} value={cat.category_name}>
                {cat.category_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Daily Logs Table */}
      <div className="rounded-2xl bg-surface-900 border border-surface-700/80 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-surface-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-white text-sm">Daily Stock Logs</h3>
            <span className="text-xs text-surface-400">({filteredLogs.length} entries)</span>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-surface-400 space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-400" />
            <p className="text-sm">Loading daily inventory records...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-surface-400 space-y-2">
            <Boxes className="w-10 h-10 mx-auto opacity-30" />
            <p className="text-base font-semibold text-surface-300">No daily inventory logs found</p>
            <p className="text-xs">Click "Log Daily Entry" to record inventory additions, purchase prices, or spoilage.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-800/60 border-b border-surface-700/80 text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Item / Product</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Added Stock</th>
                  <th className="py-3 px-4 text-right">Purchase Unit Cost</th>
                  <th className="py-3 px-4 text-right">Total Purchase Cost</th>
                  <th className="py-3 px-4 text-right">Spoiled</th>
                  <th className="py-3 px-4 text-right">Broken</th>
                  <th className="py-3 px-4 text-right">Net Change</th>
                  <th className="py-3 px-4">Logged By / Notes</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-surface-800/80 text-xs">
                {filteredLogs.map((log) => {
                  const netChange = log.added_qty - log.spoiled_qty - log.broken_qty;
                  const dateStr = log.log_date ? new Date(log.log_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-";

                  return (
                    <tr key={log.id} className="hover:bg-surface-800/40 transition">
                      <td className="py-3.5 px-4 font-semibold text-white whitespace-nowrap">{dateStr}</td>
                      <td className="py-3.5 px-4 font-medium text-surface-200">
                        <div className="font-semibold text-white">{log.product_name}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-800 text-surface-300 border border-surface-700">
                          {log.category_name}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right font-bold text-blue-400">
                        {log.added_qty > 0 ? `+${log.added_qty.toLocaleString()}` : "0"}
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono text-surface-300">
                        {log.unit_cost > 0 ? `PKR ${log.unit_cost.toLocaleString()}` : "-"}
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-300">
                        {log.total_cost > 0 ? `PKR ${log.total_cost.toLocaleString()}` : "-"}
                      </td>

                      <td className="py-3.5 px-4 text-right font-bold text-red-400">
                        {log.spoiled_qty > 0 ? `-${log.spoiled_qty.toLocaleString()}` : "0"}
                      </td>

                      <td className="py-3.5 px-4 text-right font-bold text-purple-400">
                        {log.broken_qty > 0 ? `-${log.broken_qty.toLocaleString()}` : "0"}
                      </td>

                      <td className="py-3.5 px-4 text-right font-bold">
                        <span className={netChange > 0 ? "text-emerald-400" : netChange < 0 ? "text-red-400" : "text-surface-400"}>
                          {netChange > 0 ? `+${netChange}` : netChange}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 max-w-[220px] truncate text-surface-400" title={log.notes || undefined}>
                        {log.created_by && <span className="font-semibold text-surface-300 mr-1">[{log.created_by}]</span>}
                        <span>{log.notes || "—"}</span>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditLogModal(log)}
                            className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800 transition"
                            title="Edit Log"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteLog(log.id)}
                            className="p-1.5 rounded-lg text-surface-400 hover:text-red-400 hover:bg-red-950/30 transition"
                            title="Delete Log"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Log Daily Entry Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-0 my-8">
            <div className="p-5 border-b border-surface-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-brand-400" />
                <h3 className="text-lg font-bold text-white">
                  {editingLog ? "Edit Daily Inventory Log" : "Log Daily Inventory Entry"}
                </h3>
              </div>
              <button
                onClick={() => setShowLogModal(false)}
                className="text-surface-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 space-y-4 text-xs">
              {/* Date & Product Select */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-surface-300 font-semibold mb-1">Entry Date</label>
                  <input
                    type="date"
                    required
                    value={formData.log_date}
                    onChange={(e) => setFormData({ ...formData, log_date: e.target.value })}
                    className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-surface-300 font-semibold mb-1">Select Main Product / Item</label>
                  <select
                    value={formData.product_id}
                    onChange={handleProductSelect}
                    className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  >
                    <option value="">-- Select Product --</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.category || "General"})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Product Name & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-surface-300 font-semibold mb-1">Item / Product Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Organic Eggs (300g)"
                    value={formData.product_name}
                    onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                    className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-surface-300 font-semibold mb-1">Category</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Farm, Desi, Organic"
                    value={formData.category_name}
                    onChange={(e) => setFormData({ ...formData, category_name: e.target.value })}
                    className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>
              </div>

              {/* Added Qty & Purchase Unit Price */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 rounded-xl bg-surface-800/50 border border-surface-700/60">
                <div>
                  <label className="block text-blue-400 font-bold mb-1">Added / Purchased Qty</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={formData.added_qty}
                    onChange={(e) => {
                      const qty = Number(e.target.value);
                      const cost = Number(formData.unit_cost) || 0;
                      setFormData({
                        ...formData,
                        added_qty: qty,
                        total_cost: qty * cost,
                      });
                    }}
                    className="w-full bg-surface-800 border border-surface-700 text-white font-bold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-amber-400 font-bold mb-1">Purchase Price per Unit (PKR)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={formData.unit_cost}
                    onChange={(e) => {
                      const cost = Number(e.target.value);
                      const qty = Number(formData.added_qty) || 0;
                      setFormData({
                        ...formData,
                        unit_cost: cost,
                        total_cost: qty * cost,
                      });
                    }}
                    className="w-full bg-surface-800 border border-surface-700 text-white font-bold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>
              </div>

              {/* Spoiled Qty & Broken Qty */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 rounded-xl bg-surface-800/50 border border-surface-700/60">
                <div>
                  <label className="block text-red-400 font-bold mb-1">Spoiled / Expired Qty</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={formData.spoiled_qty}
                    onChange={(e) => setFormData({ ...formData, spoiled_qty: e.target.value })}
                    className="w-full bg-surface-800 border border-surface-700 text-white font-bold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-purple-400 font-bold mb-1">Broken / Damaged Qty</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={formData.broken_qty}
                    onChange={(e) => setFormData({ ...formData, broken_qty: e.target.value })}
                    className="w-full bg-surface-800 border border-surface-700 text-white font-bold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>
              </div>

              {/* Total Purchase Cost Computed */}
              <div>
                <label className="block text-surface-300 font-semibold mb-1">
                  Total Purchase Cost (PKR) <span className="text-surface-400 font-normal">(Auto-calculated)</span>
                </label>
                <input
                  type="number"
                  step="any"
                  value={formData.total_cost}
                  onChange={(e) => setFormData({ ...formData, total_cost: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-700 text-amber-300 font-bold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                />
              </div>

              {/* Supplier & Notes */}
              <div>
                <label className="block text-surface-300 font-semibold mb-1">Notes / Supplier / Batch Details</label>
                <textarea
                  rows="2"
                  placeholder="e.g. Batch #402, Purchased from Supplier X, 5 broken during transport."
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none resize-none"
                ></textarea>
              </div>

              <div className="pt-3 border-t border-surface-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  className="px-4 py-2 rounded-xl bg-surface-800 text-surface-300 hover:text-white hover:bg-surface-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-lg shadow-brand-900/40 transition disabled:opacity-50"
                >
                  {submitting ? "Saving..." : editingLog ? "Update Daily Log" : "Save Daily Log"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
