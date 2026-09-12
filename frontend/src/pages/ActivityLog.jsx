import { useEffect, useState, useCallback } from "react";
import {
  Activity, Filter, RefreshCw, User, Package, ShoppingCart, Warehouse,
  LogIn, Trash2, Edit, PlusCircle, Search, ChevronLeft, ChevronRight,
  BarChart2, AlertCircle
} from "lucide-react";
import api from "../api/client";
import useAuth from "../store/useAuth";

// ── Action metadata (icon + colour) ──────────────────────────────────────────
const ACTION_META = {
  create:     { icon: PlusCircle,    color: "text-emerald-400", bg: "bg-emerald-900/30 border-emerald-700/40" },
  update:     { icon: Edit,          color: "text-sky-400",     bg: "bg-sky-900/30 border-sky-700/40" },
  delete:     { icon: Trash2,        color: "text-red-400",     bg: "bg-red-900/30 border-red-700/40" },
  login:      { icon: LogIn,         color: "text-violet-400",  bg: "bg-violet-900/30 border-violet-700/40" },
  logout:     { icon: LogIn,         color: "text-brand-400",   bg: "bg-brand-900/30 border-brand-700/40" },
  restock:    { icon: Warehouse,     color: "text-amber-400",   bg: "bg-amber-900/30 border-amber-700/40" },
  correction: { icon: Edit,          color: "text-orange-400",  bg: "bg-orange-900/30 border-orange-700/40" },
  spoilage:   { icon: AlertCircle,   color: "text-red-400",     bg: "bg-red-900/30 border-red-700/40" },
  dispatch:   { icon: Package,       color: "text-cyan-400",    bg: "bg-cyan-900/30 border-cyan-700/40" },
  export:     { icon: BarChart2,     color: "text-pink-400",    bg: "bg-pink-900/30 border-pink-700/40" },
  print:      { icon: BarChart2,     color: "text-teal-400",    bg: "bg-teal-900/30 border-teal-700/40" },
  clear:      { icon: Trash2,        color: "text-red-400",     bg: "bg-red-900/30 border-red-700/40" },
};

const RESOURCE_ICONS = {
  order:    ShoppingCart,
  product:  Warehouse,
  user:     User,
  customer: User,
  auth:     LogIn,
};

