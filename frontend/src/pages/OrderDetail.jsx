import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Package, MapPin, Phone, User, Truck, CreditCard,
  Edit3, CheckCircle, Clock, AlertCircle, Ban, Send, Download, Printer, QrCode, ExternalLink
} from "lucide-react";
import api, { API_BASE } from "../api/client";
import { StatusBadge, PriorityBadge, PaymentBadge } from "../components/StatusBadge";
import OrderTimeline from "../components/OrderTimeline";
import LiveTimer from "../components/LiveTimer";
import EditOrderModal from "../components/EditOrderModal";
import { format } from "date-fns";

// What status buttons to show based on current status
const NEXT_ACTIONS = {
  pending:          [{ status: "ready_to_ship",   label: "Mark Ready to Ship",    icon: Package,      cls: "btn-amber" },
                     { status: "cancelled",        label: "Cancel Order",          icon: Ban,          cls: "btn-danger" }],
  ready_to_ship:    [{ status: "out_for_delivery", label: "Mark Out for Delivery", icon: Truck,        cls: "btn-primary" },
                     { status: "cancelled",        label: "Cancel Order",          icon: Ban,          cls: "btn-danger" }],
  out_for_delivery: [],
  delivered:        [],
  cancelled:        [],
};

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-surface-800 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-brand-500" />
      </div>
      <div>
        <p className="text-xs text-brand-600">{label}</p>
        <p className="text-sm text-white font-medium">{value || "—"}</p>
      </div>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState("");
  const [riderName, setRiderName] = useState("");
  const [error, setError] = useState("");
  const [deliveryOutcome, setDeliveryOutcome] = useState("delivered");
  const [paymentMethod, setPaymentMethod] = useState("cod");
  const [amountReceived, setAmountReceived] = useState("");
  const [isEditOpen, setIsEditOpen] = useState(false);

  const fetchOrder = async () => {
    try {
      const { data } = await api.get(`/api/orders/${id}`);
      setOrder(data);
      setRiderName(data.assigned_rider_name || "");
      setPaymentMethod(data.payment_method || "cod");
      if (data.amount_received) setAmountReceived(String(data.amount_received));
    } catch {
      setError("Order not found");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrder(); }, [id]);

  const handleStatusChange = async (newStatus) => {
    setUpdating(true);
    setError("");
    try {
      // If moving to OFD, save rider name first
      if (newStatus === "out_for_delivery" && riderName && riderName !== order.assigned_rider_name) {
        await api.put(`/api/orders/${id}`, { assigned_rider_name: riderName });
      }
      await api.post(`/api/orders/${id}/status`, { new_status: newStatus, note });
      setNote("");
      await fetchOrder();
    } catch (err) {
      setError(err.response?.data?.detail || "Status update failed");
    } finally {
      setUpdating(false);
    }
  };

  const completeDelivery = async () => {
    setUpdating(true);
    setError("");
    try {
      await api.post(`/api/orders/${id}/complete-delivery`, {
        outcome: deliveryOutcome,
        payment_method: deliveryOutcome === "delivered" ? paymentMethod : null,
        amount_received: deliveryOutcome === "delivered" ? Number(amountReceived) : 0,
        note,
      });
      setNote("");
      await fetchOrder();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not complete delivery");
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-brand-500 animate-pulse">Loading order...</p>
    </div>
  );

  if (error && !order) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="card text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-red-300">{error}</p>
        <button onClick={() => navigate("/orders")} className="btn-secondary mt-4 mx-auto">Back to Orders</button>
      </div>
    </div>
  );

  const actions = NEXT_ACTIONS[order.status] || [];

  const formatTs = (ts) =>
    ts ? format(new Date(ts + (ts.endsWith("Z") ? "" : "Z")), "dd MMM yyyy, HH:mm:ss") : "—";

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 pt-11 md:pt-0">
        <button onClick={() => navigate("/orders")} className="btn-ghost">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-white font-mono">{order.order_number}</h1>
            <StatusBadge status={order.status} />
            <PriorityBadge priority={order.priority} />
            <PaymentBadge payment_status={order.payment_status} />
          </div>
          <p className="text-brand-500 text-sm mt-0.5">Created {formatTs(order.created_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={() => setIsEditOpen(true)}
            className="btn-primary text-xs"
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit Order
          </button>
          <button
            onClick={() => {
              const token = localStorage.getItem("sof_token");
              window.open(`${API_BASE}/api/invoices/${order.id}/pdf?token=${encodeURIComponent(token)}`, "_blank");
            }}
            className="btn-secondary text-xs text-brand-300 border-brand-700/60"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" /> A4 Invoice
          </button>
          <button
            onClick={() => {
              const token = localStorage.getItem("sof_token");
              window.open(`${API_BASE}/api/invoices/${order.id}/receipt?token=${encodeURIComponent(token)}`, "_blank");
            }}
            className="btn-secondary text-xs text-brand-300 border-brand-700/60"
          >
            <Printer className="w-3.5 h-3.5 text-amber-400" /> Thermal Receipt
          </button>
        </div>
        {order.status === "ready_to_ship" && (
          <div className="card py-3 px-4 shrink-0">
            <p className="text-xs text-brand-500 mb-1">Pickup Window</p>
            <LiveTimer pickupDeadline={order.pickup_deadline} status={order.status} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-5">

          {/* Customer + Delivery */}
          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Customer & Delivery</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoRow icon={User}    label="Customer Name"     value={order.customer_name} />
              <InfoRow icon={Phone}   label="Phone"             value={order.customer_phone} />
              <InfoRow icon={MapPin}  label="Delivery Address"  value={order.delivery_address} />
              <InfoRow icon={MapPin}  label="City"              value={order.city} />
              <InfoRow icon={Truck}   label="Assigned Rider"    value={order.assigned_rider_name} />
              <InfoRow icon={CreditCard} label="Source"         value={order.source?.replace("_", " ")} />
              <InfoRow icon={CreditCard} label="Amount Due"     value={`PKR ${(order.total_amount || 0).toLocaleString()}`} />
              <InfoRow icon={CreditCard} label="Amount Received" value={`PKR ${(order.amount_received || 0).toLocaleString()}`} />
            </div>
            {order.location_url && <a href={order.location_url} target="_blank" rel="noreferrer" className="btn-primary w-full sm:w-auto">
              <MapPin className="w-4 h-4" /> Open Customer Location <ExternalLink className="w-3.5 h-3.5" />
            </a>}
            {order.notes && (
              <div className="bg-surface-800 rounded-xl p-3">
                <p className="text-xs text-brand-500 mb-1">Notes</p>
                <p className="text-sm text-brand-200">{order.notes}</p>
              </div>
            )}
          </div>

          {/* Items */}
          <div className="card">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-4">Order Items</h2>
            {order.items?.length === 0 ? (
              <p className="text-brand-600 text-sm">No items recorded.</p>
            ) : (
              <div className="space-y-2">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between bg-surface-800 rounded-xl p-3">
                    <div>
                      <p className="text-sm font-medium text-white">{item.product_name}</p>
                      <p className="text-xs text-brand-600">Qty: {item.quantity} × PKR {item.unit_price.toLocaleString()}</p>
                    </div>
                    <p className="text-sm font-semibold text-brand-300">PKR {item.total_price.toLocaleString()}</p>
                  </div>
                ))}
                <div className="flex justify-end pt-2 border-t border-surface-700 mt-2">
                  <div className="text-right">
                    <p className="text-xs text-brand-500">Total</p>
                    <p className="text-xl font-bold text-brand-300">PKR {order.total_amount?.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Timestamps & Delivery Duration Chain */}
          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Auto-Saved Timestamps & Fulfillment Speed</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Order Created",    ts: order.created_at },
                { label: "Ready to Ship",    ts: order.rts_at },
                { label: "Out for Delivery", ts: order.pickup_at },
                { label: "Delivered",        ts: order.delivered_at },
              ].map(({ label, ts }) => (
                <div key={label} className="bg-surface-800 rounded-xl p-3">
                  <p className="text-xs text-brand-600 mb-1">{label}</p>
                  <p className="text-sm font-mono text-brand-200">{ts ? formatTs(ts) : <span className="text-brand-700">Not yet</span>}</p>
                </div>
              ))}
            </div>

            {/* Delivery Duration Breakdown Chain */}
            <div className="p-3 bg-surface-800/80 rounded-xl border border-surface-700 space-y-2">
              <p className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Stage Time Breakdown
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                <div className="bg-surface-900 p-2 rounded border border-surface-700">
                  <span className="text-brand-500 block text-[10px]">Packing (Created→RTS)</span>
                  <span className="text-white font-bold">{
                    order.created_at && order.rts_at
                      ? `${Math.round((new Date(order.rts_at + "Z") - new Date(order.created_at + "Z")) / 60000)} min`
                      : "—"
                  }</span>
                </div>
                <div className="bg-surface-900 p-2 rounded border border-surface-700">
                  <span className="text-brand-500 block text-[10px]">Pickup (RTS→OFD)</span>
                  <span className="text-white font-bold">{
                    order.rts_at && order.pickup_at
                      ? `${Math.round((new Date(order.pickup_at + "Z") - new Date(order.rts_at + "Z")) / 60000)} min`
                      : "—"
                  }</span>
                </div>
                <div className="bg-surface-900 p-2 rounded border border-surface-700">
                  <span className="text-brand-500 block text-[10px]">Delivery (OFD→Delivered)</span>
                  <span className="text-white font-bold">{
                    order.pickup_at && order.delivered_at
                      ? `${Math.round((new Date(order.delivered_at + "Z") - new Date(order.pickup_at + "Z")) / 60000)} min`
                      : "—"
                  }</span>
                </div>
              </div>

              {order.created_at && order.delivered_at && (
                <div className="pt-2 border-t border-surface-700 flex justify-between items-center text-xs font-bold text-emerald-400">
                  <span>TOTAL FULFILLMENT TIME:</span>
                  <span className="text-sm font-mono bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-700/50">
                    {Math.floor((new Date(order.delivered_at + "Z") - new Date(order.created_at + "Z")) / 3600000)}h {
                      Math.round(((new Date(order.delivered_at + "Z") - new Date(order.created_at + "Z")) % 3600000) / 60000)
                    }m
                  </span>
                </div>
              )}
            </div>

            {order.pickup_deadline && (
              <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl p-3">
                <p className="text-xs text-amber-500 mb-1">Pickup Deadline (RTS + 45 min)</p>
                <p className="text-sm font-mono text-amber-300">{formatTs(order.pickup_deadline)}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-5">

          {/* Status Actions */}
          {actions.length > 0 && (
            <div className="card space-y-3">
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Update Status</h2>

              {/* Rider name for OFD */}
              {order.status === "ready_to_ship" && (
                <div>
                  <label className="label">Rider Name</label>
                  <input
                    className="input"
                    placeholder="Enter rider name"
                    value={riderName}
                    onChange={(e) => setRiderName(e.target.value)}
                  />
                </div>
              )}

              <div>
                <label className="label">Note (optional)</label>
                <input
                  className="input"
                  placeholder="Add a note..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {error && (
                <div className="bg-red-900/30 border border-red-700/40 rounded-xl px-3 py-2 text-red-300 text-xs">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                {actions.map(({ status: s, label, icon: Icon, cls }) => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    disabled={updating}
                    className={`${cls} w-full justify-center py-2.5`}
                  >
                    <Icon className="w-4 h-4" />
                    {updating ? "Updating..." : label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {order.status === "out_for_delivery" && (
            <div className="card space-y-3 border-brand-700/50">
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Complete Delivery & Payment</h2>
              <div>
                <label className="label">Delivery Outcome</label>
                <select className="select" value={deliveryOutcome} onChange={(e) => setDeliveryOutcome(e.target.value)}>
                  <option value="delivered">Delivered</option>
                  <option value="returned">Returned to warehouse</option>
                </select>
              </div>
              {deliveryOutcome === "delivered" && <>
                <div>
                  <label className="label">Payment Method</label>
                  <select className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="cod">Cash on Delivery</option>
                    <option value="online">Online Payment</option>
                    <option value="credit">Credit</option>
                  </select>
                </div>
                {paymentMethod !== "credit" && <div>
                  <label className="label">Amount Received (PKR) — due: {order.total_amount?.toLocaleString()}</label>
                  <input className="input" type="number" min="0" max={order.total_amount} placeholder="Enter collected amount" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} />
                </div>}
              </>}
              <div>
                <label className="label">Note (optional)</label>
                <input className="input" placeholder="Reason, reference number, or issue" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {error && <div className="bg-red-900/30 border border-red-700/40 rounded-xl px-3 py-2 text-red-300 text-xs">{error}</div>}
              <button onClick={completeDelivery} disabled={updating} className={`${deliveryOutcome === "returned" ? "btn-danger" : "btn-primary"} w-full justify-center py-2.5`}>
                <CheckCircle className="w-4 h-4" /> {updating ? "Saving..." : deliveryOutcome === "returned" ? "Confirm Return" : "Confirm Delivery & Payment"}
              </button>
            </div>
          )}

          {/* Completed notice */}
          {(order.status === "delivered" || order.status === "returned") && (
            <div className="card bg-brand-900/20 border-brand-700/40 text-center py-8">
              <CheckCircle className="w-12 h-12 text-brand-400 mx-auto mb-3" />
              <p className="text-brand-300 font-semibold">Order {order.status === "returned" ? "Returned" : "Delivered"}</p>
              <p className="text-brand-600 text-xs mt-1">{formatTs(order.delivered_at)}</p>
            </div>
          )}

          {/* Timeline */}
          <div className="card">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-4">Timeline</h2>
            <OrderTimeline history={order.status_history || []} />
          </div>
        </div>
      </div>

      {/* Edit Order Modal */}
      <EditOrderModal
        order={order}
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        onSaveSuccess={fetchOrder}
      />
    </div>
  );
}
