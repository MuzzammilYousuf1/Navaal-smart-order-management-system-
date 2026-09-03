import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, Search, Plus, RefreshCw, ShoppingCart, MapPin, Phone,
  UserCheck, ShieldCheck, Trash2, Edit3, ArrowRight, CheckCircle, FileText,
  Bot, BotOff, BookOpen, Download, X, DollarSign, PlusCircle
} from "lucide-react";
import api, { API_BASE } from "../api/client";

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

  // Ledger Modal State
  const [showLedger, setShowLedger] = useState(false);
  const [ledgerCust, setLedgerCust] = useState(null);
  const [ledgerData, setLedgerData] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [postingLedger, setPostingLedger] = useState(false);
  const [ledgerForm, setLedgerForm] = useState({
    entry_type: "credit",
    amount: "",
    description: "",
  });

  const getAuthUrl = (path) => {
    const token = localStorage.getItem("sof_token");
    return `${API_BASE}${path}?token=${encodeURIComponent(token)}`;
  };

  const handleOpenLedger = async (customer) => {
    setLedgerCust(customer);
    setShowLedger(true);
    setLedgerData(null);
    setLedgerForm({ entry_type: "credit", amount: "", description: "" });
    await fetchLedger(customer.phone);
  };

  const fetchLedger = async (phone) => {
    setLedgerLoading(true);
    try {
      const res = await api.get(`/api/ledger/${phone}`);
      setLedgerData(res.data);
    } catch (err) {
      console.error("Failed to fetch ledger", err);
    } finally {
      setLedgerLoading(false);
    }
  };

  const handlePostLedger = async (e) => {
    e.preventDefault();
    if (!ledgerCust || !ledgerForm.amount) return;
    setPostingLedger(true);
    try {
      await api.post("/api/ledger/entries", {
        customer_phone: ledgerCust.phone,
        channel: ledgerData?.channel || "b2c",
        entry_type: ledgerForm.entry_type,
        amount: parseFloat(ledgerForm.amount),
        description: ledgerForm.description || "Manual adjustment",
      });
      showStatus("Ledger entry posted successfully!");
      setLedgerForm({ entry_type: "credit", amount: "", description: "" });
      fetchLedger(ledgerCust.phone);
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to post ledger entry");
    } finally {
      setPostingLedger(false);
    }
  };

  const handleDownloadLedgerPDF = () => {
    if (!ledgerCust) return;
    window.open(getAuthUrl(`/api/ledger/${ledgerCust.phone}/pdf`), "_blank");
  };

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

  const handleToggleAiTakeover = async (c) => {
    if (!c.phone) {
      alert("Customer has no phone number recorded.");
      return;
    }
    const targetStatus = !c.ai_disabled;
    const confirmMsg = targetStatus
      ? `Activate Human Takeover for ${c.name}? AI chatbot will be muted for this number.`
      : `Re-enable AI Chatbot for ${c.name}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await api.post("/api/webhook/n8n/toggle-ai-takeover", null, {
        params: {
          phone: c.phone,
          disable_ai: targetStatus,
          reason: targetStatus ? "Operator Takeover from UI" : "AI Re-enabled from UI",
        },
      });
      showStatus(`AI status for ${c.name} updated: ${targetStatus ? "Muted (Human Takeover Active)" : "AI Active"}`);
      fetchCustomers(query);
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to update AI status");
    }
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
                    <div className="flex flex-col items-end gap-1">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-950 text-brand-300 border border-brand-850">
                        {c.order_count} Orders
                      </span>
                      {c.ai_disabled ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800 flex items-center gap-1">
                          <BotOff className="w-3 h-3" /> Human Takeover
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                          <Bot className="w-3 h-3" /> AI Active
                        </span>
                      )}
                    </div>
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
                      onClick={() => handleToggleAiTakeover(c)}
                      className={`btn-secondary text-[11px] px-2 py-1 flex items-center gap-1 border-surface-700 ${
                        c.ai_disabled ? "text-emerald-400 hover:text-emerald-300" : "text-amber-400 hover:text-amber-300"
                      }`}
                      title={c.ai_disabled ? "Re-enable AI Chatbot" : "Take over chat manually / Mute AI"}
                    >
                      {c.ai_disabled ? <Bot className="w-3 h-3" /> : <BotOff className="w-3 h-3" />}
                      {c.ai_disabled ? "Enable AI" : "Takeover"}
                    </button>
                    <button
                      onClick={() => handleOpenEdit(c)}
                      className="btn-secondary text-[11px] px-2 py-1 border-surface-700 text-brand-400 hover:text-white"
                      title="Edit Profile"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleOpenLedger(c)}
                      className="btn-secondary text-[11px] px-2 py-1 border-surface-700 text-emerald-400 hover:text-emerald-300"
                      title="View Customer Ledger & Statement"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
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

      {/* Ledger Modal */}
      {showLedger && ledgerCust && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto">
          <div className="card w-full max-w-4xl bg-surface-900 border-surface-700 flex flex-col p-6 space-y-4 max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-surface-800 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <BookOpen className="w-5.5 h-5.5 text-brand-400" />
                  Account Ledger: {ledgerCust.name}
                </h2>
                <p className="text-brand-500 text-xs mt-0.5 font-mono">
                  Phone: {ledgerCust.phone} | Channel: {(ledgerData?.channel || "b2c").toUpperCase()}
                </p>
              </div>
              <button
                onClick={() => setShowLedger(false)}
                className="text-brand-500 hover:text-white p-1 rounded-lg hover:bg-surface-800 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content (Scrollable) */}
            <div className="flex-1 overflow-y-auto space-y-6 pr-1">
              {ledgerLoading ? (
                <div className="text-center py-12 text-brand-500 animate-pulse">
                  Loading ledger transaction history...
                </div>
              ) : (
                <>
                  {/* Balance & Stats Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="card bg-surface-850 border-surface-800 p-4 flex flex-col justify-between">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-brand-500">Total Debits</span>
                      <span className="text-lg font-bold text-white mt-1">
                        PKR {ledgerData?.total_debit?.toLocaleString() || "0"}
                      </span>
                    </div>
                    <div className="card bg-surface-850 border-surface-800 p-4 flex flex-col justify-between">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-brand-500">Total Credits</span>
                      <span className="text-lg font-bold text-white mt-1">
                        PKR {ledgerData?.total_credit?.toLocaleString() || "0"}
                      </span>
                    </div>
                    <div className={`card p-4 flex flex-col justify-between ${
                      (ledgerData?.balance || 0) > 0 
                        ? "bg-red-950/40 border-red-900/40 text-red-200" 
                        : "bg-emerald-950/40 border-emerald-900/40 text-emerald-200"
                    }`}>
                      <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Outstanding Balance</span>
                      <span className="text-lg font-extrabold mt-1">
                        PKR {ledgerData?.balance?.toLocaleString() || "0"}
                        <span className="text-[10px] block font-normal opacity-90 mt-0.5">
                          {ledgerData?.balance > 0 ? "Customer owes you" : ledgerData?.balance < 0 ? "Credit Balance" : "Account Settled"}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center justify-center">
                      <button
                        onClick={handleDownloadLedgerPDF}
                        className="btn-primary w-full py-3.5 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 font-semibold text-xs rounded-xl shadow-lg shadow-emerald-900/20"
                      >
                        <Download className="w-4 h-4" />
                        Download Statement
                      </button>
                    </div>
                  </div>

                  {/* Transactions Table */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider text-brand-500">Transaction History</h3>
                    <div className="border border-surface-800 rounded-xl overflow-hidden bg-surface-950">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-surface-850 border-b border-surface-800 text-[10px] uppercase font-bold text-brand-400">
                            <th className="p-3">Date</th>
                            <th className="p-3">Description</th>
                            <th className="p-3 text-right">Debit (+)</th>
                            <th className="p-3 text-right">Credit (-)</th>
                            <th className="p-3 text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-800 text-xs">
                          {!ledgerData || ledgerData.entries.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="p-6 text-center text-brand-600">
                                No transaction records found for this account
                              </td>
                            </tr>
                          ) : (
                            (() => {
                              let runningBalance = 0;
                              return ledgerData.entries.map((entry) => {
                                if (entry.entry_type === "debit") {
                                  runningBalance += entry.amount;
                                } else {
                                  runningBalance -= entry.amount;
                                }
                                return (
                                  <tr key={entry.id} className="hover:bg-surface-900/50 transition-colors">
                                    <td className="p-3 text-brand-400 whitespace-nowrap">
                                      {new Date(entry.created_at).toLocaleDateString("en-GB", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                      })}
                                    </td>
                                    <td className="p-3 text-white">
                                      {entry.description}
                                      {entry.related_order_id && (
                                        <span className="text-[10px] text-brand-500 font-mono ml-2">
                                          (ID: {entry.related_order_id})
                                        </span>
                                      )}
                                    </td>
                                    <td className="p-3 text-right text-red-400 font-semibold">
                                      {entry.entry_type === "debit" ? `PKR ${entry.amount.toLocaleString()}` : "—"}
                                    </td>
                                    <td className="p-3 text-right text-emerald-400 font-semibold">
                                      {entry.entry_type === "credit" ? `PKR ${entry.amount.toLocaleString()}` : "—"}
                                    </td>
                                    <td className={`p-3 text-right font-bold ${runningBalance > 0 ? "text-red-400" : "text-emerald-400"}`}>
                                      PKR {runningBalance.toLocaleString()}
                                    </td>
                                  </tr>
                                );
                              });
                            })()
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Manual Entry Form */}
                  <div className="card bg-surface-850 border-surface-800 p-4 space-y-3">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider text-brand-500 flex items-center gap-1.5">
                      <PlusCircle className="w-4 h-4 text-brand-500" />
                      Add Manual Adjustment
                    </h3>
                    <form onSubmit={handlePostLedger} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                      <div>
                        <label className="label text-[10px]">Type</label>
                        <select
                          className="input py-1.5 text-xs bg-surface-900 border-surface-750"
                          value={ledgerForm.entry_type}
                          onChange={(e) => setLedgerForm({ ...ledgerForm, entry_type: e.target.value })}
                        >
                          <option value="credit">Credit (Payment Received / Discount)</option>
                          <option value="debit">Debit (Owed / Opening Balance)</option>
                        </select>
                      </div>
                      <div>
                        <label className="label text-[10px]">Amount (PKR)</label>
                        <input
                          type="number"
                          step="any"
                          className="input py-1.5 text-xs bg-surface-900 border-surface-750 font-bold"
                          placeholder="e.g. 5000"
                          required
                          value={ledgerForm.amount}
                          onChange={(e) => setLedgerForm({ ...ledgerForm, amount: e.target.value })}
                        />
                      </div>
                      <div className="md:col-span-2 flex gap-2 items-end">
                        <div className="flex-1">
                          <label className="label text-[10px]">Description</label>
                          <input
                            type="text"
                            className="input py-1.5 text-xs bg-surface-900 border-surface-750"
                            placeholder="e.g. Onboarding opening balance"
                            required
                            value={ledgerForm.description}
                            onChange={(e) => setLedgerForm({ ...ledgerForm, description: e.target.value })}
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={postingLedger}
                          className="btn-primary py-2 px-4 text-xs font-semibold shrink-0 bg-brand-600 hover:bg-brand-500 rounded-lg flex items-center gap-1"
                        >
                          Post Entry
                        </button>
                      </div>
                    </form>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end pt-3 border-t border-surface-800 shrink-0">
              <button
                type="button"
                onClick={() => setShowLedger(false)}
                className="btn-secondary text-xs px-4 py-2"
              >
                Close Statement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
