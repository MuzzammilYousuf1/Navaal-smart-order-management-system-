import { useEffect, useState } from "react";
import {
  Boxes, AlertTriangle, Plus, RefreshCw, ArrowUpRight, ArrowDownRight, PackageCheck,
  Upload, Download, Trash2, CheckCircle, FileSpreadsheet, Bot, BotOff
} from "lucide-react";
import api, { API_BASE } from "../api/client";
import useAuth from "../store/useAuth";

export default function Inventory() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("");
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  // Restock Modal state
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [restockQty, setRestockQty] = useState(10);
  const [restockNote, setRestockNote] = useState("");
  const [updating, setUpdating] = useState(false);

  // Stock Correction (set to exact value) state
  const [correctProduct, setCorrectProduct] = useState(null);
  const [correctQty, setCorrectQty] = useState(0);
  const [correctNote, setCorrectNote] = useState("");

  // Spoilage / Broken Stock state
  const [spoilProduct, setSpoilProduct] = useState(null);
  const [spoilQty, setSpoilQty] = useState(1);
  const [spoilAction, setSpoilAction] = useState("discarded");
  const [spoilOrderNum, setSpoilOrderNum] = useState("");
  const [spoilNote, setSpoilNote] = useState("");

  // New Product Modal state
  const [showNewModal, setShowNewModal] = useState(false);
  const [newProd, setNewProd] = useState({
    name: "", sku: "", category: "General", unit: "unit", unit_price: 500, stock_qty: 20, low_stock_threshold: 10,
    base_product_id: "", unit_multiplier: 1.0
  });

  // CSV Data Management state
  const [csvLoading, setCsvLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState(""); // "success" | "error"
  const [importErrors, setImportErrors] = useState([]);

  const showStatus = (msg, type = "success") => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(""), 6000);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pRes, mRes, sRes] = await Promise.all([
        api.get("/api/inventory/products", { params: { low_stock_only: showLowStockOnly, category: filterCategory || undefined } }),
        api.get("/api/inventory/movements", { params: { limit: 30 } }),
        api.get("/api/inventory/summary"),
      ]);
      setProducts(pRes.data);
      setMovements(mRes.data);
      setSummary(sRes.data);
    } catch (err) {
      console.error("Failed to load inventory", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filterCategory, showLowStockOnly]);

  const handleRestock = async (e) => {
    e.preventDefault();
    if (!selectedProduct) return;
    setUpdating(true);
    try {
      await api.post(`/api/inventory/products/${selectedProduct.id}/restock`, {
        quantity: parseInt(restockQty),
        note: restockNote || "Manual restock",
      });
      setSelectedProduct(null);
      setRestockQty(10);
      setRestockNote("");
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || "Restock failed");
    } finally {
      setUpdating(false);
    }
  };

  const handleSetStock = async (e) => {
    e.preventDefault();
    if (!correctProduct) return;
    setUpdating(true);
    try {
      await api.post(`/api/inventory/products/${correctProduct.id}/set-stock`, {
        quantity: parseFloat(correctQty),
        note: correctNote || `Stock corrected to ${correctQty}`,
      });
      setCorrectProduct(null);
      setCorrectQty(0);
      setCorrectNote("");
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || "Correction failed");
    } finally {
      setUpdating(false);
    }
  };

  const handleReportSpoilage = async (e) => {
    e.preventDefault();
    if (!spoilProduct) return;
    setUpdating(true);
    try {
      await api.post(`/api/inventory/products/${spoilProduct.id}/spoilage`, {
        quantity: parseFloat(spoilQty),
        action: spoilAction,
        order_number: spoilOrderNum || null,
        note: spoilNote || null,
      });
      showStatus(`Spoilage logged (${spoilAction})! ${spoilQty} ${spoilProduct.unit}s updated.`, "success");
      setSpoilProduct(null);
      setSpoilQty(1);
      setSpoilAction("discarded");
      setSpoilOrderNum("");
      setSpoilNote("");
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || "Spoilage reporting failed");
    } finally {
      setUpdating(false);
    }
  };



  const handleCreateProduct = async (e) => {
    e.preventDefault();
    setUpdating(true);
    try {
      const payload = {
        ...newProd,
        base_product_id: newProd.base_product_id ? parseInt(newProd.base_product_id) : null,
        unit_multiplier: newProd.base_product_id ? parseFloat(newProd.unit_multiplier) : 1.0,
      };
      await api.post("/api/inventory/products", payload);
      setShowNewModal(false);
      setNewProd({
        name: "", sku: "", category: "General", unit: "unit", unit_price: 500, stock_qty: 20, low_stock_threshold: 10,
        base_product_id: "", unit_multiplier: 1.0
      });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to create product");
    } finally {
      setUpdating(false);
    }
  };

  // CSV handlers
  const handleClearProducts = async () => {
    if (!window.confirm("DANGER: This will delete ALL product catalog items and stock movements. Are you sure?")) return;
    setCsvLoading(true);
    try {
      const { data } = await api.delete("/api/data/clear-products");
      showStatus(data.message, "success");
      fetchData();
    } catch (err) {
      showStatus(err.response?.data?.detail || "Failed to clear products", "error");
    } finally {
      setCsvLoading(false);
    }
  };

  const downloadTemplate = () => {
    const token = localStorage.getItem("sof_token");
    window.open(`${API_BASE}/api/data/template/products?token=${encodeURIComponent(token)}`, "_blank");
  };

  const handleImportProducts = async (file) => {
    if (!file) return;
    setCsvLoading(true);
    setImportErrors([]);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const { data } = await api.post("/api/data/import/products", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      showStatus(data.message, "success");
      if (data.errors?.length > 0) {
        setImportErrors(data.errors);
      }
      fetchData();
    } catch (err) {
      showStatus(err.response?.data?.detail || "Import failed", "error");
    } finally {
      setCsvLoading(false);
    }
  };

  const handleDeleteProduct = async (prodId, prodName) => {
    if (!window.confirm(`Are you sure you want to remove '${prodName}' from the inventory catalog?`)) return;
    try {
      await api.delete(`/api/inventory/products/${prodId}`);
      showStatus(`Product '${prodName}' removed successfully.`, "success");
      fetchData();
    } catch (err) {
      showStatus(err.response?.data?.detail || "Failed to delete product", "error");
    }
  };

  const handleToggleCustomerFacing = async (p) => {
    try {
      await api.put(`/api/inventory/products/${p.id}`, { is_customer_facing: !p.is_customer_facing });
      showStatus(
        !p.is_customer_facing
          ? `'${p.name}' is now visible to the AI agent.`
          : `'${p.name}' hidden from AI agent.`,
        "success"
      );
      fetchData();
    } catch (err) {
      showStatus(err.response?.data?.detail || "Toggle failed", "error");
    }
  };

  const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Boxes className="w-6 h-6 text-brand-400" />
            Stock & Inventory Management
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">
            Real-time stock tracking with auto-deduction & low stock alerts
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Download template */}
          <button
            onClick={downloadTemplate}
            className="btn-secondary text-xs text-brand-300 border-brand-700/50"
            title="Download Excel / CSV template for products"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> Template
          </button>

          {/* Import */}
          <label className="btn-secondary text-xs text-brand-300 border-brand-700/50 cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-amber-400" />
            <span>{csvLoading ? "Processing..." : "Import CSV"}</span>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              disabled={csvLoading}
              onChange={(e) => handleImportProducts(e.target.files[0])}
            />
          </label>

          {/* Clear Catalog */}
          <button
            onClick={handleClearProducts}
            disabled={csvLoading}
            className="btn-secondary text-xs border-red-800/40 text-red-400 hover:bg-red-950/20"
            title="Delete all product catalog entries"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear Products
          </button>

          <button onClick={fetchData} className="btn-secondary text-xs">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={() => setShowNewModal(true)} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5" /> Add Product
          </button>
        </div>
      </div>

      {/* Status Notifications */}
      {statusMsg && (
        <div className={`card border flex items-center gap-3 py-3 ${
          statusType === "success"
            ? "bg-emerald-950/40 border-emerald-700/60 text-emerald-300"
            : "bg-red-950/40 border-red-700/60 text-red-300"
        }`}>
          {statusType === "success"
            ? <CheckCircle className="w-5 h-5 shrink-0" />
            : <AlertTriangle className="w-5 h-5 shrink-0" />
          }
          <p className="text-sm font-medium">{statusMsg}</p>
        </div>
      )}

      {/* Import Errors / Warnings */}
      {importErrors.length > 0 && (
        <div className="card bg-amber-950/30 border-amber-700/50 space-y-2">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Import Warnings ({importErrors.length} products failed)
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {importErrors.map((err, i) => (
              <p key={i} className="text-xs text-amber-300 font-mono">{err}</p>
            ))}
          </div>
        </div>
      )}


      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card bg-surface-900 border-surface-700">
            <p className="text-xs text-brand-500 font-semibold uppercase tracking-wider">Total Products</p>
            <p className="text-2xl font-bold text-white mt-1">{summary.total_products}</p>
            <p className="text-xs text-brand-600 mt-1">Active catalog items</p>
          </div>

          <div className="card bg-surface-900 border-surface-700">
            <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider">Low Stock Alerts</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{summary.low_stock_count}</p>
            <p className="text-xs text-brand-600 mt-1">Items at or below threshold</p>
          </div>

          <div className="card bg-surface-900 border-surface-700">
            <p className="text-xs text-red-400 font-semibold uppercase tracking-wider">Out of Stock</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{summary.out_of_stock_count}</p>
            <p className="text-xs text-brand-600 mt-1">Immediate restock required</p>
          </div>

          <div className="card bg-surface-900 border-surface-700">
            <p className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">Total Inventory Value</p>
            <p className="text-2xl font-bold text-emerald-300 mt-1">PKR {summary.total_inventory_value.toLocaleString()}</p>
            <p className="text-xs text-brand-600 mt-1">Cost value of current stock</p>
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="card flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <select
            className="select w-44"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <button
            onClick={() => setShowLowStockOnly(!showLowStockOnly)}
            className={`btn text-xs ${showLowStockOnly ? "btn-amber" : "btn-secondary"}`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {showLowStockOnly ? "Showing Low Stock Only" : "Filter Low Stock"}
          </button>
        </div>
      </div>

      {/* Main Grid: Product Catalog + Recent Movements */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Product Catalog Table */}
        <div className="card xl:col-span-2 p-0">
          <div className="p-4 border-b border-surface-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Product Inventory</h2>
            <span className="text-xs text-brand-500">{products.length} products</span>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead className="thead">
                <tr>
                  <th className="th">Product / SKU</th>
                  <th className="th">Category</th>
                  <th className="th">Unit Price</th>
                  <th className="th">Stock Level</th>
                  <th className="th">Status</th>
                  <th className="th" title="Whether the AI chatbot (n8n) can see and sell this product">
                    <span className="flex items-center gap-1"><Bot className="w-3.5 h-3.5 text-violet-400" /> AI Visible</span>
                  </th>
                  <th className="th">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="td text-center text-brand-600 py-12">Loading inventory...</td></tr>
                ) : products.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center text-brand-700 py-12">No products found</td></tr>
                ) : (
                  products.map((p) => {
                    const isLow = p.stock_qty <= p.low_stock_threshold;
                    const isZero = p.stock_qty === 0;
                    return (
                      <tr key={p.id} className="tr-hover">
                        <td className="td">
                          <p className="font-semibold text-white">{p.name}</p>
                          {(() => {
                            const parent = p.base_product_id ? products.find((x) => x.id === p.base_product_id) : null;
                            if (parent) {
                              return (
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="text-xs font-mono text-brand-500">{p.sku}</span>
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-brand-950/80 text-brand-400 border border-brand-850">
                                    Subunit ({p.unit_multiplier} per {parent.unit}) of {parent.name}
                                  </span>
                                </div>
                              );
                            } else {
                              const childPacks = products.filter((x) => x.base_product_id === p.id);
                              return (
                                <div className="space-y-1 mt-0.5">
                                  <span className="text-xs font-mono text-brand-500">{p.sku}</span>
                                  {childPacks.length > 0 && (
                                    <div className="text-[10px] text-brand-400 mt-1">
                                      <span className="text-brand-500 font-semibold uppercase block mb-0.5">Available Packs:</span>
                                      <div className="flex flex-wrap gap-1.5">
                                        {childPacks.map((sub) => {
                                          const canMake = Math.floor(p.stock_qty / (sub.unit_multiplier || 1));
                                          return (
                                            <span key={sub.id} className="bg-surface-800 px-1.5 py-0.5 rounded text-brand-300 border border-surface-700">
                                              {sub.name}: <strong className="text-white">{canMake}</strong>
                                            </span>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            }
                          })()}
                        </td>
                        <td className="td text-xs text-brand-400">{p.category}</td>
                        <td className="td font-medium text-brand-300">PKR {p.unit_price.toLocaleString()}</td>
                        <td className="td">
                          <div className="space-y-1">
                            <span className="text-sm font-bold text-white">{p.stock_qty} {p.unit}s</span>
                            <div className="w-24 h-1.5 rounded-full bg-surface-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isZero ? "bg-red-500" : isLow ? "bg-amber-400" : "bg-emerald-500"}`}
                                style={{ width: `${Math.min(100, (p.stock_qty / (p.low_stock_threshold * 3)) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="td">
                          {isZero ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-red-900/40 text-red-400 border border-red-700/50">
                              Out of Stock
                            </span>
                          ) : isLow ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-900/40 text-amber-400 border border-amber-700/50">
                              Low Stock ({p.low_stock_threshold})
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-900/40 text-emerald-400 border border-emerald-700/50">
                              In Stock
                            </span>
                          )}
                        </td>
                        {/* AI Visible Toggle */}
                        <td className="td">
                          {canManage ? (
                            <button
                              onClick={() => handleToggleCustomerFacing(p)}
                              title={p.is_customer_facing ? "Click to hide from AI" : "Click to show to AI"}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase border transition-all ${
                                p.is_customer_facing
                                  ? "bg-violet-900/40 text-violet-300 border-violet-700/60 hover:bg-violet-900/70"
                                  : "bg-surface-800 text-brand-600 border-surface-700 hover:bg-surface-700"
                              }`}
                            >
                              {p.is_customer_facing ? <Bot className="w-3 h-3" /> : <BotOff className="w-3 h-3" />}
                              {p.is_customer_facing ? "ON" : "OFF"}
                            </button>
                          ) : (
                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                              p.is_customer_facing ? "text-violet-400" : "text-brand-700"
                            }`}>
                              {p.is_customer_facing ? "Visible" : "Hidden"}
                            </span>
                          )}
                        </td>
                        <td className="td">
                          <div className="flex flex-col gap-1.5">
                            <button
                              onClick={() => { setSelectedProduct(p); setRestockQty(10); setRestockNote(""); }}
                              className="btn-secondary text-xs px-2.5 py-1 border-brand-700/60 text-brand-300"
                            >
                              + Restock
                            </button>
                            <button
                              onClick={() => { setSpoilProduct(p); setSpoilQty(1); setSpoilNote(""); }}
                              className="btn-secondary text-xs px-2.5 py-1 border-red-900/40 text-red-400 hover:bg-red-950/20"
                              title="Report spoiled or broken stock"
                            >
                              Spoilage
                            </button>
                            {!p.base_product_id && (
                              <button
                                onClick={() => { setCorrectProduct(p); setCorrectQty(p.stock_qty); setCorrectNote(""); }}
                                className="btn-secondary text-xs px-2.5 py-1 border-amber-800/40 text-amber-400 hover:bg-amber-950/20"
                                title="Set exact stock value (fix wrong totals)"
                              >
                                Correct
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteProduct(p.id, p.name)}
                              className="btn-secondary text-xs px-2.5 py-1 border-red-950 text-red-400 hover:bg-red-950/30 flex items-center justify-center gap-1"
                              title="Delete or deactivate this product"
                            >
                              <Trash2 className="w-3 h-3" /> Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Audit Log / Movement History */}
        <div className="card space-y-4 xl:col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Stock Audit Log</h2>
            <span className="text-xs text-brand-600">Latest 30</span>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {movements.length === 0 ? (
              <p className="text-brand-600 text-xs text-center py-8">No movement history yet</p>
            ) : (
              movements.map((m) => {
                const isSale = m.quantity_change < 0;
                return (
                  <div key={m.id} className="p-3 bg-surface-800 rounded-xl border border-surface-700 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">Product #{m.product_id}</span>
                      <span className={`text-xs font-bold flex items-center gap-0.5 ${isSale ? "text-red-400" : "text-emerald-400"}`}>
                        {isSale ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        {m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}
                      </span>
                    </div>
                    <p className="text-xs text-brand-400">{m.note || m.movement_type}</p>
                    <div className="flex items-center justify-between text-[10px] text-brand-600 pt-1 border-t border-surface-700/60">
                      <span>After: {m.quantity_after} units</span>
                      <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Restock Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-md space-y-4 bg-surface-900 border-surface-700">
            <h2 className="text-lg font-bold text-white">Restock {selectedProduct.name}</h2>
            <p className="text-xs text-brand-400">Current Stock: <span className="font-bold text-white">{selectedProduct.stock_qty} {selectedProduct.unit}s</span></p>

            <form onSubmit={handleRestock} className="space-y-4">
              <div>
                <label className="label">Quantity to Add</label>
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={restockQty}
                  onChange={(e) => setRestockQty(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Note / Supplier Reference</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Shipment received from Lahore Supplier"
                  value={restockNote}
                  onChange={(e) => setRestockNote(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setSelectedProduct(null)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={updating} className="btn-primary">
                  {updating ? "Saving..." : "Confirm Restock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Correct Stock Modal — sets to EXACT value */}
      {correctProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-md space-y-4 bg-surface-900 border-amber-900/30 border">
            <div>
              <h2 className="text-lg font-bold text-white">Correct Stock — {correctProduct.name}</h2>
              <p className="text-xs text-amber-400 mt-1">
                Sets stock to an <strong>exact value</strong>. Use this to fix doubled or wrong totals.
              </p>
              <p className="text-xs text-brand-500 mt-0.5">
                Current system stock: <span className="font-bold text-white">{correctProduct.stock_qty} {correctProduct.unit}s</span>
              </p>
            </div>

            <form onSubmit={handleSetStock} className="space-y-4">
              <div>
                <label className="label">Set Stock To (exact quantity)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="input border-amber-800/40"
                  value={correctQty}
                  onChange={e => setCorrectQty(e.target.value)}
                  required
                />
                {parseFloat(correctQty) !== correctProduct.stock_qty && (
                  <p className="text-xs mt-1">
                    Change: <span className={parseFloat(correctQty) > correctProduct.stock_qty ? "text-emerald-400" : "text-red-400"}>
                      {parseFloat(correctQty) > correctProduct.stock_qty ? "+" : ""}
                      {(parseFloat(correctQty) - correctProduct.stock_qty).toFixed(1)} {correctProduct.unit}s
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label className="label">Reason / Note</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Fixing doubled stock from initial entry"
                  value={correctNote}
                  onChange={e => setCorrectNote(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setCorrectProduct(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={updating} className="btn-primary bg-amber-600 hover:bg-amber-500 border-amber-600">
                  {updating ? "Saving..." : "Set Exact Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Spoilage / Broken Stock Modal */}
      {spoilProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-md space-y-4 bg-surface-900 border-red-900/40 border">
            <div>
              <h2 className="text-lg font-bold text-white">Report Spoilage — {spoilProduct.name}</h2>
              <p className="text-xs text-red-400 mt-1">
                Deducts spoiled or broken units from stock and recalculates all available packs.
              </p>
              <p className="text-xs text-brand-500 mt-0.5">
                Current available stock: <span className="font-bold text-white">{spoilProduct.stock_qty} {spoilProduct.unit}s</span>
              </p>
            </div>

            <form onSubmit={handleReportSpoilage} className="space-y-4">
              <div>
                <label className="label">Quantity Spoiled / Broken ({spoilProduct.unit}s)</label>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  className="input border-red-800/40"
                  value={spoilQty}
                  onChange={(e) => setSpoilQty(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Action Taken / Stock Disposition</label>
                <select
                  className="select border-red-800/40"
                  value={spoilAction}
                  onChange={(e) => setSpoilAction(e.target.value)}
                >
                  <option value="discarded">Discarded / Dumped (Waste Loss)</option>
                  <option value="sent_in_order">Sent in Customer Order (Repurposed / Sent Broken)</option>
                  <option value="staff_use">Staff / Internal Usage</option>
                  <option value="returned_to_supplier">Returned to Supplier</option>
                  <option value="other">Other Action</option>
                </select>
              </div>

              {spoilAction === "sent_in_order" && (
                <div>
                  <label className="label text-amber-400 font-semibold">Associated Order # (Optional)</label>
                  <input
                    type="text"
                    className="input border-amber-800/40"
                    placeholder="e.g. ORD-1004"
                    value={spoilOrderNum}
                    onChange={(e) => setSpoilOrderNum(e.target.value)}
                  />
                </div>
              )}

              <div>
                <label className="label">Inspection Note / Details</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. 50 eggs damaged during shipment transport"
                  value={spoilNote}
                  onChange={(e) => setSpoilNote(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setSpoilProduct(null)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={updating} className="btn-primary bg-red-700 hover:bg-red-600 border-red-700">
                  {updating ? "Logging..." : "Confirm Spoilage Deduction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Product Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-md space-y-4 bg-surface-900 border-surface-700">
            <h2 className="text-lg font-bold text-white">Add New Product Catalog Item</h2>

            <form onSubmit={handleCreateProduct} className="space-y-3">
              <div>
                <label className="label">Product Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Organic Honey 1kg"
                  value={newProd.name}
                  onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">SKU Code</label>
                  <input
                    type="text"
                    className="input font-mono"
                    placeholder="NOF-HNY-1K"
                    value={newProd.sku}
                    onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Category</label>
                  <input
                    type="text"
                    className="input"
                    value={newProd.category}
                    onChange={(e) => setNewProd({ ...newProd, category: e.target.value })}
                  />
                </div>
              </div>

              {!newProd.base_product_id && (
                <div className="bg-surface-850 p-3 rounded-xl border border-surface-800 space-y-2">
                  <p className="text-xs font-semibold text-brand-400">Purchase Cost Calculator (Optional)</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-[11px] text-brand-500">Total Purchase (PKR)</label>
                      <input
                        type="number"
                        className="input text-xs py-1"
                        placeholder="e.g. 1500000"
                        onChange={(e) => {
                          const cost = parseFloat(e.target.value);
                          const qty = newProd.stock_qty;
                          if (cost > 0 && qty > 0) {
                            setNewProd((p) => ({ ...p, unit_price: Math.round((cost / qty) * 100) / 100 }));
                          }
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-brand-500">Bulk Qty Received</label>
                      <input
                        type="number"
                        className="input text-xs py-1"
                        placeholder="e.g. 3000"
                        value={newProd.stock_qty}
                        onChange={(e) => setNewProd({ ...newProd, stock_qty: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Unit of Measure</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. egg, pack of 6, kg, g"
                    value={newProd.unit}
                    onChange={(e) => setNewProd({ ...newProd, unit: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Calculated Unit Price (PKR)</label>
                  <input
                    type="number"
                    step="any"
                    className="input"
                    value={newProd.unit_price}
                    onChange={(e) => setNewProd({ ...newProd, unit_price: parseFloat(e.target.value) })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Initial Stock</label>
                  <input
                    type="number"
                    className="input"
                    value={newProd.stock_qty}
                    onChange={(e) => setNewProd({ ...newProd, stock_qty: parseInt(e.target.value) })}
                    required
                    disabled={!!newProd.base_product_id}
                  />
                </div>
                <div>
                  <label className="label">Low Alert Qty</label>
                  <input
                    type="number"
                    className="input"
                    value={newProd.low_stock_threshold}
                    onChange={(e) => setNewProd({ ...newProd, low_stock_threshold: parseInt(e.target.value) })}
                    required
                  />
                </div>
              </div>

              <div className="border-t border-surface-850 pt-3 mt-2 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_subunit"
                    className="rounded border-surface-700 bg-surface-800 text-brand-600 focus:ring-brand-500"
                    checked={!!newProd.base_product_id}
                    onChange={(e) => {
                      setNewProd({
                        ...newProd,
                        base_product_id: e.target.checked ? (products[0]?.id || "temp") : "",
                        unit_multiplier: e.target.checked ? 1.0 : 1.0,
                        stock_qty: e.target.checked ? 0 : newProd.stock_qty
                      });
                    }}
                  />
                  <label htmlFor="is_subunit" className="text-xs font-semibold text-brand-350 select-none">
                    Is this a pack or subunit of another bulk product?
                  </label>
                </div>

                {!!newProd.base_product_id && (
                  <div className="grid grid-cols-2 gap-3 bg-surface-850 p-3 rounded-xl border border-surface-800">
                    <div>
                      <label className="label">Parent Bulk Product</label>
                      <select
                        className="select text-xs"
                        value={newProd.base_product_id === "temp" ? "" : newProd.base_product_id}
                        onChange={(e) => setNewProd({ ...newProd, base_product_id: e.target.value })}
                        required
                      >
                        <option value="">Choose Parent Product</option>
                        {products
                          .filter((p) => !p.base_product_id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.sku})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Multiplier (Qty per pack)</label>
                      <input
                        type="number"
                        step="any"
                        className="input"
                        placeholder="e.g. 6.0 for pack of 6"
                        value={newProd.unit_multiplier}
                        onChange={(e) => setNewProd({ ...newProd, unit_multiplier: parseFloat(e.target.value) || 1.0 })}
                        required
                      />
                      <span className="text-[9px] text-brand-500 mt-1 block">
                        Example: Pack of 6 eggs = 6.0, 800g Oil = 0.8 (if bulk is in kg).
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button type="button" onClick={() => setShowNewModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={updating} className="btn-primary">
                  {updating ? "Creating..." : "Save Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
