import { useEffect, useState } from "react";
import {
  RefreshCw, Plus, Trash2, CheckCircle, XCircle, Calendar,
  Users, Zap, Edit3, Save, X, AlertCircle
} from "lucide-react";
import api from "../api/client";

const FREQ_LABELS = {
  daily: "Daily",
  every_other_day: "Every Other Day",
  weekly: "Weekly",
};

const FREQ_COLORS = {
  daily: "bg-emerald-500/20 text-emerald-300 border border-emerald-700/40",
  every_other_day: "bg-amber-500/20 text-amber-300 border border-amber-700/40",
  weekly: "bg-brand-500/20 text-brand-300 border border-brand-700/40",
};

function SubscriptionCard({ sub, onEdit, onToggle, onDelete }) {
  const items = (() => { try { return JSON.parse(sub.items_json); } catch { return []; } })();
  const freqColor = FREQ_COLORS[sub.frequency] || FREQ_COLORS.daily;

  return (
    <div className={`card space-y-3 border ${sub.is_active ? "border-surface-700" : "border-surface-800 opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-white truncate">{sub.customer_name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${freqColor}`}>
              {FREQ_LABELS[sub.frequency] || sub.frequency}
            </span>
            {!sub.is_active && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-700/40">
                Paused
              </span>
            )}
          </div>
          {sub.city && <p className="text-xs text-brand-500 mt-0.5">{sub.city}{sub.delivery_address ? ` — ${sub.delivery_address}` : ""}</p>}
          {sub.customer_phone && <p className="text-xs text-brand-600">{sub.customer_phone}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onEdit(sub)} className="p-1.5 rounded text-brand-500 hover:text-white hover:bg-surface-700" title="Edit">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onToggle(sub)} className={`p-1.5 rounded hover:bg-surface-700 ${sub.is_active ? "text-amber-400" : "text-emerald-400"}`} title={sub.is_active ? "Pause" : "Activate"}>
            {sub.is_active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => onDelete(sub.id)} className="p-1.5 rounded text-red-500 hover:bg-red-900/30" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between text-xs text-brand-400 bg-surface-800/60 px-3 py-1.5 rounded-lg">
            <span>{it.product_name}</span>
            <span className="font-semibold text-white">x{it.quantity} — PKR {(it.quantity * it.unit_price).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-brand-600 pt-1 border-t border-surface-800">
        <span>Rider: <span className="text-brand-400">{sub.assigned_rider_name || "—"}</span></span>
        <span>Next: <span className="text-brand-400">{sub.next_delivery_date ? new Date(sub.next_delivery_date).toLocaleDateString("en-PK") : "—"}</span></span>
        <span className="font-semibold text-brand-300">PKR {sub.total_amount?.toLocaleString()}</span>
      </div>
    </div>
  );
}

