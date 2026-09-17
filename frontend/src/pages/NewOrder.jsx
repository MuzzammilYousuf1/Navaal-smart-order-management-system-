import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Package, MapPin, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import api, { getErrorMessage } from "../api/client";
import CustomerAutocomplete from "../components/CustomerAutocomplete";
import { pakistanDateInput } from "../utils/dates";

const DEFAULT_FORM = {
  customer_name: "",
  customer_phone: "",
  delivery_address: "",
  city: "",
  location_url: "",
  source: "website",
  channel: "b2c",
  priority: "normal",
  payment_status: "cod",
  delivery_date: pakistanDateInput(),
  notes: "",
  assigned_rider_name: "",
};

export default function NewOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [items, setItems] = useState([{ product_id: "", product_name: "", quantity: 1, weight_kg: "", unit_price: 0, pricing_type: "fixed" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [products, setProducts] = useState([]);
  const [prefilled, setPrefilled] = useState(false);
  const [riders, setRiders] = useState([]);

  useEffect(() => {
    if (location.state?.customer) {
      handleCustomerSelect(location.state.customer);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  useEffect(() => {
    api.get("/api/inventory/products")
      .then(({ data }) => setProducts(data))
      .catch(() => setError("Could not load active inventory items."));
  }, []);

  useEffect(() => {
    api.get("/api/orders/riders/summary")
      .then(({ data }) => setRiders(data.filter((r) => r.rider_id)))
      .catch(() => setRiders([]));
  }, []);

  const setField = (k, v) => {
    setForm((f) => {
      const updated = { ...f, [k]: v };
      // Auto-derive channel whenever source changes
      if (k === "source") {
        updated.channel = v === "b2b" ? "b2b" : "b2c";
      }
      return updated;
    });
  };

  // Identify products that act as base bulk products for subitems
  const baseProductIds = new Set(products.filter((p) => p.base_product_id).map((p) => p.base_product_id));
  // Filter out raw bulk items from retail order selection
  const sellableProducts = products.filter((p) => !baseProductIds.has(p.id));

  // Called when user selects a customer from autocomplete
  const handleCustomerSelect = (cust) => {
    setForm((f) => ({
      ...f,
      customer_name: cust.name,
      customer_phone: cust.phone || f.customer_phone,
      delivery_address: cust.delivery_address || f.delivery_address,
      city: cust.city || f.city,
      assigned_rider_name: cust.preferred_rider || f.assigned_rider_name,
    }));
    // Pre-fill last order items if available
    if (cust.last_items_json) {
      try {
        const lastItems = JSON.parse(cust.last_items_json);
        if (lastItems && lastItems.length > 0) {
          setItems(lastItems.map((it) => ({
            product_id: it.product_id || "",
            product_name: it.product_name,
            quantity: it.quantity,
            unit_price: it.unit_price,
            weight_kg: it.weight_kg || "",
            pricing_type: it.pricing_type || "fixed",
          })));
          setPrefilled(true);
        }
      } catch { /* ignore parse errors */ }
    }
  };

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
          pricing_type: product.pricing_type || "fixed",
          weight_kg: product.pricing_type === "by_weight" ? "" : undefined,
        };
      } else {
        next[i] = { ...next[i], product_id: "", product_name: "" };
      }
      return next;
    });
  };

  const addItem = () => setItems((prev) => [...prev, { product_id: "", product_name: "", quantity: 1, weight_kg: "", unit_price: 0, pricing_type: "fixed" }]);
  const removeItem = (i) => {
    setItems((prev) => {
      if (prev.length <= 1) {
        return [{ product_id: "", product_name: "", quantity: 1, weight_kg: "", unit_price: 0, pricing_type: "fixed" }];
      }
      return prev.filter((_, idx) => idx !== i);
    });
  };

  const total = items.reduce((s, it) => s + (it.pricing_type === "by_weight" ? Number(it.unit_price) * Number(it.weight_kg || 0) : Number(it.unit_price) * Number(it.quantity)), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Mandatory field validations to prevent inconsistent order data
    if (!form.customer_name.trim()) {
      setError("Customer Name is required.");
      return;
    }
    if (!form.customer_phone.trim()) {
      setError("Customer Phone Number is required.");
      return;
    }
    if (!form.delivery_address.trim()) {
      setError("Delivery Address is required.");
      return;
    }
    if (!form.city.trim()) {
      setError("City is required.");
      return;
    }

    const validItems = items.filter((i) => i.product_id || i.product_name.trim());
    if (validItems.length === 0) {
      setError("At least one valid product must be added to the order.");
      return;
    }

    for (let idx = 0; idx < validItems.length; idx++) {
      const it = validItems[idx];
      if (!it.product_id) {
        setError(`Please select a valid product for Item #${idx + 1}.`);
        return;
      }
      if (Number(it.quantity) <= 0) {
        setError(`Quantity for Item #${idx + 1} must be at least 1.`);
        return;
      }
      if (it.pricing_type === "by_weight" && Number(it.weight_kg) <= 0) {
        setError(`Actual weight for Item #${idx + 1} must be greater than 0 kg.`);
        return;
      }
    }

    setLoading(true);
    try {
      const payload = {
        ...form,
        items: validItems.map((i) => ({
          product_id: Number(i.product_id),
          product_name: i.product_name,
          quantity: Number(i.quantity),
          weight_kg: i.pricing_type === "by_weight" ? Number(i.weight_kg) : undefined,
          unit_price: Number(i.unit_price),
        })),
      };
      const { data } = await api.post("/api/orders/", payload);
      navigate(`/orders/${data.id}`);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create order"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/orders")} className="btn-ghost">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">New Order</h1>
            <p className="text-brand-500 text-sm">Timestamp saved automatically on creation</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Customer Info */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Customer Info (All Required)</h2>
              {prefilled && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Pre-filled from address book
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Customer Name *</label>
                <CustomerAutocomplete
                  value={form.customer_name}
                  onChange={(v) => { setField("customer_name", v); setPrefilled(false); }}
                  onSelect={handleCustomerSelect}
                  placeholder="Type name to search address book..."
                  required
                />
              </div>
              <div>
                <label className="label">Phone Number *</label>
                <input
                  className="input"
                  placeholder="03XX-XXXXXXX"
                  value={form.customer_phone}
                  onChange={(e) => setField("customer_phone", e.target.value)}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Delivery Address *</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  placeholder="Full delivery address"
                  value={form.delivery_address}
                  onChange={(e) => setField("delivery_address", e.target.value)}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Customer Google Maps Location</label>
                <div className="flex gap-2">
                  <input className="input" type="url" placeholder="Paste Google Maps link shared by customer" value={form.location_url} onChange={(e) => setField("location_url", e.target.value)} />
                  {form.location_url && <a href={form.location_url} target="_blank" rel="noreferrer" className="btn-secondary shrink-0" title="Open map"><ExternalLink className="w-4 h-4" /></a>}
                </div>
                <p className="text-xs text-brand-600 mt-1.5">Paste the pinned/live Google Maps location shared through WhatsApp.</p>
              </div>
              <div>
                <label className="label">City *</label>
                <input
                  className="input"
                  placeholder="e.g. Lahore"
                  value={form.city}
                  onChange={(e) => setField("city", e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">Order Source *</label>
                <select className="select" value={form.source} onChange={(e) => setField("source", e.target.value)} required>
                  <option value="website">Website</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="phone">Phone</option>
                  <option value="walk_in">Walk-in</option>
                  <option value="b2b">B2B Sales</option>
                  <option value="b2c">B2C Sales</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                </select>
              </div>
              <div>
                <label className="label">Channel</label>
                <div className={`input flex items-center gap-2 cursor-default select-none ${
                  form.channel === "b2b" ? "text-amber-300 border-amber-700/50" : "text-emerald-300 border-emerald-800/50"
                }`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    form.channel === "b2b" ? "bg-amber-400" : "bg-emerald-400"
                  }`} />
                  {form.channel === "b2b" ? "B2B — Business/Mart" : "B2C — Retail Customer"}
                </div>
                <p className="text-xs text-brand-600 mt-1.5">Auto-set from Source. B2B is set when source is "B2B Sales".</p>
              </div>
              <div>
                <label className="label">Priority *</label>
                <select className="select" value={form.priority} onChange={(e) => setField("priority", e.target.value)} required>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="label">Expected Payment Method *</label>
                <select className="select" value={form.payment_status} onChange={(e) => setField("payment_status", e.target.value)} required>
                  <option value="cod">Cash on Delivery</option>
                  <option value="online">Online Payment</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
              <div>
                <label className="label">Scheduled Delivery Date</label>
                <input
                  type="date"
                  className="input"
                  value={form.delivery_date || ""}
                  onChange={(e) => setField("delivery_date", e.target.value)}
                />
                <p className="text-xs text-brand-600 mt-1.5">Schedule order for today, tomorrow, or a future delivery date.</p>
              </div>
              <div>
                <label className="label">Assigned Rider</label>
                <select className="select" value={form.assigned_rider_name || ""} onChange={(e) => setField("assigned_rider_name", e.target.value)}>
                  <option value="">Unassigned</option>
                  {riders.map((rider) => <option key={rider.rider_id} value={rider.rider_name}>{rider.rider_name}</option>)}
                </select>
                <p className="text-xs text-brand-600 mt-1.5">Only active Rider accounts can be assigned.</p>
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Order Items</h2>
                <p className="text-[11px] text-brand-600">Bulk products are hidden — select specific retail packs below</p>
              </div>
              <button type="button" onClick={addItem} className="btn-secondary text-xs py-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>

            <div className="space-y-3">
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end bg-surface-850 p-3 rounded-xl border border-surface-800">
                  <div className="sm:col-span-6">
                    <label className="label">Product *</label>
                    <select
                      className="select"
                      value={item.product_id || ""}
                      onChange={(e) => chooseProduct(i, e.target.value)}
                      required
                    >
                      <option value="">Select product...</option>
                      {sellableProducts.map((p) => {
                        const packInfo = p.pricing_type === "by_weight" ? " (price per kg)" : (p.unit_multiplier && p.unit_multiplier > 1 ? ` (${p.unit_multiplier} ${p.unit}s/pack)` : ` (${p.unit})`);
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name} {packInfo} — PKR {p.unit_price} [{p.stock_qty} in stock]
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">{item.pricing_type === "by_weight" ? "Actual Weight (kg) *" : "Qty *"}</label>
                    {item.pricing_type === "by_weight" ? (
                      <input className="input text-center" type="number" min="0.001" step="0.001" value={item.weight_kg} onChange={(e) => setItem(i, "weight_kg", e.target.value)} placeholder="e.g. 1.35" required />
                    ) : (
                      <input className="input text-center" type="number" min={1} value={item.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} required />
                    )}
                  </div>
                  <div className="sm:col-span-3">
                    <label className="label">{item.pricing_type === "by_weight" ? "Price per kg (PKR) *" : "Unit Price (PKR) *"}</label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={item.unit_price}
                      onChange={(e) => setItem(i, "unit_price", e.target.value)}
                      required
                    />
                  </div>
                  {item.pricing_type === "by_weight" && <p className="sm:col-span-11 text-xs text-emerald-400">Line total: PKR {(Number(item.weight_kg || 0) * Number(item.unit_price || 0)).toLocaleString()} ({item.weight_kg || 0} kg × PKR {item.unit_price || 0}/kg)</p>}
                  <div className="sm:col-span-1 flex justify-end sm:justify-center">
                    <button type="button" onClick={() => removeItem(i)} className="btn-danger p-2" title="Remove item">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-3 border-t border-surface-700">
              <div className="text-right">
                <p className="text-xs text-brand-500">Order Total</p>
                <p className="text-2xl font-bold text-brand-300">PKR {total.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="card">
            <label className="label">Notes / Special Instructions</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Any special instructions, fragile items, etc."
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-3 justify-end">
            <button type="button" onClick={() => navigate("/orders")} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary px-8">
              <Package className="w-4 h-4" />
              {loading ? "Creating..." : "Create Order"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