function ActionBadge({ action }) {
  const meta = ACTION_META[action] || { icon: Activity, color: "text-brand-400", bg: "bg-brand-900/30 border-brand-700/40" };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${meta.bg} ${meta.color}`}>
      <Icon className="w-2.5 h-2.5" />
      {action}
    </span>
  );
}

function ResourceIcon({ type }) {
  const Icon = RESOURCE_ICONS[type] || Activity;
  return <Icon className="w-3.5 h-3.5 text-brand-500 shrink-0" />;
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTimestamp(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

const PAGE_SIZE = 50;

export default function ActivityLog() {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  // Filters
  const [filterAction, setFilterAction] = useState("");
  const [filterResource, setFilterResource] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterDays, setFilterDays] = useState(7);
  const [search, setSearch] = useState("");

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        days: filterDays,
      });
      if (filterAction) params.append("action", filterAction);
      if (filterResource) params.append("resource_type", filterResource);
      if (filterUser) params.append("user_name", filterUser);

      const [logRes, summaryRes] = await Promise.all([
        api.get(`/api/audit?${params}`),
        api.get(`/api/audit/summary?days=${filterDays}`),
      ]);
      setEntries(logRes.data.entries || []);
      setTotal(logRes.data.total || 0);
      setSummary(summaryRes.data);
    } catch (err) {
      console.error("Failed to fetch activity log:", err);
    } finally {
      setLoading(false);
    }
  }, [page, filterAction, filterResource, filterUser, filterDays]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  const filteredEntries = search
    ? entries.filter(e =>
        (e.resource_label || "").toLowerCase().includes(search.toLowerCase()) ||
        (e.detail || "").toLowerCase().includes(search.toLowerCase()) ||
        (e.user_name || "").toLowerCase().includes(search.toLowerCase())
      )
    : entries;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-violet-400" />
            Activity Log
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">
            Complete accountability trail — every action by every user
          </p>
        </div>
        <button onClick={fetchLog} className="btn-secondary text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Summary KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card bg-surface-900 border-surface-700">
            <p className="text-xs text-violet-400 font-semibold uppercase tracking-wider">Total Actions</p>
            <p className="text-2xl font-bold text-white mt-1">{summary.total_actions.toLocaleString()}</p>
            <p className="text-xs text-brand-600 mt-1">Last {filterDays} days</p>
          </div>
          {summary.by_action?.slice(0, 3).map((a) => {
            const meta = ACTION_META[a.action] || {};
            return (
              <div key={a.action} className="card bg-surface-900 border-surface-700">
                <p className={`text-xs font-semibold uppercase tracking-wider ${meta.color || "text-brand-400"}`}>{a.action}</p>
                <p className="text-2xl font-bold text-white mt-1">{a.count}</p>
                <p className="text-xs text-brand-600 mt-1">operations</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Top Users & Actions mini panels */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card bg-surface-900 border-surface-700">
            <p className="text-xs text-brand-400 font-semibold uppercase tracking-wider mb-3">Most Active Users</p>
            <div className="space-y-2">
              {(summary.by_user || []).slice(0, 5).map((u, i) => (
                <div key={u.name} className="flex items-center gap-2">
                  <span className="text-xs text-brand-600 w-4 text-right">{i + 1}.</span>
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm text-white font-medium">{u.name}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 rounded-full bg-surface-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-500"
                          style={{ width: `${Math.min(100, (u.count / (summary.by_user[0]?.count || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-brand-400 w-8 text-right">{u.count}</span>
                    </div>
                  </div>
                </div>
              ))}
              {(!summary.by_user || summary.by_user.length === 0) && (
                <p className="text-xs text-brand-600">No activity recorded yet</p>
              )}
            </div>
          </div>

          <div className="card bg-surface-900 border-surface-700">
            <p className="text-xs text-brand-400 font-semibold uppercase tracking-wider mb-3">Actions Breakdown</p>
            <div className="space-y-2">
              {(summary.by_action || []).slice(0, 6).map((a) => {
                const meta = ACTION_META[a.action] || {};
                return (
                  <div key={a.action} className="flex items-center gap-2">
                    <span className={`text-xs font-bold uppercase w-20 ${meta.color || "text-brand-400"}`}>{a.action}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-surface-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${meta.color?.replace("text-", "bg-") || "bg-brand-500"}`}
                          style={{ width: `${Math.min(100, (a.count / (summary.by_action[0]?.count || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-brand-400 w-8 text-right">{a.count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card flex items-center flex-wrap gap-3">
        <Filter className="w-4 h-4 text-brand-500 shrink-0" />
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-600" />
          <input
            className="input pl-8 text-sm w-full"
            placeholder="Search label, detail, user..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="select text-sm" value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(0); }}>
          <option value="">All Actions</option>
          {Object.keys(ACTION_META).map((a) => (
            <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>
          ))}
        </select>
        <select className="select text-sm" value={filterResource} onChange={(e) => { setFilterResource(e.target.value); setPage(0); }}>
          <option value="">All Resources</option>
          <option value="order">Orders</option>
          <option value="product">Products</option>
          <option value="user">Users</option>
          <option value="customer">Customers</option>
          <option value="auth">Login</option>
        </select>
        <input
          className="input text-sm w-40"
          placeholder="User name..."
          value={filterUser}
          onChange={(e) => { setFilterUser(e.target.value); setPage(0); }}
        />
        <select className="select text-sm" value={filterDays} onChange={(e) => { setFilterDays(Number(e.target.value)); setPage(0); }}>
          <option value={1}>Last 24h</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last Year</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-800/60 border-b border-surface-700">
              <tr>
                <th className="th text-left">Timestamp</th>
                <th className="th text-left">User</th>
                <th className="th text-left">Role</th>
                <th className="th text-left">Action</th>
                <th className="th text-left">Resource</th>
                <th className="th text-left">Detail</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="td text-center text-brand-600 py-12">Loading activity log...</td></tr>
              ) : filteredEntries.length === 0 ? (
                <tr><td colSpan={6} className="td text-center text-brand-700 py-12">No activity found for the selected filters</td></tr>
              ) : (
                filteredEntries.map((entry) => {
                  const ResIcon = RESOURCE_ICONS[entry.resource_type] || Activity;
                  return (
                    <tr key={entry.id} className="tr-hover group">
                      <td className="td text-xs whitespace-nowrap">
                        <div className="text-white font-mono">{formatTimestamp(entry.created_at)}</div>
                        <div className="text-brand-600 text-[10px]">{timeAgo(entry.created_at)}</div>
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-brand-800/60 border border-brand-700/40 flex items-center justify-center shrink-0">
                            <User className="w-3 h-3 text-brand-400" />
                          </div>
                          <span className="text-white font-medium text-xs">{entry.user_name || "System"}</span>
                        </div>
                      </td>
                      <td className="td">
                        <span className="text-xs text-brand-400 uppercase font-mono">{entry.user_role || "—"}</span>
                      </td>
                      <td className="td">
                        <ActionBadge action={entry.action} />
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-1.5">
                          <ResIcon className="w-3.5 h-3.5 text-brand-500 shrink-0" />
                          <div>
                            <div className="text-xs text-brand-300 uppercase">{entry.resource_type || "—"}</div>
                            {entry.resource_label && (
                              <div className="text-[10px] text-brand-500 font-mono">{entry.resource_label}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="td max-w-[280px]">
                        <p className="text-xs text-brand-400 truncate group-hover:whitespace-normal group-hover:break-words"
                           title={entry.detail}>
                          {entry.detail || "—"}
                        </p>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-surface-700">
            <p className="text-xs text-brand-600">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} entries
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn-secondary text-xs py-1 px-2 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs text-brand-400">Page {page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="btn-secondary text-xs py-1 px-2 disabled:opacity-40"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
