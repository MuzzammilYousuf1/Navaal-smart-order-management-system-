import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Package, PlusCircle, BarChart2,
  Bell, Users, LogOut, Leaf, Menu, X, MapPin, Boxes, ClipboardList, QrCode, FileText, Calendar, BookUser
} from "lucide-react";
import useAuth from "../store/useAuth";
import { useState } from "react";

const navItems = [
  { to: "/",              icon: LayoutDashboard, label: "Dashboard" },
  { to: "/orders",        icon: Package,         label: "Orders" },
  { to: "/orders/new",    icon: PlusCircle,      label: "New Order" },
  { to: "/subscriptions", icon: Calendar,        label: "Subscriptions" },
  { to: "/customers",     icon: BookUser,        label: "Address Book" },
  { to: "/inventory",     icon: Boxes,           label: "Inventory" },
  { to: "/picklist",      icon: ClipboardList,   label: "Pick List" },
  { to: "/scan",          icon: QrCode,          label: "Scan QR" },
  { to: "/invoices",      icon: FileText,        label: "Invoices" },
  { to: "/tracking",      icon: MapPin,          label: "Live GPS Map" },
  { to: "/reporting",     icon: BarChart2,       label: "Reports" },
  { to: "/tasks",         icon: ClipboardList,   label: "Tasks & Reports" },
  { to: "/notifications", icon: Bell,            label: "Alerts" },
  { to: "/users",         icon: Users,           label: "Users" },
];

export default function Sidebar({ alertCount = 0 }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-30 rounded-xl bg-surface-800 border border-surface-600 p-2 text-brand-300 shadow-lg md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="w-5 h-5" />
      </button>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-surface-900 border-r border-surface-700 transition-transform duration-300 md:relative md:z-auto md:translate-x-0 md:shrink-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "md:w-16" : "md:w-60"}`}
      >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-surface-700">
        <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center shrink-0 shadow-lg shadow-brand-900/60">
          <Leaf className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight truncate">Navaal</p>
            <p className="text-xs text-brand-500 truncate">Organic Foods SOF</p>
          </div>
        )}
        <button
          onClick={() => window.innerWidth < 768 ? setMobileOpen(false) : setCollapsed(!collapsed)}
          className="ml-auto text-brand-500 hover:text-brand-300 transition-colors"
        >
          {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `nav-item ${isActive ? "active" : ""} ${collapsed ? "justify-center px-0" : ""}`
            }
            title={collapsed ? label : undefined}
          >
            <div className="relative shrink-0">
              <Icon className="w-5 h-5" />
              {label === "Alerts" && alertCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                  {alertCount > 9 ? "9+" : alertCount}
                </span>
              )}
            </div>
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-surface-700 px-2 py-3 space-y-2">
        {!collapsed && user && (
          <div className="px-3 py-2 rounded-xl bg-surface-800">
            <p className="text-xs font-semibold text-white truncate">{user.name}</p>
            <p className="text-[10px] text-brand-500 uppercase tracking-wider capitalize">{user.role}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className={`nav-item w-full text-red-400 hover:text-red-300 hover:bg-red-900/20 ${collapsed ? "justify-center px-0" : ""}`}
          title={collapsed ? "Logout" : undefined}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
      </aside>
    </>
  );
}