function SubForm({ sub, products, onSave, onCancel }) {
  const [form, setForm] = useState({
    customer_name: sub?.customer_name || "",
    customer_phone: sub?.customer_phone || "",
    delivery_address: sub?.delivery_address || "",
    city: sub?.city || "",
    frequency: sub?.frequency || "daily",
    payment_method: sub?.payment_method || "cod",
    assigned_rider_name: sub?.assigned_rider_name || "",
    notes: sub?.notes || "",
    next_delivery_date: sub?.next_delivery_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  });
  const [items, setItems] = useState(() => {
    if (sub?.items_json) { try { return JSON.parse(sub.items_json); } catch { return []; } }
    return [{ product_name: "", quantity: 1, unit_price: 0 }];
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i, k, v) => setItems((prev) => { const n = [...prev]; n[i] = { ...n[i], [k]: v }; return n; });
  const pickProduct = (i, name) => {
    const p = products.find((x) => x.name === name);
    setItems((prev) => { const n = [...prev]; n[i] = { ...n[i], product_name: name, unit_price: p?.unit_price ?? n[i].unit_price }; return n; });
  };

  const handleSave = async () => {
    setSaving(true); setErr("");
    try {
      const payload = {
        ...form,
        items: items.filter((it) => it.product_name).map((it) => ({
          product_name: it.product_name,
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price),
        })),
        next_delivery_date: form.next_delivery_date ? new Date(form.next_delivery_date).toISOString() : undefined,
      };
      if (sub?.id) {
        await api.put(`/api/subscriptions/${sub.id}`, payload);
      } else {
        await api.post("/api/subscriptions", payload);
      }
      onSave();
    } catch (e) {
      setErr(e.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="card space-y-4 border border-brand-700/50">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-brand-400 uppercase tracking-wider">{sub ? "Edit Subscription" : "New Subscription"}</h3>
        <button onClick={onCancel} className="p-1 text-brand-600 hover:text-white"><X className="w-4 h-4" /></button>
      </div>

      {err && <div className="flex items-center gap-2 text-red-300 text-xs bg-red-900/20 border border-red-700/40 rounded-xl px-3 py-2"><AlertCircle className="w-4 h-4 shrink-0" />{err}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label">Customer Name *</label><input className="input" value={form.customer_name} onChange={(e) => setField("customer_name", e.target.value)} required /></div>
        <div><label className="label">Phone</label><input className="input" placeholder="03XX-XXXXXXX" value={form.customer_phone} onChange={(e) => setField("customer_phone", e.target.value)} /></div>
        <div><label className="label">City</label><input className="input" placeholder="e.g. Lahore" value={form.city} onChange={(e) => setField("city", e.target.value)} /></div>
        <div><label className="label">Delivery Address</label><input className="input" placeholder="Area / street" value={form.delivery_address} onChange={(e) => setField("delivery_address", e.target.value)} /></div>
        <div>
          <label className="label">Frequency</label>
          <select className="select" value={form.frequency} onChange={(e) => setField("frequency", e.target.value)}>
            <option value="daily">Daily</option>
            <option value="every_other_day">Every Other Day</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <div>
          <label className="label">Payment Method</label>
          <select className="select" value={form.payment_method} onChange={(e) => setField("payment_method", e.target.value)}>
            <option value="cod">Cash on Delivery</option>
            <option value="credit">Credit</option>
            <option value="online">Online</option>
          </select>
        </div>
        <div><label className="label">Rider</label><input className="input" placeholder="Rider name" value={form.assigned_rider_name} onChange={(e) => setField("assigned_rider_name", e.target.value)} /></div>
        <div><label className="label">First Delivery Date</label><input type="date" className="input" value={form.next_delivery_date} onChange={(e) => setField("next_delivery_date", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Notes</label><input className="input" placeholder="Any notes..." value={form.notes} onChange={(e) => setField("notes", e.target.value)} /></div>
      </div>

      {/* Items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-brand-500 uppercase tracking-wider">Items</span>
          <button type="button" onClick={() => setItems((p) => [...p, { product_name: "", quantity: 1, unit_price: 0 }])} className="btn-secondary text-xs py-1">
            <Plus className="w-3 h-3" /> Add Item
          </button>
        </div>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-6">
              <input className="input text-xs" placeholder="Product" list={`sub-prod-${i}`} value={it.product_name} onChange={(e) => pickProduct(i, e.target.value)} />
              <datalist id={`sub-prod-${i}`}>{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            </div>
            <div className="col-span-2"><input type="number" min={1} className="input text-center text-xs" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} /></div>
            <div className="col-span-3"><input type="number" min={0} placeholder="PKR" className="input text-xs" value={it.unit_price} onChange={(e) => setItem(i, "unit_price", e.target.value)} /></div>
            <div className="col-span-1 flex justify-end">
              {items.length > 1 && <button type="button" onClick={() => setItems((p) => p.filter((_, j) => j !== i))} className="p-1 text-red-500 hover:bg-red-900/20 rounded"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          </div>
        ))}
        <div className="text-right text-xs text-brand-400 font-semibold">
          Total: PKR {items.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price), 0).toLocaleString()}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-surface-800">
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
          <Save className="w-3.5 h-3.5" />{saving ? "Saving..." : "Save Subscription"}
        </button>
      </div>
    </div>
  );
}

export default function Subscriptions() {
  const [subs, setSubs] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);  // null | "new" | subscription object
  const [genMsg, setGenMsg] = useState("");

  const fetch = async () => {
    setLoading(true);
    try {
      const [subRes, prodRes] = await Promise.all([
        api.get(`/api/subscriptions?active_only=${!showInactive}`),
        api.get("/api/inventory/products"),
      ]);
      setSubs(subRes.data);
      setProducts(prodRes.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, [showInactive]);

  const handleGenerateToday = async () => {
    setGenerating(true); setGenMsg("");
    try {
      const { data } = await api.post("/api/subscriptions/generate-today");
      setGenMsg(data.message);
      fetch();
    } catch (e) {
      setGenMsg(e.response?.data?.detail || "Generation failed");
    } finally { setGenerating(false); }
  };

  const handleToggle = async (sub) => {
    await api.put(`/api/subscriptions/${sub.id}`, { is_active: !sub.is_active });
    fetch();
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Deactivate this subscription?")) return;
    await api.delete(`/api/subscriptions/${id}`);
    fetch();
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-6 h-6 text-brand-400" /> Subscriptions
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">Recurring deliveries — auto-generate daily orders</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowInactive((v) => !v)}
            className="btn-secondary text-xs"
          >
            <Users className="w-3.5 h-3.5" />
            {showInactive ? "Active Only" : "Show All"}
          </button>
          <button
            onClick={handleGenerateToday}
            disabled={generating}
            className="btn-secondary text-xs text-amber-300 border-amber-700/60"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            {generating ? "Generating..." : "Generate Today's Orders"}
          </button>
          <button onClick={() => setEditing("new")} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5" /> New Subscription
          </button>
        </div>
      </div>

      {genMsg && (
        <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-xl px-4 py-3 text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" /> {genMsg}
        </div>
      )}

      {/* New / Edit Form */}
      {editing && (
        <SubForm
          sub={editing === "new" ? null : editing}
          products={products}
          onSave={() => { setEditing(null); fetch(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12 text-brand-500">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
      ) : subs.length === 0 ? (
        <div className="card text-center py-16 text-brand-600">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-semibold">No subscriptions yet</p>
          <p className="text-sm mt-1">Create your first recurring delivery plan above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {subs.map((sub) => (
            <SubscriptionCard
              key={sub.id}
              sub={sub}
              onEdit={(s) => setEditing(s)}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
