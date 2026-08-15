import { useState } from "react";
import { X, Save, Edit3, AlertCircle } from "lucide-react";
import api from "../api/client";

export default function EditOrderModal({ order, isOpen, onClose, onSaveSuccess }) {
  if (!isOpen || !order) return null;

  const [form, setForm] = useState({
    customer_name: order.customer_name || "",
    customer_phone: order.customer_phone || "",
    delivery_address: order.delivery_address || "",
    city: order.city || "",
    source: order.source || "website",
    priority: order.priority || "normal",
    status: order.status || "pending",
    payment_status: order.payment_status || "cod",
    payment_method: order.payment_method || "cod",
    total_amount: order.total_amount || 0,
    amount_received: order.amount_received || 0,
    assigned_rider_name: order.assigned_rider_name || "",
    notes: order.notes || "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = {
        ...form,
        total_amount: Number(form.total_amount),
        amount_received: Number(form.amount_received),
      };
      await api.put(`/api/orders/${order.id}`, payload);
      onSaveSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to update order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="card max-w-2xl w-full my-8 bg-surface-900 border-surface-700 shadow-2xl relative space-y-5">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-800">
          <div className="flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-brand-400" />
            <h2 className="text-lg font-bold text-white">Edit Order {order.order_number}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-brand-600 hover:text-white hover:bg-surface-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Customer Name */}
            <div>
              <label className="label">Customer Name</label>
              <input
                className="input"
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                required
              />
            </div>

            {/* Customer Phone */}
            <div>
              <label className="label">Customer Phone</label>
              <input
                className="input"
                value={form.customer_phone}
                onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
              />
            </div>

            {/* Delivery Address */}
            <div>
              <label className="label">Delivery Address</label>
              <input
                className="input"
                value={form.delivery_address}
                onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
              />
            </div>

            {/* City */}
            <div>
              <label className="label">City / Location</label>
              <input
                className="input"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>

            {/* Channel / Source */}
            <div>
              <label className="label">Channel / Source</label>
              <select
                className="select"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              >
                <option value="b2b">B2B Sales</option>
                <option value="b2c">B2C Retail</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="website">Website</option>
                <option value="phone">Phone</option>
                <option value="walk_in">Walk-in</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>

            {/* Order Status */}
            <div>
              <label className="label">Order Status</label>
              <select
                className="select"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="pending">Pending</option>
                <option value="ready_to_ship">Ready to Ship</option>
                <option value="out_for_delivery">Out for Delivery</option>
                <option value="delivered">Delivered</option>
                <option value="returned">Returned</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="label">Priority</label>
              <select
                className="select"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            {/* Rider Name */}
            <div>
              <label className="label">Assigned Rider</label>
              <input
                className="input"
                placeholder="Rider name"
                value={form.assigned_rider_name}
                onChange={(e) => setForm({ ...form, assigned_rider_name: e.target.value })}
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="label">Payment Method</label>
              <select
                className="select"
                value={form.payment_method}
                onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
              >
                <option value="cod">Cash on Delivery (COD)</option>
                <option value="online">Online Payment</option>
                <option value="credit">Credit</option>
                <option value="returned">Returned</option>
              </select>
            </div>

            {/* Payment Status */}
            <div>
              <label className="label">Payment Status</label>
              <select
                className="select"
                value={form.payment_status}
                onChange={(e) => setForm({ ...form, payment_status: e.target.value })}
              >
                <option value="cod">COD (Pending)</option>
                <option value="received">Payment Received</option>
                <option value="credit">Credit</option>
                <option value="returned">Returned</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </div>

            {/* Total Amount Due */}
            <div>
              <label className="label">Amount Due (PKR)</label>
              <input
                type="number"
                step="any"
                className="input"
                value={form.total_amount}
                onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
              />
            </div>

            {/* Amount Received */}
            <div>
              <label className="label">Amount Received (PKR)</label>
              <input
                type="number"
                step="any"
                className="input"
                value={form.amount_received}
                onChange={(e) => setForm({ ...form, amount_received: e.target.value })}
              />
            </div>

          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes / Remarks</label>
            <textarea
              className="input h-20 py-2 resize-none"
              placeholder="Additional remarks or notes..."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-surface-800">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
