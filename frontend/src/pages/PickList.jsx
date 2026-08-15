import { useEffect, useState } from "react";
import { ClipboardList, Printer, CheckCircle, Package, ArrowRight, QrCode } from "lucide-react";
import api from "../api/client";
import { useNavigate } from "react-router-dom";

export default function PickList() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const navigate = useNavigate();

  const fetchPendingOrders = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/orders", { params: { status: "pending", limit: 100 } });
      setOrders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingOrders();
  }, []);

  const handleMarkRTS = async (orderId) => {
    setUpdatingId(orderId);
    try {
      await api.post(`/api/orders/${orderId}/status`, {
        new_status: "ready_to_ship",
        note: "Packed via Batch Pick List",
      });
      fetchPendingOrders();
    } catch (err) {
      alert(err.response?.data?.detail || "Status update failed");
    } finally {
      setUpdatingId(null);
    }
  };

  // Consolidate item totals across all pending orders
  const itemConsolidation = {};
  orders.forEach((o) => {
    (o.items || []).forEach((item) => {
      if (!itemConsolidation[item.product_name]) {
        itemConsolidation[item.product_name] = 0;
      }
      itemConsolidation[item.product_name] += item.quantity;
    });
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-amber-400" />
            Warehouse Batch Pick List & Packing Verification
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">
            Consolidated inventory pick list for warehouse staff — pack faster with zero errors
          </p>
        </div>
        <div className="flex items-center gap-3 print:hidden">
          <button onClick={() => navigate("/scan")} className="btn-secondary text-brand-300 border-brand-700/60">
            <QrCode className="w-4 h-4 text-emerald-400" /> Open Camera / Barcode Scanner
          </button>
          <button onClick={handlePrint} className="btn-primary">
            <Printer className="w-4 h-4" /> Print Pick Sheet
          </button>
        </div>
      </div>

      {/* Master Item Pick Summary */}
      <div className="card space-y-4 bg-gradient-to-r from-amber-950/30 via-surface-900 to-surface-800 border-amber-800/40">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-amber-300">Total Items to Pick ({Object.keys(itemConsolidation).length} unique items)</h2>
            <p className="text-xs text-brand-400">Total items required from warehouse shelves to fulfill all {orders.length} pending orders</p>
          </div>
          <span className="px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full font-bold text-sm font-mono border border-amber-500/30">
            {orders.length} Orders Pending
          </span>
        </div>

        {loading ? (
          <p className="text-brand-600 text-xs py-4 text-center">Calculating pick list...</p>
        ) : Object.keys(itemConsolidation).length === 0 ? (
          <p className="text-brand-500 text-xs py-4 text-center">No pending orders to pack! All caught up. 🎉</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {Object.entries(itemConsolidation).map(([name, qty]) => (
              <div key={name} className="p-3 bg-surface-900/90 rounded-xl border border-surface-700 flex items-center justify-between">
                <span className="text-sm font-semibold text-white truncate max-w-[180px]">{name}</span>
                <span className="px-2.5 py-1 bg-brand-600 text-white rounded-lg font-mono text-sm font-bold">
                  × {qty}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Orders Detail Cards for Packing */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Individual Orders to Pack ({orders.length})</h2>

        {loading ? (
          <div className="card text-center text-brand-600 py-12">Loading order pick list...</div>
        ) : orders.length === 0 ? (
          <div className="card text-center text-brand-600 py-12">No orders pending packing.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {orders.map((o) => (
              <div key={o.id} className="card space-y-3 bg-surface-900 border-surface-700 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-2 border-b border-surface-700">
                    <span className="font-mono font-bold text-brand-300 text-sm">{o.order_number}</span>
                    <span className="text-xs text-brand-500">{o.city || "Lahore"}</span>
                  </div>

                  <div className="mt-2 space-y-1">
                    <p className="text-sm font-semibold text-white">{o.customer_name}</p>
                    <p className="text-xs text-brand-500">{o.delivery_address}</p>
                  </div>

                  <div className="mt-3 pt-2 border-t border-surface-800 space-y-1.5">
                    <p className="text-[11px] font-bold text-brand-400 uppercase tracking-wider">Items in Order:</p>
                    {(o.items || []).map((it) => (
                      <div key={it.id} className="flex justify-between text-xs text-brand-200 bg-surface-800/80 px-2 py-1 rounded">
                        <span>{it.product_name}</span>
                        <span className="font-mono font-bold text-brand-400">× {it.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-surface-700 flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400">PKR {o.total_amount?.toLocaleString()}</span>

                  <button
                    onClick={() => handleMarkRTS(o.id)}
                    disabled={updatingId === o.id}
                    className="btn-amber text-xs py-1.5 px-3"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {updatingId === o.id ? "Packing..." : "Mark Packed (RTS)"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
