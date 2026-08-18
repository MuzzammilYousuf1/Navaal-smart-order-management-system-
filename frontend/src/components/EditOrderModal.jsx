import { useState, useEffect } from "react";
import { X, Save, Edit3, AlertCircle, Plus, Trash2 } from "lucide-react";
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

  const [items, setItems] = useState(() => {
    if (order.items && order.items.length > 0) {
      return order.items.map((it) => ({
        product_id: it.product_id || "",
        product_name: it.product_name || "",
        quantity: it.quantity || 1,
        unit_price: it.unit_price || 0,
      }));
    }
    return [{ product_id: "", product_name: "", quantity: 1, unit_price: 0 }];
  });

  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/inventory/products")
      .then(({ data }) => setProducts(data))
      .catch(() => {});
  }, []);

  const setItem = (i, k, v) => {
    setItems((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [k]: v };
      return next;
    });
  };

  const chooseProduct = (i, productIdStr) => {
    const productId = Number(productIdStr);
    const product = products.find((p) => p.id === productId);
    setItems((prev) => {
      const next = [...prev];
      if (product) {
        next[i] = {
          ...next[i],
          product_id: product.id,
          product_name: product.name,
          unit_price: product.unit_price,
        };
      } else {
        next[i] = { ...next[i], product_id: "", product_name: "" };
      }
      return next;
    });
  };

  const addItem = () => setItems((prev) => [...prev, { product_id: "", product_name: "", quantity: 1, unit_price: 0 }]);

  const removeItem = (i) => {
    setItems((prev) => {
      if (prev.length <= 1) {
        return [{ product_id: "", product_name: "", quantity: 1, unit_price: 0 }];
      }
      return prev.filter((_, idx) => idx !== i);
    });
  };

  // Recalculate total when items change
  const calcTotal = items.reduce((s, it) => s + (Number(it.unit_price || 0) * Number(it.quantity || 0)), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const validItems = items.filter((i) => i.product_id || i.product_name.trim());
      const payload = {
        ...form,
        total_amount: validItems.length > 0 ? calcTotal : Number(form.total_amount),
        amount_received: Number(form.amount_received),
        items: validItems.map((i) => ({
          product_id: i.product_id ? Number(i.product_id) : null,
          product_name: i.product_name,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
        })),
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
      <div className="card max-w-3xl w-full my-8 bg-surface-900 border-surface-700 shadow-2xl relative space-y-5">
        
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
                value={items.length > 0 ? calcTotal : form.total_amount}
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

          {/* Order Items with Individual Remove Access */}
          <div className="space-y-3 pt-2 border-t border-surface-800">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider">Order Items Management</h3>
              <button type="button" onClick={addItem} className="btn-secondary text-xs py-1">
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center bg-surface-800/80 p-2 rounded-lg border border-surface-750">
                  <div className="col-span-6">
                    <select
                      className="select text-xs py-1"
                      value={it.product_id || ""}
                      onChange={(e) => chooseProduct(i, e.target.value)}
                    >
                      <option value="">Custom / Select product...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} (PKR {p.unit_price})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      min={1}
                      className="input text-center text-xs py-1"
                      value={it.quantity}
                      onChange={(e) => setItem(i, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      type="number"
                      min={0}
                      className="input text-xs py-1"
                      placeholder="PKR"
                      value={it.unit_price}
                      onChange={(e) => setItem(i, "unit_price", e.target.value)}
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded transition-colors"
                      title="Remove Item Individually"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-right text-xs text-brand-300 font-semibold">
              Items Total: PKR {calcTotal.toLocaleString()}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes / Remarks</label>
            <textarea
              className="input h-16 py-2 resize-none text-xs"
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
