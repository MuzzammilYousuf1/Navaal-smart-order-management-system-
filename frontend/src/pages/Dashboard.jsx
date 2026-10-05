import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package, Clock, Truck, CheckCircle, AlertTriangle,
  DollarSign, Timer, RefreshCw, Boxes, TrendingDown,
  Egg, Building2, ShieldAlert, BarChart3, Layers,
  PackageX, ArrowRight
} from "lucide-react";
import api from "../api/client";
import KPICard from "../components/KPICard";
import { PriorityBadge } from "../components/StatusBadge";
import LiveTimer from "../components/LiveTimer";
import { format } from "date-fns";
import useAuth from "../store/useAuth";

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "manager";

  const [stats, setStats] = useState(null);
  const [liveOrders, setLiveOrders] = useState([]);
  const [invSummary, setInvSummary] = useState(null);
  const [lowStockProducts, setLowStockProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    try {
      const requests = [
        api.get("/api/dashboard/stats"),
        api.get("/api/dashboard/live-orders"),
        api.get("/api/inventory/products"),
      ];

      // Admin gets warehouse summary too
      if (isAdmin) {
        const today = new Date();
        const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
          .toISOString().split("T")[0];
        const todayStr = today.toISOString().split("T")[0];
        requests.push(
          api.get("/api/daily-inventory/summary", {
            params: { start_date: firstOfMonth, end_date: todayStr },
          })
        );
      }

      const results = await Promise.all(requests.map((r) => r.catch(() => null)));

      setStats(results[0]?.data ?? null);
      setLiveOrders(results[1]?.data ?? []);

      const products = results[2]?.data ?? [];
      const low = products.filter(
        (p) => p.stock_qty !== undefined && p.stock_qty <= (p.low_stock_threshold ?? 10)
      );
      setLowStockProducts(low);

      if (isAdmin && results[3]) {
        setInvSummary(results[3].data);
      }

      setLastRefresh(new Date());
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const rtsOrders     = liveOrders.filter((o) => o.status === "ready_to_ship");
  const otdOrders     = liveOrders.filter((o) => o.status === "out_for_delivery");
  const pendingOrders = liveOrders.filter((o) => o.status === "pending");

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
          <p className="text-brand-500 text-sm animate-pulse">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Dashboard</h1>
          <p className="text-brand-500 text-xs mt-0.5">
            Last updated: {format(lastRefresh, "HH:mm:ss")} · Auto-refreshes every 30 s
          </p>
        </div>
        <button id="dashboard-refresh-btn" onClick={fetchData} className="btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* ── Order KPI Cards ── */}
      {stats && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-widest text-surface-500 mb-3">
            Orders — Today
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
            <KPICard label="Total Today"      value={stats.total_today}      icon={Package}       color="green" />
            <KPICard label="Delivered"        value={stats.delivered_today}  icon={CheckCircle}   color="green" />
            <KPICard label="Pending"          value={stats.pending}          icon={Clock}         color="slate" />
            <KPICard label="Ready to Ship"    value={stats.ready_to_ship}    icon={Package}       color="amber" />
            <KPICard label="Out for Delivery" value={stats.out_for_delivery} icon={Truck}         color="blue" />
            <KPICard label="Late Orders 🔴"  value={stats.late_orders}      icon={AlertTriangle} color="red" />
            <KPICard
              label="Revenue Today"
              value={<span data-sensitive-money>{`PKR ${(stats.revenue_today || 0).toLocaleString()}`}</span>}
              icon={DollarSign}
              color="green"
            />
            <KPICard
              label="Avg Packing"
              value={stats.avg_packing_time_min ? `${stats.avg_packing_time_min} min` : "—"}
              icon={Timer}
              color="purple"
            />
          </div>
        </section>
      )}

      {/* ── Late Orders Alert ── */}
      {stats?.late_orders > 0 && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-2xl p-4 flex items-center gap-3 animate-pulse-slow">
          <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
          <div>
            <p className="text-red-300 font-semibold">
              {stats.late_orders} order{stats.late_orders > 1 ? "s" : ""} past the 45-minute pickup window!
            </p>
            <p className="text-red-500 text-xs mt-0.5">Rider has not picked up — immediate action required.</p>
          </div>
          <button
            id="late-orders-view-btn"
            onClick={() => navigate("/orders?status=ready_to_ship")}
            className="ml-auto btn-danger shrink-0"
          >
            View
          </button>
        </div>
      )}

      {/* ── Warehouse Inventory Summary (Admin / Manager) ── */}
      {isAdmin && invSummary && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-surface-500">
              Warehouse — This Month
            </p>
            <button
              id="goto-warehouse-btn"
              onClick={() => navigate("/daily-inventory")}
              className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors font-medium"
            >
              Full Warehouse View <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Raw Egg Stock */}
            <div className="col-span-2 sm:col-span-1 p-4 rounded-2xl bg-surface-900 border border-emerald-500/20 space-y-1.5 shadow-lg">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Egg className="w-4 h-4 text-emerald-400" />
                </div>
                <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Egg Stock</span>
              </div>
              <div className="text-2xl font-black text-white">
                {invSummary.total_stock_in_hand.toLocaleString()}
              </div>
              <div className="text-xs text-surface-500 space-y-0.5">
                <div>~<span className="text-amber-300 font-semibold">{invSummary.total_petis_in_hand}</span> Petis (480)</div>
                <div>~<span className="text-blue-300 font-semibold">{invSummary.total_cartons_in_hand}</span> Cartons (360)</div>
              </div>
            </div>

            {/* Total Added */}
            <div className="p-4 rounded-2xl bg-surface-900 border border-surface-700 space-y-1 shadow">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Layers className="w-4 h-4 text-brand-400" />
                <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Received</span>
              </div>
              <div className="text-xl font-black text-white">{invSummary.total_added.toLocaleString()}</div>
              <div className="text-xs text-surface-500">eggs this month</div>
            </div>

            {/* Purchase Cost */}
            <div className="p-4 rounded-2xl bg-surface-900 border border-surface-700 space-y-1 shadow">
              <div className="flex items-center gap-1.5 mb-1.5">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Purchased</span>
              </div>
              <div className="text-xl font-black text-white">
                {invSummary.total_purchase_cost > 0
                  ? `PKR ${invSummary.total_purchase_cost.toLocaleString()}`
                  : "—"}
              </div>
              <div className="text-xs text-surface-500">total cost</div>
            </div>

            {/* Spoilage */}
            <div className="p-4 rounded-2xl bg-surface-900 border border-red-500/20 space-y-1 shadow">
              <div className="flex items-center gap-1.5 mb-1.5">
                <PackageX className="w-4 h-4 text-red-400" />
                <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Spoiled</span>
              </div>
              <div className="text-xl font-black text-red-300">{invSummary.total_spoiled.toLocaleString()}</div>
              <div className="text-xs text-surface-500">eggs spoiled</div>
            </div>

            {/* Breakage */}
            <div className="p-4 rounded-2xl bg-surface-900 border border-orange-500/20 space-y-1 shadow">
              <div className="flex items-center gap-1.5 mb-1.5">
                <ShieldAlert className="w-4 h-4 text-orange-400" />
                <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Damaged</span>
              </div>
              <div className="text-xl font-black text-orange-300">{invSummary.total_broken.toLocaleString()}</div>
              <div className="text-xs text-surface-500">eggs broken</div>
            </div>

            {/* Loss PKR */}
            <div className="p-4 rounded-2xl bg-surface-900 border border-red-500/20 space-y-1 shadow">
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">Loss</span>
              </div>
              <div className="text-xl font-black text-red-300">
                {invSummary.total_loss_pkr > 0
                  ? `PKR ${invSummary.total_loss_pkr.toLocaleString()}`
                  : "—"}
              </div>
              <div className="text-xs text-surface-500">total loss</div>
            </div>
          </div>

          {/* Vendor Accountability mini table */}
          {invSummary.vendor_accountability?.length > 0 && (
            <div className="mt-3 bg-surface-900 border border-surface-700/80 rounded-2xl overflow-hidden shadow">
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700/50">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Vendor Accountability — This Month
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-surface-800">
                      <th className="text-left px-4 py-2.5 text-surface-500 font-semibold">Vendor / Farm</th>
                      <th className="text-right px-3 py-2.5 text-surface-500 font-semibold">Petis</th>
                      <th className="text-right px-3 py-2.5 text-surface-500 font-semibold">Cartons</th>
                      <th className="text-right px-3 py-2.5 text-surface-500 font-semibold">Total Eggs</th>
                      <th className="text-right px-3 py-2.5 text-surface-500 font-semibold">Cost (PKR)</th>
                      <th className="text-right px-3 py-2.5 text-surface-500 font-semibold text-red-400">Spoiled</th>
                      <th className="text-right px-3 py-2.5 text-surface-500 font-semibold text-orange-400">Broken</th>
                      <th className="text-right px-4 py-2.5 text-surface-500 font-semibold">Loss %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invSummary.vendor_accountability.slice(0, 5).map((v, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors"
                      >
                        <td className="px-4 py-2.5 font-semibold text-white">{v.vendor_name}</td>
                        <td className="px-3 py-2.5 text-right text-amber-300">{v.total_petis}</td>
                        <td className="px-3 py-2.5 text-right text-blue-300">{v.total_cartons}</td>
                        <td className="px-3 py-2.5 text-right text-white font-semibold">{v.total_eggs_received.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right text-green-300">
                          {v.total_cost_pkr > 0 ? v.total_cost_pkr.toLocaleString() : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-red-300">{v.total_spoiled_eggs}</td>
                        <td className="px-3 py-2.5 text-right text-orange-300">{v.total_broken_eggs}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold ${
                              v.spoilage_rate_pct > 5
                                ? "bg-red-500/20 text-red-300"
                                : v.spoilage_rate_pct > 2
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-emerald-500/20 text-emerald-300"
                            }`}
                          >
                            {v.spoilage_rate_pct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Low Stock Alert ── */}
      {lowStockProducts.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Boxes className="w-5 h-5 text-amber-400" />
            <p className="text-amber-300 font-semibold text-sm">
              {lowStockProducts.length} product{lowStockProducts.length > 1 ? "s" : ""} low on stock
            </p>
            <button
              id="goto-inventory-btn"
              onClick={() => navigate("/inventory")}
              className="ml-auto text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
            >
              Manage Inventory <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStockProducts.slice(0, 8).map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-1.5 bg-amber-950/40 border border-amber-800/30 rounded-lg px-2.5 py-1"
              >
                <span className="text-xs text-amber-300 font-semibold">{p.name}</span>
                <span className="text-xs text-amber-600 font-bold">
                  ({p.stock_qty} left)
                </span>
              </div>
            ))}
            {lowStockProducts.length > 8 && (
              <span className="text-xs text-amber-600 self-center">
                +{lowStockProducts.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Live Order Tables ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <LiveOrderTable
          title="Pending Orders"
          color="text-slate-400"
          orders={pendingOrders}
          navigate={navigate}
          emptyMsg="No pending orders"
          showTimer={false}
        />
        <LiveOrderTable
          title="Ready to Ship"
          color="text-amber-400"
          orders={rtsOrders}
          navigate={navigate}
          emptyMsg="No orders awaiting pickup"
          showTimer={true}
        />
        <LiveOrderTable
          title="Out for Delivery"
          color="text-blue-400"
          orders={otdOrders}
          navigate={navigate}
          emptyMsg="No orders in transit"
          showTimer={false}
        />
      </div>
    </div>
  );
}

function LiveOrderTable({ title, color, orders, navigate, emptyMsg, showTimer }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className={`font-semibold text-sm ${color}`}>{title}</h3>
        <span className="text-xs bg-surface-800 px-2.5 py-1 rounded-full text-brand-400 font-semibold">
          {orders.length}
        </span>
      </div>

      {orders.length === 0 ? (
        <p className="text-brand-700 text-sm text-center py-6">{emptyMsg}</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {orders.map((order) => (
            <div
              key={order.id}
              onClick={() => navigate(`/orders/${order.id}`)}
              className={`
                p-3 rounded-xl bg-surface-800 border cursor-pointer
                transition-all duration-150 hover:border-brand-700/50
                ${order.is_late ? "border-red-700/40 bg-red-900/10" : "border-surface-700"}
              `}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-brand-300">{order.order_number}</span>
                <PriorityBadge priority={order.priority} />
              </div>
              <p className="text-sm font-medium text-white truncate">{order.customer_name}</p>
              <p className="text-xs text-brand-600 truncate">{order.city}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-brand-500">
                  PKR {(order.total_amount || 0).toLocaleString()}
                </span>
                {showTimer && (
                  <LiveTimer pickupDeadline={order.pickup_deadline} status={order.status} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
