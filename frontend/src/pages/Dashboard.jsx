import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package, Clock, Truck, CheckCircle, XCircle,
  AlertTriangle, DollarSign, Timer, TrendingUp, RefreshCw
} from "lucide-react";
import api from "../api/client";
import KPICard from "../components/KPICard";
import { StatusBadge, PriorityBadge } from "../components/StatusBadge";
import LiveTimer from "../components/LiveTimer";
import { format } from "date-fns";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [liveOrders, setLiveOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, liveRes] = await Promise.all([
        api.get("/api/dashboard/stats"),
        api.get("/api/dashboard/live-orders"),
      ]);
      setStats(statsRes.data);
      setLiveOrders(liveRes.data);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const rtsOrders = liveOrders.filter((o) => o.status === "ready_to_ship");
  const otdOrders = liveOrders.filter((o) => o.status === "out_for_delivery");
  const pendingOrders = liveOrders.filter((o) => o.status === "pending");

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-brand-500 animate-pulse text-sm">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Dashboard</h1>
          <p className="text-brand-500 text-sm mt-0.5">
            Last updated: {format(lastRefresh, "HH:mm:ss")}
          </p>
        </div>
        <button onClick={fetchData} className="btn-secondary">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard label="Today's Orders"    value={stats.total_today}      icon={Package}      color="green" />
          <KPICard label="Delivered Today"   value={stats.delivered_today}  icon={CheckCircle}  color="green" />
          <KPICard label="Pending"           value={stats.pending}          icon={Clock}        color="slate" />
          <KPICard label="Ready to Ship"     value={stats.ready_to_ship}    icon={Package}      color="amber" />
          <KPICard label="Out for Delivery"  value={stats.out_for_delivery} icon={Truck}        color="blue" />
          <KPICard label="Late Orders 🔴"   value={stats.late_orders}      icon={AlertTriangle} color="red" />
          <KPICard label="Revenue Today"
            value={`PKR ${(stats.revenue_today || 0).toLocaleString()}`}
            icon={DollarSign} color="green"
          />
          <KPICard label="Avg Packing"
            value={stats.avg_packing_time_min ? `${stats.avg_packing_time_min} min` : "—"}
            icon={Timer} color="purple"
          />
        </div>
      )}

      {/* Late Orders Alert */}
      {stats?.late_orders > 0 && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-2xl p-4 flex items-center gap-3 animate-pulse-slow">
          <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
          <div>
            <p className="text-red-300 font-semibold">
              {stats.late_orders} order{stats.late_orders > 1 ? "s" : ""} past the 45-minute pickup window!
            </p>
            <p className="text-red-500 text-xs mt-0.5">Rider has not picked up — immediate action required.</p>
          </div>
          <button onClick={() => navigate("/orders?status=ready_to_ship")} className="ml-auto btn-danger shrink-0">
            View
          </button>
        </div>
      )}

      {/* Tables Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Pending */}
        <LiveOrderTable
          title="Pending Orders"
          color="text-slate-400"
          orders={pendingOrders}
          navigate={navigate}
          emptyMsg="No pending orders"
          showTimer={false}
        />

        {/* Ready to Ship */}
        <LiveOrderTable
          title="Ready to Ship"
          color="text-amber-400"
          orders={rtsOrders}
          navigate={navigate}
          emptyMsg="No orders awaiting pickup"
          showTimer={true}
        />

        {/* Out for Delivery */}
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
