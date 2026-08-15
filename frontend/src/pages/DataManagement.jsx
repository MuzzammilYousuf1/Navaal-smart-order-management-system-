import { useState } from "react";
import {
  Settings, Trash2, Upload, Download, AlertTriangle,
  CheckCircle, FileSpreadsheet, Package, ShoppingCart, RefreshCw
} from "lucide-react";
import api, { API_BASE } from "../api/client";

export default function DataManagement() {
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState(""); // "success" | "error"
  const [loading, setLoading] = useState("");
  const [importErrors, setImportErrors] = useState([]);

  const showStatus = (msg, type = "success") => {
    setStatus(msg);
    setStatusType(type);
    setTimeout(() => setStatus(""), 6000);
  };

  // ── Clear actions ──────────────────────────────────────────────────────────
  const handleClearOrders = async () => {
    if (!window.confirm("⚠️ This will DELETE all orders permanently. Products and users will be kept. Are you sure?")) return;
    setLoading("clear-orders");
    try {
      const { data } = await api.delete("/api/data/clear-orders");
      showStatus(`✅ ${data.message}`, "success");
    } catch (err) {
      showStatus(`❌ ${err.response?.data?.detail || "Failed to clear orders"}`, "error");
    } finally {
      setLoading("");
    }
  };

  const handleClearProducts = async () => {
    if (!window.confirm("⚠️ This will DELETE all products AND stock movements permanently. Are you sure?")) return;
    setLoading("clear-products");
    try {
      const { data } = await api.delete("/api/data/clear-products");
      showStatus(`✅ ${data.message}`, "success");
    } catch (err) {
      showStatus(`❌ ${err.response?.data?.detail || "Failed to clear products"}`, "error");
    } finally {
      setLoading("");
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm("🚨 DANGER: This will DELETE ALL orders, stock movements, and notifications. Users and products will be kept. Type YES to confirm.")) return;
    setLoading("clear-all");
    try {
      const { data } = await api.delete("/api/data/clear-all");
      showStatus(`✅ ${data.message}`, "success");
    } catch (err) {
      showStatus(`❌ ${err.response?.data?.detail || "Failed to clear data"}`, "error");
    } finally {
      setLoading("");
    }
  };

  // ── CSV Template downloads ─────────────────────────────────────────────────
  const downloadTemplate = (type) => {
    const token = localStorage.getItem("sof_token");
    window.open(`${API_BASE}/api/data/template/${type}?token=${encodeURIComponent(token)}`, "_blank");
  };

  const exportOrders = () => {
    api.get("/api/data/export/orders", { responseType: "blob" })
      .then(({ data }) => {
        const url = URL.createObjectURL(data);
        const link = document.createElement("a");
        link.href = url;
        link.download = "navaal_orders.csv";
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => showStatus("Could not export orders", "error"));
  };

  // ── CSV Import ─────────────────────────────────────────────────────────────
  const handleImport = async (type, file) => {
    if (!file) return;
    setLoading(`import-${type}`);
    setImportErrors([]);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const { data } = await api.post(`/api/data/import/${type}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      showStatus(`✅ ${data.message}`, "success");
      if (data.errors?.length > 0) {
        setImportErrors(data.errors);
      }
    } catch (err) {
      showStatus(`❌ ${err.response?.data?.detail || "Import failed"}`, "error");
    } finally {
      setLoading("");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand-400" />
          Data Management & Import
        </h1>
        <p className="text-brand-500 text-sm mt-0.5">
          Clear dummy data, import your real products & orders via CSV, and export backups
        </p>
      </div>

      {/* Status Toast */}
      {status && (
        <div className={`card border flex items-center gap-3 py-3 ${
          statusType === "success"
            ? "bg-emerald-950/40 border-emerald-700/60 text-emerald-300"
            : "bg-red-950/40 border-red-700/60 text-red-300"
        }`}>
          {statusType === "success"
            ? <CheckCircle className="w-5 h-5 shrink-0" />
            : <AlertTriangle className="w-5 h-5 shrink-0" />
          }
          <p className="text-sm font-medium">{status}</p>
        </div>
      )}

      {/* Import Errors */}
      {importErrors.length > 0 && (
        <div className="card bg-amber-950/30 border-amber-700/50 space-y-2">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">⚠️ Import Warnings ({importErrors.length} rows had issues)</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {importErrors.map((err, i) => (
              <p key={i} className="text-xs text-amber-300 font-mono">{err}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Step 1: Clear Dummy Data ───────────────────────────────────── */}
        <div className="card space-y-4 bg-surface-900 border-surface-700">
          <div className="flex items-center gap-2 pb-2 border-b border-surface-700">
            <Trash2 className="w-5 h-5 text-red-400" />
            <h2 className="text-base font-bold text-white">Step 1: Remove Dummy / Test Data</h2>
          </div>

          <p className="text-xs text-brand-400">
            The system was seeded with demo orders & products so you could test it. Remove them now before entering your real data.
          </p>

          <div className="space-y-3">
            <div className="p-3 bg-surface-800 rounded-xl border border-surface-700 space-y-2">
              <p className="text-xs font-bold text-amber-400">Remove Demo Orders Only</p>
              <p className="text-xs text-brand-500">Deletes all orders & status history. Keeps products, stock levels, and users.</p>
              <button
                onClick={handleClearOrders}
                disabled={loading === "clear-orders"}
                className="btn-secondary text-xs border-amber-700/50 text-amber-400 hover:bg-amber-900/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {loading === "clear-orders" ? "Clearing..." : "Clear All Orders"}
              </button>
            </div>

            <div className="p-3 bg-surface-800 rounded-xl border border-surface-700 space-y-2">
              <p className="text-xs font-bold text-amber-400">Remove Demo Products Only</p>
              <p className="text-xs text-brand-500">Deletes all product catalog entries & stock movements. Orders and users are kept.</p>
              <button
                onClick={handleClearProducts}
                disabled={loading === "clear-products"}
                className="btn-secondary text-xs border-amber-700/50 text-amber-400 hover:bg-amber-900/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {loading === "clear-products" ? "Clearing..." : "Clear All Products"}
              </button>
            </div>

            <div className="p-3 bg-red-950/30 rounded-xl border border-red-800/50 space-y-2">
              <p className="text-xs font-bold text-red-400">⚠️ Clear Everything (Full Reset)</p>
              <p className="text-xs text-brand-500">Deletes ALL orders, stock movements, and notifications. Users & products kept.</p>
              <button
                onClick={handleClearAll}
                disabled={loading === "clear-all"}
                className="btn-danger text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {loading === "clear-all" ? "Clearing..." : "Full Data Reset"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Step 2: Import Your Products ──────────────────────────────── */}
        <div className="card space-y-4 bg-surface-900 border-surface-700">
          <div className="flex items-center gap-2 pb-2 border-b border-surface-700">
            <Package className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Step 2: Import Your Products</h2>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-emerald-950/20 border border-emerald-800/40 rounded-xl space-y-1.5">
              <p className="text-xs font-bold text-emerald-400">How It Works</p>
              <ol className="text-xs text-brand-400 space-y-1 list-decimal pl-4">
                <li>Download the template CSV below</li>
                <li>Open it in Excel / Google Sheets</li>
                <li>Fill in your real products (name, SKU, price, stock)</li>
                <li>Upload the filled file here</li>
              </ol>
            </div>

            <div className="p-3 bg-surface-800 rounded-xl space-y-2">
              <p className="text-xs font-semibold text-brand-300">Required CSV Columns:</p>
              <div className="font-mono text-[10px] text-brand-500 bg-surface-900 p-2 rounded">
                name, sku, category, unit, unit_price, stock_qty, low_stock_threshold
              </div>
              <button
                onClick={() => downloadTemplate("products")}
                className="btn-secondary text-xs text-emerald-400 border-emerald-700/50"
              >
                <Download className="w-3.5 h-3.5" /> Download Product Template (.csv)
              </button>
            </div>

            <div className="p-3 bg-surface-800 rounded-xl border border-brand-700/30 space-y-3">
              <p className="text-xs font-bold text-brand-300">Upload Your Products CSV</p>
              <label className={`flex flex-col items-center gap-2 p-4 border-2 border-dashed rounded-xl cursor-pointer transition-colors
                ${loading === "import-products" ? "border-brand-600 bg-brand-950/30" : "border-surface-600 hover:border-brand-600 hover:bg-brand-950/20"}`}>
                <FileSpreadsheet className="w-8 h-8 text-brand-400" />
                <span className="text-xs text-brand-400">
                  {loading === "import-products" ? "Importing..." : "Click to choose your products.csv"}
                </span>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={loading === "import-products"}
                  onChange={(e) => handleImport("products", e.target.files[0])}
                />
              </label>
            </div>
          </div>
        </div>

        {/* ── Step 3: Import Your Orders ────────────────────────────────── */}
        <div className="card space-y-4 bg-surface-900 border-surface-700">
          <div className="flex items-center gap-2 pb-2 border-b border-surface-700">
            <ShoppingCart className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-white">Step 3: Import Existing Orders</h2>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl space-y-1.5">
              <p className="text-xs font-bold text-amber-400">Each row = one order (up to 3 products)</p>
              <p className="text-xs text-brand-400">
                Export your past orders from WhatsApp / Excel / Google Sheets into the template format. All imported orders start as "Pending" status.
              </p>
            </div>

            <div className="p-3 bg-surface-800 rounded-xl space-y-2">
              <p className="text-xs font-semibold text-brand-300">Required CSV Columns:</p>
              <div className="font-mono text-[10px] text-brand-500 bg-surface-900 p-2 rounded leading-5">
                customer_name, customer_phone, delivery_address, city, source<br />
                payment_status, priority, notes<br />
                product_name_1, qty_1, unit_price_1<br />
                product_name_2, qty_2, unit_price_2 (optional)
              </div>
              <button
                onClick={() => downloadTemplate("orders")}
                className="btn-secondary text-xs text-amber-400 border-amber-700/50"
              >
                <Download className="w-3.5 h-3.5" /> Download Order Template (.csv)
              </button>
            </div>

            <div className="p-3 bg-surface-800 rounded-xl border border-brand-700/30 space-y-3">
              <p className="text-xs font-bold text-brand-300">Upload Your Orders CSV</p>
              <label className={`flex flex-col items-center gap-2 p-4 border-2 border-dashed rounded-xl cursor-pointer transition-colors
                ${loading === "import-orders" ? "border-amber-600 bg-amber-950/30" : "border-surface-600 hover:border-amber-600 hover:bg-amber-950/20"}`}>
                <FileSpreadsheet className="w-8 h-8 text-amber-400" />
                <span className="text-xs text-brand-400">
                  {loading === "import-orders" ? "Importing..." : "Click to choose your orders.csv"}
                </span>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  disabled={loading === "import-orders"}
                  onChange={(e) => handleImport("orders", e.target.files[0])}
                />
              </label>
            </div>
          </div>
        </div>

        {/* ── Export Backup ─────────────────────────────────────────────── */}
        <div className="card space-y-4 bg-surface-900 border-surface-700">
          <div className="flex items-center gap-2 pb-2 border-b border-surface-700">
            <Download className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Export Backup</h2>
          </div>

          <p className="text-xs text-brand-400">
            Export all your current orders to CSV as a backup, or to share with Google Sheets or your accountant.
          </p>

          <button onClick={exportOrders} className="btn-primary w-full justify-center">
            <Download className="w-4 h-4" /> Export All Orders to CSV
          </button>
        </div>

      </div>
    </div>
  );
}
