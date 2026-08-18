import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, Search, Plus, RefreshCw, ShoppingCart, MapPin, Phone,
  UserCheck, ShieldCheck, Trash2, Edit3, ArrowRight, CheckCircle, FileText
} from "lucide-react";
import api from "../api/client";

export default function CustomerProfiles() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // Create / Edit Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingCust, setEditingCust] = useState(null);
  const [custForm, setCustForm] = useState({
    name: "",
    phone: "",
    delivery_address: "",
    city: "Karachi",
    preferred_rider: "",
    notes: "",
  });

  const showStatus = (msg) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(""), 5000);
  };

  const fetchCustomers = async (searchQuery = "") => {
    setLoading(true);
    try {
      const res = await api.get(`/api/customers`, {
        params: { q: searchQuery || undefined, limit: 100 }
      });
      setCustomers(res.data);
    } catch (err) {
      console.error("Failed to load customer profiles", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers(query);
  }, [query]);

  const handleSyncAddressBook = async () => {
    setSyncing(true);
    try {
      const res = await api.post("/api/customers/sync");
      showStatus(res.data.message || "Address book synchronized!");
      fetchCustomers();
    } catch (err) {
      alert(err.response?.data?.detail || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingCust(null);
    setCustForm({
      name: "",
      phone: "",
      delivery_address: "",
      city: "Karachi",
      preferred_rider: "",
      notes: "",
    });
    setShowModal(true);
  };

  const handleOpenEdit = (c) => {
    setEditingCust(c);
    setCustForm({
      name: c.name || "",
      phone: c.phone || "",
      delivery_address: c.delivery_address || "",
      city: c.city || "Karachi",
      preferred_rider: c.preferred_rider || "",
      notes: c.notes || "",
    });
    setShowModal(true);
  };

  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    try {
      if (editingCust) {
        await api.put(`/api/customers/${editingCust.id}`, custForm);
        showStatus(`Customer profile '${custForm.name}' updated!`);
      } else {
        await api.post("/api/customers", custForm);
        showStatus(`New customer profile '${custForm.name}' created!`);
      }
      setShowModal(false);
      fetchCustomers(query);
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to save customer");
    }
  };

  const handleDeleteCustomer = async (id, name) => {
    if (!window.confirm(`Delete customer profile '${name}'?`)) return;
    try {
      await api.delete(`/api/customers/${id}`);
      showStatus(`Customer '${name}' deleted.`);
      fetchCustomers(query);
    } catch (err) {
      alert(err.response?.data?.detail || "Could not delete customer");
    }
  };

  const handleOneClickOrder = (customer) => {
    // Navigate directly to New Order with pre-selected customer state
    navigate("/orders/new", { state: { customer } });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-400" />
            Customer Address Book & Profiles
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">
            1-Click instant auto-fill order creation & customer history tracking
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSyncAddressBook}
            disabled={syncing}
            className="btn-secondary text-xs flex items-center gap-1.5"
            title="Auto-build address book profiles from all past order records"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing Orders..." : "Sync from Orders"}
          </button>
          <button onClick={handleOpenAdd} className="btn-primary text-xs flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Customer Profile
          </button>
        </div>
      </div>

      {/* Notifications */}
      {statusMsg && (
        <div className="card bg-emerald-950/40 border border-emerald-700/60 text-emerald-300 py-3 flex items-center gap-2 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Search Toolbar */}
      <div className="card flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-brand-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            className="input pl-9 text-xs"
            placeholder="Search by name, phone, city, or address..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="text-xs text-brand-500 font-medium">
          {customers.length} Saved Profiles
        </span>
      </div>

      {/* Profiles Grid */}
      {loading ? (
        <div className="text-center py-16 text-brand-500 animate-pulse">
          Loading customer address book...
        </div>
      ) : customers.length === 0 ? (
        <div className="card text-center py-12 space-y-3">
          <Users className="w-12 h-12 text-brand-600 mx-auto" />
          <p className="text-white font-semibold">No Customer Profiles Found</p>
          <p className="text-xs text-brand-500">
            Click "Sync from Orders" to auto-import from historical orders, or add a profile manually.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c) => {
            let lastItems = [];
            if (c.last_items_json) {
              try { lastItems = JSON.parse(c.last_items_json); } catch { /* ignore */ }
            }

            return (
              <div key={c.id} className="card bg-surface-900 border-surface-750 flex flex-col justify-between space-y-4 hover:border-brand-600 transition-all">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-white text-base">{c.name}</h3>
                      <p className="text-xs text-brand-400 font-mono flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3 text-brand-500" /> {c.phone || "No phone listed"}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-950 text-brand-300 border border-brand-850">
                      {c.order_count} Orders
                    </span>
                  </div>

                  <div className="text-xs text-brand-400 space-y-1 pt-1 border-t border-surface-800">
                    <p className="flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-brand-500 shrink-0 mt-0.5" />
                      <span>{c.delivery_address || "No address saved"} {c.city ? `(${c.city})` : ""}</span>
                    </p>
                    {c.preferred_rider && (
                      <p className="text-[11px] text-emerald-400 font-medium pl-5">
                        Preferred Rider: {c.preferred_rider}
                      </p>
                    )}
                  </div>

                  {/* Last Items Quick Preview */}
                  {lastItems.length > 0 && (
                    <div className="bg-surface-850 p-2.5 rounded-xl border border-surface-800 space-y-1 text-xs">
                      <p className="text-[10px] font-semibold text-brand-500 uppercase tracking-wider">
                        Last Order Items ({c.last_order_total ? `PKR ${c.last_order_total.toLocaleString()}` : ""})
                      </p>
                      <div className="space-y-0.5">
                        {lastItems.slice(0, 2).map((it, idx) => (
                          <div key={idx} className="flex justify-between text-brand-300 text-[11px]">
                            <span>{it.product_name}</span>
                            <span className="font-bold text-white">x{it.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Action Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-surface-800 gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEdit(c)}
                      className="btn-secondary text-[11px] px-2 py-1 border-surface-700 text-brand-400 hover:text-white"
                      title="Edit Profile"
                    >
                      <Edit3 className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={() => handleDeleteCustomer(c.id, c.name)}
                      className="btn-secondary text-[11px] px-2 py-1 border-red-900/30 text-red-400 hover:bg-red-950/20"
                      title="Delete Customer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <button
                    onClick={() => handleOneClickOrder(c)}
                    className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-md shadow-brand-900/40"
                    title="Instant 1-Click Order Creation"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" /> 1-Click Order
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Profile Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-md space-y-4 bg-surface-900 border-surface-700">
            <h2 className="text-lg font-bold text-white">
              {editingCust ? `Edit Profile — ${editingCust.name}` : "Create Customer Profile"}
            </h2>

            <form onSubmit={handleSaveCustomer} className="space-y-3">
              <div>
                <label className="label">Customer Full Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Muzzammil Yousuf"
                  value={custForm.name}
                  onChange={(e) => setCustForm({ ...custForm, name: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Phone Number</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="03001234567"
                    value={custForm.phone}
                    onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">City</label>
                  <input
                    type="text"
                    className="input"
                    value={custForm.city}
                    onChange={(e) => setCustForm({ ...custForm, city: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="label">Delivery Address</label>
                <textarea
                  className="input h-20 resize-none text-xs"
                  placeholder="Full street address, area, landmark..."
                  value={custForm.delivery_address}
                  onChange={(e) => setCustForm({ ...custForm, delivery_address: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Preferred Rider Name (Optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Ali Rider"
                  value={custForm.preferred_rider}
                  onChange={(e) => setCustForm({ ...custForm, preferred_rider: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Special Customer Notes</label>
                <input
                  type="text"
                  className="input text-xs"
                  placeholder="e.g. VIP Customer - deliver before 2 PM"
                  value={custForm.notes}
                  onChange={(e) => setCustForm({ ...custForm, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingCust ? "Save Changes" : "Create Profile"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
