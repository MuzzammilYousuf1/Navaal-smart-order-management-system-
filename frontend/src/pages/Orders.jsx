import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Filter, RefreshCw, Plus, ChevronRight, FileSpreadsheet,
  Upload, Download, Trash2, CheckCircle, AlertTriangle, MapPin, Edit3, Truck, Package
} from "lucide-react";
import api from "../api/client";
import { StatusBadge, PriorityBadge, PaymentBadge } from "../components/StatusBadge";
import LiveTimer from "../components/LiveTimer";
import EditOrderModal from "../components/EditOrderModal";
import RiderGatePassModal from "../components/RiderGatePassModal";
import { format } from "date-fns";
import { API_BASE } from "../api/client";

// Channel badge helper
function ChannelBadge({ source }) {
  const styles = {
    b2b:       "bg-purple-900/40 text-purple-300 border-purple-700/50",
    b2c:       "bg-sky-900/40 text-sky-300 border-sky-700/50",
    whatsapp:  "bg-emerald-900/40 text-emerald-300 border-emerald-700/50",
    website:   "bg-brand-900/40 text-brand-300 border-brand-700/50",
    phone:     "bg-amber-900/40 text-amber-300 border-amber-700/50",
    facebook:  "bg-blue-900/40 text-blue-300 border-blue-700/50",
    instagram: "bg-pink-900/40 text-pink-300 border-pink-700/50",
    walk_in:   "bg-orange-900/40 text-orange-300 border-orange-700/50",
  };
  const label = { b2b: "B2B", b2c: "B2C", walk_in: "Walk-in" }[source] || (source || "—");
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${styles[source] || "bg-surface-800 text-brand-500 border-surface-600"}`}>
      {label}
    </span>
  );
}

const STATUS_OPTIONS = [
  { value: "",                label: "All Statuses" },
  { value: "pending",         label: "Pending" },
  { value: "ready_to_ship",   label: "Ready to Ship" },
  { value: "out_for_delivery",label: "Out for Delivery" },
  { value: "delivered",       label: "Delivered" },
  { value: "returned",        label: "Returned" },
  { value: "cancelled",       label: "Cancelled" },
];

const DATE_OPTIONS = [
  { value: "",          label: "All Time" },
  { value: "today",     label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week",      label: "This Week" },
  { value: "late",      label: "Late Orders" },
];

const SOURCE_OPTIONS = [
  { value: "",          label: "All Channels" },
  { value: "b2b",       label: "B2B Sales" },
  { value: "b2c",       label: "B2C / Retail" },
  { value: "whatsapp",  label: "WhatsApp" },
  { value: "website",   label: "Website" },
  { value: "phone",     label: "Phone" },
  { value: "walk_in",   label: "Walk-in" },
  { value: "facebook",  label: "Facebook" },
  { value: "instagram", label: "Instagram" },
];

const PAYMENT_OPTIONS = [
  { value: "",       label: "All Payments" },
  { value: "cod",    label: "COD" },
  { value: "received", label: "Payment Received" },
  { value: "credit", label: "Credit" },
  { value: "returned", label: "Returned" },
];

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    status:      searchParams.get("status") || "",
    date_filter: "",
    source:      "",
    payment_status: "",
  });
  const navigate = useNavigate();

  // CSV & Gate Pass state
  const [csvLoading, setCsvLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState("");
  const [importErrors, setImportErrors] = useState([]);
  const [editingOrder, setEditingOrder] = useState(null);
  const [showGatePassModal, setShowGatePassModal] = useState(false);

  const showStatus = (msg, type = "success") => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(""), 6000);
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters };
      if (search) params.search = search;
      Object.keys(params).forEach((k) => !params[k] && delete params[k]);
      const { data } = await api.get("/api/orders/", { params });
      setOrders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filters, search]);

  useEffect(() => {
    const timer = setTimeout(fetchOrders, 300);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  const handleBulkRts = async () => {
    if (!window.confirm("📦 Convert ALL pending orders to 'Ready to Ship' (Fast Packaging RTS)?")) return;
    setCsvLoading(true);
    try {
      const { data } = await api.post("/api/orders/bulk-rts", { note: "Fast Packaging Bulk RTS" });
      showStatus(`✅ ${data.message}`, "success");
      fetchOrders();
    } catch (err) {
      showStatus(`❌ ${err.response?.data?.detail || "Bulk RTS failed"}`, "error");
    } finally {
      setCsvLoading(false);
    }
  };

  const setFilter = (key, val) => setFilters((f) => ({ ...f, [key]: val }));

  // CSV handlers
  const handleClearOrders = async () => {
    if (!window.confirm("⚠️ DANGER: This will permanently DELETE all orders and status history. Products and users will remain. Are you sure?")) return;
    setCsvLoading(true);
    try {
      const { data } = await api.delete("/api/data/clear-orders");
      showStatus(`✅ ${data.message}`, "success");
      fetchOrders();
    } catch (err) {
      showStatus(`❌ ${err.response?.data?.detail || "Failed to clear orders"}`, "error");
    } finally {
      setCsvLoading(false);
    }
  };

  const downloadTemplate = () => {
    const token = localStorage.getItem("sof_token");
    window.open(`${API_BASE}/api/data/template/orders?token=${encodeURIComponent(token)}`, "_blank");
  };

  const handleExportOrders = () => {
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

  const handleImportOrders = async (file) => {
    if (!file) return;
    setCsvLoading(true);
    setImportErrors([]);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const { data } = await api.post("/api/data/import/orders", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const fmtLabel = { b2b_sales: "B2B Sales", daily_orders: "Daily Orders", generic: "Generic" }[data.format_detected] || data.format_detected;
      showStatus(`✅ ${data.message} (Detected format: ${fmtLabel})`, "success");
      if (data.errors?.length > 0) {
        setImportErrors(data.errors);
      }
      fetchOrders();
    } catch (err) {
      showStatus(`❌ ${err.response?.data?.detail || "Import failed"}`, "error");
    } finally {
      setCsvLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 pt-14 sm:pt-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Orders</h1>
          <p className="text-brand-500 text-sm mt-0.5">{orders.length} order{orders.length !== 1 ? "s" : ""} found</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Fast Auto RTS */}
          <button
            onClick={handleBulkRts}
            disabled={csvLoading}
            className="btn-secondary text-xs text-amber-300 border-amber-800/60 bg-amber-950/30 hover:bg-amber-900/40"
            title="Mark all pending orders as Ready to Ship"
          >
            <Package className="w-3.5 h-3.5 text-amber-400" /> Auto RTS All
          </button>

          {/* Rider Gate Pass Modal */}
          <button
            onClick={() => setShowGatePassModal(true)}
            className="btn-secondary text-xs text-emerald-300 border-emerald-800/60 bg-emerald-950/30 hover:bg-emerald-900/40"
            title="Create rider gate pass slips & set orders out for delivery"
          >
            <Truck className="w-3.5 h-3.5 text-emerald-400" /> Rider Gate Pass
          </button>

          {/* Export */}
          <button
            onClick={handleExportOrders}
            className="btn-secondary text-xs text-brand-300 border-brand-700/50"
            title="Download CSV backup of all current orders"
          >
            <Download className="w-3.5 h-3.5 text-brand-400" /> Export CSV
          </button>

          {/* Download template */}
          <button
            onClick={downloadTemplate}
            className="btn-secondary text-xs text-brand-300 border-brand-700/50"
            title="Download Excel / CSV template for importing orders"
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
              onChange={(e) => handleImportOrders(e.target.files[0])}
            />
          </label>

          {/* Clear Orders */}
          <button
            onClick={handleClearOrders}
            disabled={csvLoading}
            className="btn-secondary text-xs border-red-800/40 text-red-400 hover:bg-red-950/20"
            title="Delete all current orders (Full Reset)"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear Orders
          </button>

          {/* New Order */}
          <button onClick={() => navigate("/orders/new")} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5" /> New Order
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
            <AlertTriangle className="w-4 h-4" /> Import Warnings ({importErrors.length} rows failed)
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {importErrors.map((err, i) => (
              <p key={i} className="text-xs text-amber-300 font-mono">{err}</p>
            ))}
          </div>
        </div>
      )}


      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative w-full sm:flex-1 sm:min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-600" />
            <input
              className="input pl-9"
              placeholder="Search by name, phone, order #, city, rider..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select className="select w-full sm:w-40" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select className="select w-full sm:w-36" value={filters.date_filter} onChange={(e) => setFilter("date_filter", e.target.value)}>
            {DATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select className="select w-full sm:w-36" value={filters.source} onChange={(e) => setFilter("source", e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select className="select w-full sm:w-36" value={filters.payment_status} onChange={(e) => setFilter("payment_status", e.target.value)}>
            {PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <button onClick={() => setFilters({ status:"", date_filter:"", source:"", payment_status:"" })} className="btn-secondary text-xs text-brand-500">
            Clear
          </button>
          <button onClick={fetchOrders} className="btn-secondary">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <thead className="thead">
              <tr>
                <th className="th">Order #</th>
                <th className="th">Customer</th>
                <th className="th">Location</th>
                <th className="th">Channel</th>
                <th className="th">Status</th>
                <th className="th">Payment</th>
                <th className="th text-right">Amount Due</th>
                <th className="th text-right">Received</th>
                <th className="th">Rider</th>
                <th className="th">Date</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="td text-center text-brand-600 py-12">Loading...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={11} className="td text-center text-brand-700 py-12">No orders found</td></tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    className={`tr-hover ${order.status === "ready_to_ship" && !order.pickup_deadline ? "" :
                      order.status === "ready_to_ship" && new Date(order.pickup_deadline + "Z") < new Date()
                        ? "bg-red-900/10" : ""
                    }`}
                    onClick={() => navigate(`/orders/${order.id}`)}
                  >
                    <td className="td font-bold text-brand-300 font-mono text-xs">{order.order_number}</td>
                    <td className="td">
                      <p className="font-medium text-white">{order.customer_name}</p>
                      <p className="text-xs text-brand-600">{order.customer_phone}</p>
                    </td>
                    <td className="td text-brand-400 text-xs max-w-[150px]" title={order.delivery_address || order.city}>
                      {order.city || order.delivery_address || "—"}
                    </td>
                    <td className="td"><ChannelBadge source={order.source} /></td>
                    <td className="td"><StatusBadge status={order.status} /></td>
                    <td className="td"><PaymentBadge payment_status={order.payment_status} /></td>
                    <td className="td text-right text-brand-300 font-semibold whitespace-nowrap">PKR {(order.total_amount || 0).toLocaleString()}</td>
                    <td className="td text-right text-brand-300 font-semibold whitespace-nowrap">PKR {(order.amount_received || 0).toLocaleString()}</td>
                    <td className="td">
                      <span className="text-xs font-medium text-brand-300">{order.assigned_rider_name || <span className="text-brand-700">—</span>}</span>
                    </td>
                    <td className="td">
                      {order.status === "ready_to_ship" ? (
                        <LiveTimer pickupDeadline={order.pickup_deadline} status={order.status} />
                      ) : (
                        <span className="text-xs text-brand-600">
                          {order.created_at ? format(new Date(order.created_at + "Z"), "dd MMM, HH:mm") : "—"}
                        </span>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingOrder(order);
                          }}
                          className="p-1 rounded text-brand-500 hover:text-white hover:bg-surface-700"
                          title="Edit Order"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-brand-600" />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Order Modal */}
      <EditOrderModal
        order={editingOrder}
        isOpen={Boolean(editingOrder)}
        onClose={() => setEditingOrder(null)}
        onSaveSuccess={fetchOrders}
      />

      {/* Rider Gate Pass Modal */}
      <RiderGatePassModal
        isOpen={showGatePassModal}
        onClose={() => setShowGatePassModal(false)}
        onDispatchSuccess={fetchOrders}
      />
    </div>
  );
}
