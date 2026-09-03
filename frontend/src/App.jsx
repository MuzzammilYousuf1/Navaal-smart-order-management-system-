import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useCallback } from "react";
import useAuth from "./store/useAuth";
import { useWebSocket } from "./hooks/useWebSocket";

import Sidebar from "./components/Sidebar";
import NotificationToast from "./components/NotificationToast";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import NewOrder from "./pages/NewOrder";
import Reports from "./pages/Reports";
import Notifications from "./pages/Notifications";
import Users from "./pages/Users";
import RiderMap from "./pages/RiderMap";
import Inventory from "./pages/Inventory";
import PickList from "./pages/PickList";
import ScanOrder from "./pages/ScanOrder";
import Invoices from "./pages/Invoices";
import Subscriptions from "./pages/Subscriptions";
import Tasks from "./pages/Tasks";
import CustomerProfiles from "./pages/CustomerProfiles";
import Accounts from "./pages/Accounts";

function ProtectedLayout() {
  const [toasts, setToasts] = useState([]);
  const [alertCount, setAlertCount] = useState(0);

  const handleWsMessage = useCallback((data) => {
    if (data.type === "sla_alert") {
      const id = Date.now();
      setToasts((prev) => [...prev.slice(-4), { ...data, id }]);
      setAlertCount((c) => c + 1);
      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 8000);
    }
  }, []);

  useWebSocket(handleWsMessage);

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar alertCount={alertCount} />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Routes>
          <Route path="/"               element={<Dashboard />} />
          <Route path="/orders"         element={<Orders />} />
          <Route path="/orders/new"     element={<NewOrder />} />
          <Route path="/orders/:id"     element={<OrderDetail />} />
          <Route path="/inventory"      element={<Inventory />} />
          <Route path="/picklist"       element={<PickList />} />
          <Route path="/scan"           element={<ScanOrder />} />
          <Route path="/invoices"       element={<Invoices />} />
          <Route path="/tracking"       element={<RiderMap />} />
          <Route path="/reports"        element={<Reports />} />
          <Route path="/reporting"      element={<Reports />} />
          <Route path="/subscriptions"   element={<Subscriptions />} />
          <Route path="/customers"       element={<CustomerProfiles />} />
          <Route path="/accounts"        element={<Accounts />} />
          <Route path="/notifications"  element={<Notifications />} />
          <Route path="/users"          element={<Users />} />
          <Route path="/tasks"          element={<Tasks />} />
          <Route path="*"               element={<Navigate to="/" />} />
        </Routes>
      </main>
      <NotificationToast notifications={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function RequireAuth({ children }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { token } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" /> : <Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <ProtectedLayout />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
