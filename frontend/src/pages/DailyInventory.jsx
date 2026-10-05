import { useEffect, useState } from "react";
import {
  Boxes, AlertTriangle, Plus, RefreshCw, Download, Calendar, Filter,
  Search, ShieldAlert, DollarSign, Edit3, Trash2, CheckCircle, PackageX,
  ArrowUpRight, ArrowDownRight, Layers, FileSpreadsheet, Building2,
  PackageCheck, Scale, Truck, AlertOctagon, CheckCircle2, ChevronRight,
  TrendingDown, Percent
} from "lucide-react";
import api from "../api/client";
import useAuth from "../store/useAuth";

export default function DailyInventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState("logs"); // "logs" | "vendors" | "packaging" | "workstation"

  const [logs, setLogs] = useState([]);
  const [products, setProducts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [packagingMaterials, setPackagingMaterials] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [dateRangeOption, setDateRangeOption] = useState("this_month"); // "today" | "yesterday" | "last_7" | "this_month" | "all" | "custom"
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Modals
  const [showLogModal, setShowLogModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingLog, setEditingLog] = useState(null);
  const [editingVendor, setEditingVendor] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Packing Workstation Form State
  const [packFormData, setPackFormData] = useState({
    pack_type: "30",
    number_of_packs: 10,
    deduct_packaging: true,
    note: "",
  });
  const [packingSubmitting, setPackingSubmitting] = useState(false);

  // Log Form State
  const [formData, setFormData] = useState({
    log_date: new Date().toISOString().split("T")[0],
    product_id: "",
    product_name: "Fresh Organic Eggs",
    category_name: "Poultry",
    vendor_id: "",
    vendor_name: "",
    peti_qty: 0,       // 480 eggs avg
    carton_qty: 0,     // 360 eggs avg
    loose_qty: 0,      // loose eggs
    added_qty: 0,      // total eggs
    pricing_mode: "per_egg", // "per_egg" | "per_peti" | "per_carton"
    unit_cost: 0,
    total_cost: "",
    spoilage_vendor_id: "",
    spoilage_vendor_name: "",
    spoilage_reason: "Bad Quality / Rotten",
    spoiled_qty: 0,
    broken_qty: 0,
    notes: "",
  });

  // Vendor Form State
  const [vendorFormData, setVendorFormData] = useState({
    name: "",
    contact_person: "",
    phone: "",
    email: "",
    address: "",
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
      if (filterVendor) params.vendor_id = filterVendor;

      const [logsRes, summaryRes, prodsRes, vendorsRes, pkgRes] = await Promise.all([
        api.get("/api/daily-inventory", { params }),
        api.get("/api/daily-inventory/summary", { params: { start_date: start || undefined, end_date: end || undefined, category: filterCategory || undefined } }),
        api.get("/api/inventory/products"),
        api.get("/api/vendors"),
        api.get("/api/inventory/packaging-materials"),
      ]);

      setLogs(logsRes.data);
      setSummary(summaryRes.data);
      setProducts(prodsRes.data);
      setVendors(vendorsRes.data);
      setPackagingMaterials(pkgRes.data);
    } catch (err) {
      console.error("Failed to load daily inventory portal", err);
      showStatus(err.response?.data?.detail || "Error loading inventory portal", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [dateRangeOption, startDate, endDate, filterCategory, filterVendor]);

  // Handle live calculation of added_qty when peti, carton, or loose change
  const handleQtyChange = (field, val) => {
    const num = Math.max(0, Number(val) || 0);
    const updated = { ...formData, [field]: num };

    const peti = field === "peti_qty" ? num : Number(formData.peti_qty) || 0;
    const carton = field === "carton_qty" ? num : Number(formData.carton_qty) || 0;
    const loose = field === "loose_qty" ? num : Number(formData.loose_qty) || 0;

    const calcEggs = (peti * 480) + (carton * 360) + loose;
    updated.added_qty = calcEggs;

    // Recalculate total cost based on pricing mode
    const costUnit = Number(formData.unit_cost) || 0;
    if (formData.pricing_mode === "per_peti") {
      updated.total_cost = peti * costUnit;
    } else if (formData.pricing_mode === "per_carton") {
      updated.total_cost = carton * costUnit;
    } else {
      updated.total_cost = calcEggs * costUnit;
    }

    setFormData(updated);
  };

  const handleProductSelect = (e) => {
    const pId = e.target.value;
    if (!pId) {
      setFormData((prev) => ({ ...prev, product_id: "", product_name: "Fresh Organic Eggs", category_name: "Poultry" }));
      return;
    }
    const found = products.find((p) => String(p.id) === String(pId));
    if (found) {
      setFormData((prev) => ({
        ...prev,
        product_id: found.id,
        product_name: found.name,
        category_name: found.category || "Poultry",
        unit_cost: prev.unit_cost || found.unit_price || 0,
      }));
    }
  };

  const openNewLogModal = () => {
    setEditingLog(null);
    const defaultProd = products.find((p) => !p.base_product_id) || products[0];
    const defaultVendor = vendors[0];
    setFormData({
      log_date: new Date().toISOString().split("T")[0],
      product_id: defaultProd ? defaultProd.id : "",
      product_name: defaultProd ? defaultProd.name : "Fresh Organic Eggs",
      category_name: defaultProd ? (defaultProd.category || "Poultry") : "Poultry",
      vendor_id: defaultVendor ? defaultVendor.id : "",
      vendor_name: defaultVendor ? defaultVendor.name : "",
      peti_qty: 0,
      carton_qty: 0,
      loose_qty: 0,
      added_qty: 0,
      pricing_mode: "per_egg",
      unit_cost: defaultProd ? (defaultProd.unit_price || 0) : 0,
      total_cost: "",
      spoilage_vendor_id: defaultVendor ? defaultVendor.id : "",
      spoilage_vendor_name: defaultVendor ? defaultVendor.name : "",
      spoilage_reason: "Bad Quality / Rotten",
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
      product_name: log.product_name || "Fresh Organic Eggs",
      category_name: log.category_name || "Poultry",
      vendor_id: log.vendor_id || "",
      vendor_name: log.vendor_name || "",
      peti_qty: log.peti_qty || 0,
      carton_qty: log.carton_qty || 0,
      loose_qty: log.loose_qty || 0,
      added_qty: log.added_qty || 0,
      pricing_mode: "per_egg",
      unit_cost: log.unit_cost || 0,
      total_cost: log.total_cost || 0,
      spoilage_vendor_id: log.spoilage_vendor_id || "",
      spoilage_vendor_name: log.spoilage_vendor_name || "",
      spoilage_reason: log.spoilage_reason || "Bad Quality / Rotten",
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
      const selectedVendor = vendors.find((v) => String(v.id) === String(formData.vendor_id));
      const selectedSpoilVendor = vendors.find((v) => String(v.id) === String(formData.spoilage_vendor_id));

      const payload = {
        log_date: new Date(formData.log_date).toISOString(),
        product_id: formData.product_id ? Number(formData.product_id) : null,
        product_name: formData.product_name,
        category_name: formData.category_name,
        vendor_id: formData.vendor_id ? Number(formData.vendor_id) : null,
        vendor_name: selectedVendor ? selectedVendor.name : formData.vendor_name,
        peti_qty: Number(formData.peti_qty) || 0,
        carton_qty: Number(formData.carton_qty) || 0,
        loose_qty: Number(formData.loose_qty) || 0,
        added_qty: Number(formData.added_qty) || 0,
        unit_cost: Number(formData.unit_cost) || 0,
        total_cost: formData.total_cost !== "" ? Number(formData.total_cost) : undefined,
        spoilage_vendor_id: formData.spoilage_vendor_id ? Number(formData.spoilage_vendor_id) : null,
        spoilage_vendor_name: selectedSpoilVendor ? selectedSpoilVendor.name : (formData.spoilage_vendor_name || formData.vendor_name),
        spoilage_reason: formData.spoilage_reason,
        spoiled_qty: Number(formData.spoiled_qty) || 0,
        broken_qty: Number(formData.broken_qty) || 0,
        notes: formData.notes,
      };

      if (editingLog) {
        await api.put(`/api/daily-inventory/${editingLog.id}`, payload);
        showStatus("Warehouse log updated successfully!", "success");
      } else {
        await api.post("/api/daily-inventory", payload);
        showStatus("New warehouse stock log saved successfully!", "success");
      }

      setShowLogModal(false);
      fetchData();
    } catch (err) {
      showStatus(err.response?.data?.detail || "Failed to save warehouse log", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVendorSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingVendor) {
        await api.put(`/api/vendors/${editingVendor.id}`, vendorFormData);
        showStatus("Vendor updated successfully!", "success");
      } else {
        await api.post("/api/vendors", vendorFormData);
        showStatus("New vendor created successfully!", "success");
      }
      setShowVendorModal(false);
      fetchData();
    } catch (err) {
      showStatus(err.response?.data?.detail || "Failed to save vendor", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteLog = async (logId) => {
    if (!window.confirm("Are you sure you want to delete this daily inventory entry? This will revert associated stock changes.")) {
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

  const handlePackEggsSubmit = async (e) => {
    e.preventDefault();
    setPackingSubmitting(true);
    try {
      const res = await api.post("/api/inventory/pack-eggs", packFormData);
      showStatus(res.data.message || "Packaging operation completed!", "success");
      fetchData();
    } catch (err) {
      showStatus(err.response?.data?.detail || "Failed to perform packaging operation", "error");
    } finally {
      setPackingSubmitting(false);
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
      link.setAttribute("download", `warehouse_inventory_report_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert("Failed to download CSV report.");
    }
  };

  // Filtered logs
  const filteredLogs = logs.filter((l) => {
    if (filterVendor && String(l.vendor_id) !== String(filterVendor) && String(l.spoilage_vendor_id) !== String(filterVendor)) {
      return false;
    }
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (l.product_name && l.product_name.toLowerCase().includes(term)) ||
      (l.category_name && l.category_name.toLowerCase().includes(term)) ||
      (l.vendor_name && l.vendor_name.toLowerCase().includes(term)) ||
      (l.spoilage_vendor_name && l.spoilage_vendor_name.toLowerCase().includes(term)) ||
      (l.notes && l.notes.toLowerCase().includes(term))
    );
  });

  // Egg packs stock summary calculation
  const eggPacks = {
    pack6: products.find((p) => p.sku?.includes("P6") || p.name?.includes("Pack of 6") || p.unit_multiplier === 6),
    pack15: products.find((p) => p.sku?.includes("P15") || p.name?.includes("Pack of 15") || p.unit_multiplier === 15),
    pack30: products.find((p) => p.sku?.includes("P30") || p.name?.includes("Pack of 30") || p.unit_multiplier === 30),
  };

  if (!isAdmin) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Admin Access Required</h2>
        <p className="text-surface-400 max-w-md">
          The Warehouse & Daily Inventory System is restricted exclusively to system administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1700px] mx-auto overflow-y-auto">
      {/* Top Portal Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-900/90 border border-surface-700/80 p-6 rounded-2xl shadow-xl">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Boxes className="w-7 h-7 text-emerald-400" />
              Warehouse & Inventory Management System
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand-500/20 text-brand-300 border border-brand-500/30">
              Complete Accountability
            </span>
          </div>
          <p className="text-sm text-surface-400 mt-1">
            Track Petis (480 avg), Cartons (360 avg), Loose Eggs, Vendor Spoilage Accountability & Finished 6, 15, 30 Packs.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-3">
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
            onClick={() => {
              setEditingVendor(null);
              setVendorFormData({ name: "", contact_person: "", phone: "", email: "", address: "", notes: "" });
              setShowVendorModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-200 hover:text-white hover:bg-surface-700 font-semibold text-sm transition"
          >
            <Building2 className="w-4 h-4 text-amber-400" />
            <span>+ Add Vendor</span>
          </button>

          <button
            onClick={openNewLogModal}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm shadow-lg shadow-brand-900/40 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Log Daily Stock Entry</span>
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

      {/* Top Summary Cards KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Working Loose Egg Stock */}
        <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-3 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Raw Loose Egg Stock</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Boxes className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-white">
              {summary ? summary.total_stock_in_hand.toLocaleString() : 0} <span className="text-sm font-semibold text-surface-400">eggs</span>
            </div>
            <div className="flex items-center gap-3 text-xs mt-2 pt-2 border-t border-surface-800">
              <span className="text-amber-300 font-bold">
                ~{summary ? summary.total_petis_in_hand : 0} <span className="text-surface-400 font-normal">Petis (480)</span>
              </span>
              <span className="text-surface-600">|</span>
              <span className="text-blue-300 font-bold">
                ~{summary ? summary.total_cartons_in_hand : 0} <span className="text-surface-400 font-normal">Cartons (360)</span>
              </span>
            </div>
          </div>
        </div>

        {/* Stock Received in Period */}
        <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Stock Received (Period)</span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <Truck className="w-5 h-5 text-blue-400" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-white">
              {summary ? summary.total_added.toLocaleString() : 0} <span className="text-sm font-semibold text-surface-400">eggs</span>
            </div>
            <div className="text-xs text-amber-300 font-semibold mt-2 pt-2 border-t border-surface-800">
              Total Cost: PKR {summary ? summary.total_purchase_cost.toLocaleString() : 0}
            </div>
          </div>
        </div>

        {/* Spoilage & Damaged Financial Loss */}
        <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Spoilage & Breakage</span>
            <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
              <AlertOctagon className="w-5 h-5 text-red-400" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-red-400">
              {summary ? (summary.total_spoiled + summary.total_broken).toLocaleString() : 0} <span className="text-sm font-semibold text-surface-400">bad eggs</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-surface-800">
              <span className="text-red-300">Spoiled: {summary?.total_spoiled || 0}</span>
              <span className="text-purple-300">Broken: {summary?.total_broken || 0}</span>
              <span className="text-amber-400 font-bold">Loss: PKR {summary?.total_loss_pkr || 0}</span>
            </div>
          </div>
        </div>

        {/* Finished Goods Packs Availability */}
        <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Packaged Stock (6, 15, 30)</span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
              <PackageCheck className="w-5 h-5 text-purple-400" />
            </div>
          </div>
          <div>
            <div className="text-sm font-bold text-white space-y-1">
              <div className="flex justify-between">
                <span className="text-surface-400">30 Pack:</span>
                <span className="text-brand-300 font-extrabold">{eggPacks.pack30?.stock_qty || 0} trays</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">15 Pack:</span>
                <span className="text-blue-300 font-extrabold">{eggPacks.pack15?.stock_qty || 0} packs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">6 Pack:</span>
                <span className="text-amber-300 font-extrabold">{eggPacks.pack6?.stock_qty || 0} packs</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Section Navigation Tabs */}
      <div className="flex border-b border-surface-700/80 gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab("logs")}
          className={`flex items-center gap-2 px-5 py-3 rounded-t-xl font-bold text-sm transition ${
            activeTab === "logs"
              ? "bg-surface-900 text-brand-400 border-t-2 border-brand-500 shadow-md"
              : "text-surface-400 hover:text-white hover:bg-surface-800/50"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Daily Stock & Warehouse Logs</span>
        </button>

        <button
          onClick={() => setActiveTab("vendors")}
          className={`flex items-center gap-2 px-5 py-3 rounded-t-xl font-bold text-sm transition ${
            activeTab === "vendors"
              ? "bg-surface-900 text-brand-400 border-t-2 border-brand-500 shadow-md"
              : "text-surface-400 hover:text-white hover:bg-surface-800/50"
          }`}
        >
          <Building2 className="w-4 h-4 text-amber-400" />
          <span>Vendor Quality & Spoilage Accountability</span>
        </button>

        <button
          onClick={() => setActiveTab("workstation")}
          className={`flex items-center gap-2 px-5 py-3 rounded-t-xl font-bold text-sm transition ${
            activeTab === "workstation"
              ? "bg-surface-900 text-brand-400 border-t-2 border-brand-500 shadow-md"
              : "text-surface-400 hover:text-white hover:bg-surface-800/50"
          }`}
        >
          <Scale className="w-4 h-4 text-blue-400" />
          <span>Egg Pack Conversion Workstation (6, 15, 30)</span>
        </button>

        <button
          onClick={() => setActiveTab("packaging")}
          className={`flex items-center gap-2 px-5 py-3 rounded-t-xl font-bold text-sm transition ${
            activeTab === "packaging"
              ? "bg-surface-900 text-brand-400 border-t-2 border-brand-500 shadow-md"
              : "text-surface-400 hover:text-white hover:bg-surface-800/50"
          }`}
        >
          <PackageCheck className="w-4 h-4 text-purple-400" />
          <span>Packaging Materials Stock</span>
        </button>
      </div>

      {/* ─── TAB 1: DAILY STOCK & WAREHOUSE LOGS ─────────────────────────────────── */}
      {activeTab === "logs" && (
        <div className="space-y-6">
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

            {/* Right: Search & Vendor Filter */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-surface-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search item, vendor or notes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-surface-800 border border-surface-700 text-white placeholder-surface-500 text-xs focus:border-brand-500 outline-none"
                />
              </div>

              <select
                value={filterVendor}
                onChange={(e) => setFilterVendor(e.target.value)}
                className="bg-surface-800 border border-surface-700 text-white text-xs rounded-xl px-3 py-1.5 focus:border-brand-500 outline-none"
              >
                <option value="">All Vendors</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
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
                <h3 className="font-bold text-white text-sm">Warehouse Log History</h3>
                <span className="text-xs text-surface-400">({filteredLogs.length} entries)</span>
              </div>
            </div>

            {loading ? (
              <div className="p-12 text-center text-surface-400 space-y-2">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-400" />
                <p className="text-sm">Loading warehouse records...</p>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-surface-400 space-y-2">
                <Boxes className="w-10 h-10 mx-auto opacity-30" />
                <p className="text-base font-semibold text-surface-300">No warehouse logs found</p>
                <p className="text-xs">Click "Log Daily Stock Entry" to record received Petis, Cartons, or Loose eggs.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-800/60 border-b border-surface-700/80 text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Vendor / Farm</th>
                      <th className="py-3 px-4">Item Name</th>
                      <th className="py-3 px-4 text-center">Petis (480)</th>
                      <th className="py-3 px-4 text-center">Cartons (360)</th>
                      <th className="py-3 px-4 text-right">Loose Eggs</th>
                      <th className="py-3 px-4 text-right">Total Added Eggs</th>
                      <th className="py-3 px-4 text-right">Unit Price</th>
                      <th className="py-3 px-4 text-right">Total Cost</th>
                      <th className="py-3 px-4 text-center">Spoiled / Damaged</th>
                      <th className="py-3 px-4 text-right">Net Change</th>
                      <th className="py-3 px-4">Notes</th>
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
                          
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-amber-300 flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span>{log.vendor_name || "Unassigned"}</span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 font-medium text-surface-200">{log.product_name}</td>

                          <td className="py-3.5 px-4 text-center font-mono font-bold text-amber-400">
                            {log.peti_qty > 0 ? log.peti_qty : "—"}
                          </td>

                          <td className="py-3.5 px-4 text-center font-mono font-bold text-blue-400">
                            {log.carton_qty > 0 ? log.carton_qty : "—"}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono text-surface-300">
                            {log.loose_qty > 0 ? log.loose_qty : "—"}
                          </td>

                          <td className="py-3.5 px-4 text-right font-extrabold text-blue-400">
                            {log.added_qty > 0 ? `+${log.added_qty.toLocaleString()}` : "0"}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono text-surface-300">
                            {log.unit_cost > 0 ? `PKR ${log.unit_cost}` : "-"}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-300">
                            {log.total_cost > 0 ? `PKR ${log.total_cost.toLocaleString()}` : "-"}
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            {(log.spoiled_qty > 0 || log.broken_qty > 0) ? (
                              <div className="text-[11px] space-y-0.5">
                                {log.spoiled_qty > 0 && <div className="text-red-400 font-bold">-{log.spoiled_qty} spoiled</div>}
                                {log.broken_qty > 0 && <div className="text-purple-400 font-bold">-{log.broken_qty} broken</div>}
                                <div className="text-surface-500 text-[10px]">Resp: {log.spoilage_vendor_name || log.vendor_name || "N/A"}</div>
                              </div>
                            ) : (
                              <span className="text-surface-500">None</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right font-bold">
                            <span className={netChange > 0 ? "text-emerald-400" : netChange < 0 ? "text-red-400" : "text-surface-400"}>
                              {netChange > 0 ? `+${netChange}` : netChange}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 max-w-[200px] truncate text-surface-400" title={log.notes || undefined}>
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
        </div>
      )}

      {/* ─── TAB 2: VENDOR ACCOUNTABILITY MATRIX ─────────────────────────────────── */}
      {activeTab === "vendors" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between bg-surface-900 border border-surface-700/80 p-5 rounded-2xl">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-amber-400" />
                <span>Vendor & Farm Quality Accountability Report</span>
              </h3>
              <p className="text-xs text-surface-400 mt-1">
                Monitors exact Petis came, Cartons came, Total stock delivered, financial payout, and spoilage/breakage loss rate % per supplier.
              </p>
            </div>

            <button
              onClick={() => {
                setEditingVendor(null);
                setVendorFormData({ name: "", contact_person: "", phone: "", email: "", address: "", notes: "" });
                setShowVendorModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Farm / Vendor</span>
            </button>
          </div>

          <div className="rounded-2xl bg-surface-900 border border-surface-700/80 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-800/60 border-b border-surface-700/80 text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Vendor / Farm Name</th>
                    <th className="py-3 px-4 text-center">Petis Came (480)</th>
                    <th className="py-3 px-4 text-center">Cartons Came (360)</th>
                    <th className="py-3 px-4 text-right">Loose Eggs</th>
                    <th className="py-3 px-4 text-right">Total Eggs Received</th>
                    <th className="py-3 px-4 text-right">Total Paid (PKR)</th>
                    <th className="py-3 px-4 text-center">Spoiled Eggs</th>
                    <th className="py-3 px-4 text-center">Broken Eggs</th>
                    <th className="py-3 px-4 text-right">Total Loss (PKR)</th>
                    <th className="py-3 px-4 text-center">Spoilage Rate %</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-surface-800/80 text-xs">
                  {summary?.vendor_accountability && summary.vendor_accountability.length > 0 ? (
                    summary.vendor_accountability.map((v) => (
                      <tr key={v.vendor_name} className="hover:bg-surface-800/40 transition">
                        <td className="py-4 px-4 font-bold text-white">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>{v.vendor_name}</span>
                          </div>
                        </td>

                        <td className="py-4 px-4 text-center font-mono font-bold text-amber-300">
                          {v.total_petis > 0 ? v.total_petis : 0}
                        </td>

                        <td className="py-4 px-4 text-center font-mono font-bold text-blue-300">
                          {v.total_cartons > 0 ? v.total_cartons : 0}
                        </td>

                        <td className="py-4 px-4 text-right font-mono text-surface-300">
                          {v.total_loose.toLocaleString()}
                        </td>

                        <td className="py-4 px-4 text-right font-extrabold text-white text-sm">
                          {v.total_eggs_received.toLocaleString()}
                        </td>

                        <td className="py-4 px-4 text-right font-mono font-bold text-amber-300">
                          PKR {v.total_cost_pkr.toLocaleString()}
                        </td>

                        <td className="py-4 px-4 text-center font-bold text-red-400">
                          {v.total_spoiled_eggs}
                        </td>

                        <td className="py-4 px-4 text-center font-bold text-purple-400">
                          {v.total_broken_eggs}
                        </td>

                        <td className="py-4 px-4 text-right font-mono font-bold text-red-400">
                          PKR {v.total_loss_pkr.toLocaleString()}
                        </td>

                        <td className="py-4 px-4 text-center">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold ${
                              v.spoilage_rate_pct > 3
                                ? "bg-red-500/20 text-red-300 border border-red-500/30"
                                : v.spoilage_rate_pct > 1
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            }`}
                          >
                            {v.spoilage_rate_pct}%
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="10" className="py-8 text-center text-surface-400">
                        No vendor records logged yet. Use "Log Daily Stock Entry" or "+ Add Vendor" to track suppliers.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB 3: EGG PACK CONVERSION WORKSTATION ─────────────────────────────── */}
      {activeTab === "workstation" && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Scale className="w-5 h-5 text-blue-400" />
              <span>Egg Packaging Conversion Station</span>
            </h3>
            <p className="text-xs text-surface-400">
              Convert raw loose eggs stock into pre-packed 6, 15, or 30 egg trays/boxes. Real-time validation checks loose egg availability.
            </p>

            {/* Current Availability Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-surface-800/60 border border-surface-700/60 space-y-1">
                <span className="text-xs font-semibold text-surface-400">Pack of 30 Trays</span>
                <div className="text-xl font-bold text-brand-300">{eggPacks.pack30?.stock_qty || 0} Trays</div>
                <p className="text-[11px] text-surface-400">Max packable: {Math.floor((summary?.total_stock_in_hand || 0) / 30)} trays</p>
              </div>

              <div className="p-4 rounded-xl bg-surface-800/60 border border-surface-700/60 space-y-1">
                <span className="text-xs font-semibold text-surface-400">Pack of 15 Packs</span>
                <div className="text-xl font-bold text-blue-300">{eggPacks.pack15?.stock_qty || 0} Packs</div>
                <p className="text-[11px] text-surface-400">Max packable: {Math.floor((summary?.total_stock_in_hand || 0) / 15)} packs</p>
              </div>

              <div className="p-4 rounded-xl bg-surface-800/60 border border-surface-700/60 space-y-1">
                <span className="text-xs font-semibold text-surface-400">Pack of 6 Boxes</span>
                <div className="text-xl font-bold text-amber-300">{eggPacks.pack6?.stock_qty || 0} Boxes</div>
                <p className="text-[11px] text-surface-400">Max packable: {Math.floor((summary?.total_stock_in_hand || 0) / 6)} boxes</p>
              </div>
            </div>
          </div>

          {/* Packing Conversion Form */}
          <div className="p-6 rounded-2xl bg-surface-900 border border-surface-700/80 max-w-xl space-y-4">
            <h4 className="font-bold text-white text-sm">Execute Packaging Operation</h4>

            <form onSubmit={handlePackEggsSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-surface-300 font-semibold mb-1">Target Pack Type</label>
                <select
                  value={packFormData.pack_type}
                  onChange={(e) => setPackFormData({ ...packFormData, pack_type: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                >
                  <option value="30">30 Egg Pack Tray (Uses 30 raw eggs per pack)</option>
                  <option value="15">15 Egg Pack Box (Uses 15 raw eggs per pack)</option>
                  <option value="6">6 Egg Pack Box (Uses 6 raw eggs per pack)</option>
                </select>
              </div>

              <div>
                <label className="block text-surface-300 font-semibold mb-1">Number of Finished Packs to Create</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={packFormData.number_of_packs}
                  onChange={(e) => setPackFormData({ ...packFormData, number_of_packs: Math.max(1, Number(e.target.value)) })}
                  className="w-full bg-surface-800 border border-surface-700 text-white font-bold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                />
                <p className="text-[11px] text-amber-400 font-medium mt-1">
                  Will use <strong>{Number(packFormData.pack_type) * Number(packFormData.number_of_packs)}</strong> raw loose eggs from current stock.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="deduct_pkg"
                  checked={packFormData.deduct_packaging}
                  onChange={(e) => setPackFormData({ ...packFormData, deduct_packaging: e.target.checked })}
                  className="rounded border-surface-700 bg-surface-800 text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="deduct_pkg" className="text-surface-300 font-semibold cursor-pointer">
                  Auto-deduct packaging boxes/trays stock
                </label>
              </div>

              <div>
                <label className="block text-surface-300 font-semibold mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Packed 10 trays for morning B2B order dispatch"
                  value={packFormData.note}
                  onChange={(e) => setPackFormData({ ...packFormData, note: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={packingSubmitting}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-900/40 transition disabled:opacity-50"
              >
                {packingSubmitting ? "Processing Packing..." : "Confirm & Pack Eggs"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ─── TAB 4: PACKAGING MATERIALS STOCK ───────────────────────────────────── */}
      {activeTab === "packaging" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between bg-surface-900 border border-surface-700/80 p-5 rounded-2xl">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <PackageCheck className="w-5 h-5 text-purple-400" />
                <span>Packaging Materials Inventory</span>
              </h3>
              <p className="text-xs text-surface-400 mt-1">
                Track available physical stock of 6-egg boxes, 15-egg trays, 30-egg trays, seals, and tape.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {packagingMaterials.map((mat) => (
              <div key={mat.id} className="p-5 rounded-2xl bg-surface-900 border border-surface-700/80 space-y-3 shadow-lg">
                <div className="flex items-center justify-between border-b border-surface-800 pb-2">
                  <span className="font-bold text-white">{mat.name}</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                    {mat.pack_type ? `${mat.pack_type}-Egg Pack` : "General"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-surface-400 block">Stock Qty:</span>
                    <span className="text-2xl font-black text-white">{mat.stock_qty.toLocaleString()} <span className="text-xs font-normal text-surface-400">pcs</span></span>
                  </div>
                  <div>
                    <span className="text-xs text-surface-400 block">Unit Cost:</span>
                    <span className="text-sm font-bold text-amber-300">PKR {mat.unit_cost}</span>
                  </div>
                </div>

                <div className="text-xs text-surface-400 pt-1">
                  SKU: <span className="font-mono text-surface-300">{mat.sku}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── MODAL: LOG DAILY STOCK ENTRY & VENDOR RECEIPT ─────────────────────── */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-0 my-8">
            <div className="p-5 border-b border-surface-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-brand-400" />
                <h3 className="text-lg font-bold text-white">
                  {editingLog ? "Edit Warehouse Inventory Log" : "Log Stock Entry & Vendor Receipt"}
                </h3>
              </div>
              <button
                onClick={() => setShowLogModal(false)}
                className="text-surface-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              {/* Date & Vendor Select */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-surface-300 font-semibold mb-1">Receipt Date</label>
                  <input
                    type="date"
                    required
                    value={formData.log_date}
                    onChange={(e) => setFormData({ ...formData, log_date: e.target.value })}
                    className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-amber-300 font-bold mb-1">Select Supplier / Farm Vendor</label>
                  <select
                    value={formData.vendor_id}
                    onChange={(e) => setFormData({ ...formData, vendor_id: e.target.value, vendor_name: vendors.find(v => String(v.id) === String(e.target.value))?.name || "" })}
                    className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  >
                    <option value="">-- Select Vendor --</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {v.contact_person ? `(${v.contact_person})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Product Select */}
              <div>
                <label className="block text-surface-300 font-semibold mb-1">Product Category Item</label>
                <select
                  value={formData.product_id}
                  onChange={handleProductSelect}
                  className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                >
                  {products.filter((p) => !p.base_product_id).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.category || "Poultry"})
                    </option>
                  ))}
                </select>
              </div>

              {/* PETI (480), CARTON (360), LOOSE BREAKDOWN BOX */}
              <div className="p-4 rounded-xl bg-surface-800/80 border border-brand-500/30 space-y-3">
                <div className="flex items-center justify-between border-b border-surface-700 pb-2">
                  <span className="font-bold text-brand-300 text-xs flex items-center gap-1.5">
                    <Boxes className="w-4 h-4 text-brand-400" />
                    Shipment Received Breakdown
                  </span>
                  <span className="text-xs text-white font-extrabold bg-brand-600/30 px-2.5 py-0.5 rounded-full border border-brand-500/40">
                    Total: {formData.added_qty.toLocaleString()} eggs
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-amber-300 font-bold mb-1">Petis Came (480 avg)</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="e.g. 10"
                      value={formData.peti_qty}
                      onChange={(e) => handleQtyChange("peti_qty", e.target.value)}
                      className="w-full bg-surface-900 border border-surface-700 text-amber-300 font-extrabold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                    />
                    <span className="text-[10px] text-surface-400 font-medium">= {(Number(formData.peti_qty) || 0) * 480} eggs</span>
                  </div>

                  <div>
                    <label className="block text-blue-300 font-bold mb-1">Cartons Came (360 avg)</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="e.g. 5"
                      value={formData.carton_qty}
                      onChange={(e) => handleQtyChange("carton_qty", e.target.value)}
                      className="w-full bg-surface-900 border border-surface-700 text-blue-300 font-extrabold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                    />
                    <span className="text-[10px] text-surface-400 font-medium">= {(Number(formData.carton_qty) || 0) * 360} eggs</span>
                  </div>

                  <div>
                    <label className="block text-emerald-300 font-bold mb-1">Loose Eggs</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="e.g. 50"
                      value={formData.loose_qty}
                      onChange={(e) => handleQtyChange("loose_qty", e.target.value)}
                      className="w-full bg-surface-900 border border-surface-700 text-emerald-300 font-extrabold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                    />
                    <span className="text-[10px] text-surface-400 font-medium">Extra loose count</span>
                  </div>
                </div>
              </div>

              {/* PRICING & COST */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 rounded-xl bg-surface-800/50 border border-surface-700/60">
                <div>
                  <label className="block text-amber-400 font-bold mb-1">Purchase Price per Egg (PKR)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={formData.unit_cost}
                    onChange={(e) => {
                      const cost = Number(e.target.value) || 0;
                      setFormData({
                        ...formData,
                        unit_cost: cost,
                        total_cost: roundVal(cost * formData.added_qty),
                      });
                    }}
                    className="w-full bg-surface-800 border border-surface-700 text-white font-bold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-surface-300 font-semibold mb-1">Total Purchase Cost (PKR)</label>
                  <input
                    type="number"
                    step="any"
                    value={formData.total_cost}
                    onChange={(e) => setFormData({ ...formData, total_cost: e.target.value })}
                    className="w-full bg-surface-800 border border-surface-700 text-amber-300 font-extrabold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>
              </div>

              {/* SPOILAGE & BREAKAGE ATTRIBUTION */}
              <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 space-y-3">
                <span className="font-bold text-red-300 text-xs flex items-center gap-1.5">
                  <AlertOctagon className="w-4 h-4 text-red-400" />
                  Spoilage & Damage Attribution (Linked to Vendor)
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-surface-300 font-semibold mb-1">Vendor Responsible for Spoilage</label>
                    <select
                      value={formData.spoilage_vendor_id}
                      onChange={(e) => setFormData({ ...formData, spoilage_vendor_id: e.target.value })}
                      className="w-full bg-surface-900 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                    >
                      <option value="">-- Same as Receipt Vendor --</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-surface-300 font-semibold mb-1">Spoilage / Damage Reason</label>
                    <select
                      value={formData.spoilage_reason}
                      onChange={(e) => setFormData({ ...formData, spoilage_reason: e.target.value })}
                      className="w-full bg-surface-900 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                    >
                      <option value="Bad Quality / Rotten">Bad Quality / Rotten Eggs</option>
                      <option value="Broken in Transit">Broken in Transit</option>
                      <option value="Handling Damage">Handling / Warehouse Damage</option>
                      <option value="Expired">Expired</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-red-400 font-bold mb-1">Spoiled / Bad Eggs Count</label>
                    <input
                      type="number"
                      min="0"
                      value={formData.spoiled_qty}
                      onChange={(e) => setFormData({ ...formData, spoiled_qty: e.target.value })}
                      className="w-full bg-surface-900 border border-surface-700 text-white font-bold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-purple-400 font-bold mb-1">Broken / Damaged Eggs Count</label>
                    <input
                      type="number"
                      min="0"
                      value={formData.broken_qty}
                      onChange={(e) => setFormData({ ...formData, broken_qty: e.target.value })}
                      className="w-full bg-surface-900 border border-surface-700 text-white font-bold rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-surface-300 font-semibold mb-1">Batch # / Notes</label>
                <textarea
                  rows="2"
                  placeholder="e.g. Batch #902, Farm A delivery via driver Kamran. 12 broken eggs deducted."
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
                  {submitting ? "Saving..." : editingLog ? "Update Log" : "Save Stock Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: ADD / EDIT VENDOR ─────────────────────────────────────────── */}
      {showVendorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-surface-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-amber-400" />
                <h3 className="text-lg font-bold text-white">
                  {editingVendor ? "Edit Vendor Info" : "Add New Supplier / Farm Vendor"}
                </h3>
              </div>
              <button
                onClick={() => setShowVendorModal(false)}
                className="text-surface-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleVendorSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-surface-300 font-semibold mb-1">Vendor / Farm Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ahmad Organic Poultry Farm"
                  value={vendorFormData.name}
                  onChange={(e) => setVendorFormData({ ...vendorFormData, name: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-surface-300 font-semibold mb-1">Contact Person</label>
                <input
                  type="text"
                  placeholder="e.g. Malik Ahmad"
                  value={vendorFormData.contact_person}
                  onChange={(e) => setVendorFormData({ ...vendorFormData, contact_person: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-surface-300 font-semibold mb-1">Phone Number</label>
                  <input
                    type="text"
                    placeholder="0300-1234567"
                    value={vendorFormData.phone}
                    onChange={(e) => setVendorFormData({ ...vendorFormData, phone: e.target.value })}
                    className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-surface-300 font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="vendor@farm.com"
                    value={vendorFormData.email}
                    onChange={(e) => setVendorFormData({ ...vendorFormData, email: e.target.value })}
                    className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-surface-300 font-semibold mb-1">Address / Location</label>
                <input
                  type="text"
                  placeholder="e.g. Raiwind Road Farm #4, Lahore"
                  value={vendorFormData.address}
                  onChange={(e) => setVendorFormData({ ...vendorFormData, address: e.target.value })}
                  className="w-full bg-surface-800 border border-surface-700 text-white rounded-xl px-3 py-2 focus:border-brand-500 outline-none"
                />
              </div>

              <div className="pt-3 border-t border-surface-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowVendorModal(false)}
                  className="px-4 py-2 rounded-xl bg-surface-800 text-surface-300 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold transition disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save Vendor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function roundVal(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
