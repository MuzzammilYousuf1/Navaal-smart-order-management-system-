import { useEffect, useState } from "react";
import { Users, Plus, Edit, Trash2, Shield, RefreshCw } from "lucide-react";
import api from "../api/client";
import useAuth from "../store/useAuth";

const ROLES = ["admin", "manager", "warehouse", "rider", "operations"];

const ROLE_COLORS = {
  admin:      "text-red-400 bg-red-900/30",
  manager:    "text-amber-400 bg-amber-900/30",
  warehouse:  "text-blue-400 bg-blue-900/30",
  rider:      "text-brand-400 bg-brand-900/30",
  operations: "text-purple-400 bg-purple-900/30",
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "", role: "warehouse" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { user: currentUser } = useAuth();

  const fetch = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/users");
      setUsers(data);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", username: "", email: "", password: "", role: "warehouse" });
    setError("");
    setShowForm(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({ name: u.name, username: u.username, email: u.email || "", password: "", role: u.role });
    setError("");
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editing) {
        const payload = { name: form.name, email: form.email, role: form.role };
        if (form.password) payload.password = form.password;
        await api.put(`/api/users/${editing.id}`, payload);
      } else {
        await api.post("/api/users", form);
      }
      setShowForm(false);
      fetch();
    } catch (err) {
      const detail = err.response?.data?.detail;
      let msg = "Save failed";
      if (typeof detail === "string") msg = detail;
      else if (Array.isArray(detail)) msg = detail.map((d) => d.msg || d.detail).join(", ");
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u) => {
    if (!confirm(`Delete user "${u.name}"?`)) return;
    try {
      await api.delete(`/api/users/${u.id}`);
      fetch();
    } catch (err) {
      const detail = err.response?.data?.detail;
      let msg = "Delete failed";
      if (typeof detail === "string") msg = detail;
      else if (Array.isArray(detail)) msg = detail.map((d) => d.msg || d.detail).join(", ");
      alert(msg);
    }
  };

  const canManageUsers = currentUser?.role === "admin" || currentUser?.role === "manager";

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="text-brand-500 text-sm">{users.length} users in the system</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetch} className="btn-secondary"><RefreshCw className="w-4 h-4" /></button>
          {canManageUsers && (
            <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add User</button>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="card w-full max-w-md">
            <h2 className="text-lg font-semibold text-white mb-5">{editing ? "Edit User" : "New User"}</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="label">Full Name</label>
                <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              {!editing && (
                <div>
                  <label className="label">Username</label>
                  <input className="input" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
              )}
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="label">{editing ? "New Password (leave blank to keep)" : "Password"}</label>
                <input className="input" type="password" required={!editing} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div>
                <label className="label">Role</label>
                <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users Grid */}
      {loading ? (
        <p className="text-brand-500 animate-pulse text-sm">Loading users...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {users.map((u) => (
            <div key={u.id} className="card flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-surface-800 flex items-center justify-center shrink-0">
                <span className="text-xl font-bold text-brand-400">{u.name[0]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{u.name}</p>
                <p className="text-xs text-brand-500">@{u.username}</p>
                <p className="text-xs text-brand-600 truncate">{u.email || "No email"}</p>
                <div className="mt-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${ROLE_COLORS[u.role] || ""}`}>
                    {u.role}
                  </span>
                  {!u.is_active && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-red-900/30 text-red-400">
                      Inactive
                    </span>
                  )}
                </div>
              </div>
              {canManageUsers && u.id !== currentUser?.id && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(u)} className="btn-ghost p-1.5"><Edit className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(u)} className="btn-ghost p-1.5 text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
