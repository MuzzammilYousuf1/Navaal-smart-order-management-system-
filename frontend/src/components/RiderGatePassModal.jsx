import { useEffect, useState } from "react";
import { Truck, Printer, CheckCircle2, DollarSign, Package, AlertCircle, X, Search, FileText } from "lucide-react";
import api, { API_BASE } from "../api/client";

export default function RiderGatePassModal({ isOpen, onClose, onDispatchSuccess }) {
  const [riders, setRiders] = useState([]);
  const [selectedRider, setSelectedRider] = useState(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [successResult, setSuccessResult] = useState(null);

  const fetchRiders = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/orders/riders/summary");
      setRiders(data);
      if (data.length > 0 && !selectedRider) {
        setSelectedRider(data[0]);
        // Default select all 'ready_to_ship' order IDs for this rider
        const rtsIds = data[0].orders.filter(o => o.status === "ready_to_ship").map(o => o.id);
        setSelectedOrderIds(rtsIds);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRiders();
    }
  }, [isOpen]);

  const handleRiderSelect = (r) => {
    setSelectedRider(r);
    const rtsIds = r.orders.filter(o => o.status === "ready_to_ship" || o.status === "out_for_delivery").map(o => o.id);
    setSelectedOrderIds(rtsIds);
    setSuccessResult(null);
  };

  const toggleOrderSelect = (orderId) => {
    setSelectedOrderIds(prev => 
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };

  const selectAllRts = () => {
    if (!selectedRider) return;
    const rtsIds = selectedRider.orders.filter(o => o.status === "ready_to_ship").map(o => o.id);
    setSelectedOrderIds(rtsIds);
  };

  const handleDispatch = async () => {
    if (!selectedRider || selectedOrderIds.length === 0) {
      alert("Please select at least one order for the rider.");
      return;
    }
    setDispatching(true);
    try {
      const { data } = await api.post("/api/orders/gate-pass/dispatch", {
        rider_name: selectedRider.rider_name,
        order_ids: selectedOrderIds,
        vehicle_number: vehicleNumber || "N/A",
      });
      setSuccessResult(data);
      if (onDispatchSuccess) onDispatchSuccess();
      fetchRiders();
    } catch (err) {
      alert(err.response?.data?.detail || "Gate pass dispatch failed");
    } finally {
      setDispatching(false);
    }
  };

  const openPdfGatePass = (formatType = "a4") => {
    const token = localStorage.getItem("sof_token");
    const orderIdsStr = selectedOrderIds.join(",");
    const url = `${API_BASE}/api/invoices/gate-pass/pdf?rider_name=${encodeURIComponent(selectedRider.rider_name)}&order_ids=${orderIdsStr}&format=${formatType}&token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  };

  if (!isOpen) return null;

  const currentOrders = selectedRider ? selectedRider.orders : [];
  const selectedOrdersCount = selectedOrderIds.length;
  const totalSelectedCod = currentOrders
    .filter(o => selectedOrderIds.includes(o.id) && (o.payment_method === "cod" || o.payment_status === "cod"))
    .reduce((sum, o) => sum + (o.total_amount || 0), 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
      <div className="card w-full max-w-4xl bg-surface-900 border-surface-700 space-y-5 my-8">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-surface-700 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-brand-600/20 text-brand-400 border border-brand-500/30">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                Rider Gate Pass & Out For Delivery Dispatch
              </h2>
              <p className="text-xs text-brand-500">
                Filter per rider, print gate pass slips, and set status to Out for Delivery.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-brand-500 hover:text-white hover:bg-surface-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="py-16 text-center text-brand-500 animate-pulse">Loading rider data...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

            {/* Left Column: Riders List */}
            <div className="card bg-surface-850 p-3 space-y-3">
              <p className="text-xs font-bold text-brand-400 uppercase tracking-wider">Select Rider</p>
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {riders.length === 0 ? (
                  <p className="text-xs text-brand-600 text-center py-4">No riders found</p>
                ) : (
                  riders.map(r => {
                    const isSel = selectedRider?.rider_name === r.rider_name;
                    return (
                      <div
                        key={r.rider_name}
                        onClick={() => handleRiderSelect(r)}
                        className={`p-3 rounded-xl cursor-pointer border transition-all ${
                          isSel
                            ? "bg-brand-950/60 border-brand-500 text-white shadow-lg shadow-brand-950/40"
                            : "bg-surface-800 border-surface-700 text-brand-300 hover:border-surface-600"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-sm truncate">{r.rider_name}</p>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-700 text-brand-300">
                            {r.assigned_count} orders
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs mt-2 text-brand-500">
                          <span>RTS: <b className="text-amber-400">{r.rts_count}</b></span>
                          <span>Out: <b className="text-sky-400">{r.out_count}</b></span>
                          <span>COD: <b className="text-emerald-400">PKR {r.total_cod_amount.toLocaleString()}</b></span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Rider Orders & Gate Pass Actions */}
            <div className="md:col-span-2 space-y-4">
              
              {selectedRider ? (
                <>
                  {/* Rider Meta & Vehicle Input */}
                  <div className="card bg-surface-850 p-4 flex flex-wrap items-center justify-between gap-3 border-brand-800/40">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        {selectedRider.rider_name}
                      </h3>
                      <p className="text-xs text-brand-500">
                        Assigned Orders: {selectedRider.assigned_count} | Expected Cash Bring-Back: <b className="text-emerald-400">PKR {totalSelectedCod.toLocaleString()}</b>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Vehicle # (e.g. KKB-9382)"
                        className="input text-xs w-40"
                        value={vehicleNumber}
                        onChange={e => setVehicleNumber(e.target.value)}
                      />
                      <button onClick={selectAllRts} className="btn-secondary text-xs">
                        Select All RTS
                      </button>
                    </div>
                  </div>

                  {/* Orders Table */}
                  <div className="card p-0 overflow-hidden max-h-[260px] overflow-y-auto">
                    <table className="table">
                      <thead className="thead">
                        <tr>
                          <th className="th w-8">
                            <input
                              type="checkbox"
                              checked={selectedOrderIds.length > 0 && selectedOrderIds.length === currentOrders.length}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedOrderIds(currentOrders.map(o => o.id));
                                else setSelectedOrderIds([]);
                              }}
                            />
                          </th>
                          <th className="th">Order #</th>
                          <th className="th">Customer</th>
                          <th className="th">Status</th>
                          <th className="th">COD Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentOrders.length === 0 ? (
                          <tr><td colSpan={5} className="td text-center text-brand-600 py-6">No orders assigned to this rider</td></tr>
                        ) : (
                          currentOrders.map(o => {
                            const isChecked = selectedOrderIds.includes(o.id);
                            return (
                              <tr key={o.id} className={`tr-hover ${isChecked ? "bg-brand-950/30" : ""}`} onClick={() => toggleOrderSelect(o.id)}>
                                <td className="td" onClick={e => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleOrderSelect(o.id)}
                                  />
                                </td>
                                <td className="td font-mono font-bold text-brand-300 text-xs">{o.order_number}</td>
                                <td className="td text-xs">
                                  <p className="font-semibold text-white">{o.customer_name}</p>
                                  <p className="text-[10px] text-brand-500">{o.delivery_address || o.city}</p>
                                </td>
                                <td className="td text-xs">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    o.status === "ready_to_ship" ? "bg-amber-950 text-amber-400 border border-amber-800/40" :
                                    o.status === "out_for_delivery" ? "bg-sky-950 text-sky-400 border border-sky-800/40" :
                                    "bg-emerald-950 text-emerald-400 border border-emerald-800/40"
                                  }`}>
                                    {o.status.replace("_", " ")}
                                  </span>
                                </td>
                                <td className="td font-bold text-emerald-400 text-xs text-right">
                                  PKR {(o.total_amount || 0).toLocaleString()}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary Footer & Dispatch Actions */}
                  <div className="card bg-emerald-950/30 border-emerald-800/50 p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="text-xs text-brand-400">Total Orders Selected for Gate Pass:</p>
                        <p className="text-lg font-bold text-white">{selectedOrdersCount} orders selected</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-brand-400">Total COD Amount to Collect:</p>
                        <p className="text-xl font-bold text-emerald-400">PKR {totalSelectedCod.toLocaleString()}</p>
                      </div>
                    </div>

                    {successResult && (
                      <div className="p-3 bg-emerald-900/60 border border-emerald-600 rounded-xl flex items-center justify-between flex-wrap gap-2 text-xs text-emerald-200">
                        <span>Gate Pass <b>{successResult.gate_pass_no}</b> Generated! {successResult.message}</span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => openPdfGatePass("a4")} className="btn-primary text-xs py-1 px-2.5 bg-emerald-700 hover:bg-emerald-600 flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" /> A4 Gate Pass
                          </button>
                          <button onClick={() => openPdfGatePass("thermal")} className="btn-primary text-xs py-1 px-2.5 bg-emerald-600 hover:bg-emerald-500 flex items-center gap-1">
                            <Printer className="w-3.5 h-3.5" /> Thermal Slips (80mm)
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end items-center flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => openPdfGatePass("a4")}
                        disabled={selectedOrderIds.length === 0}
                        className="btn-secondary text-xs flex items-center gap-1 text-brand-300 border-brand-700"
                      >
                        <FileText className="w-4 h-4 text-emerald-400" /> Preview A4 Summary
                      </button>

                      <button
                        onClick={() => openPdfGatePass("thermal")}
                        disabled={selectedOrderIds.length === 0}
                        className="btn-secondary text-xs flex items-center gap-1 text-brand-300 border-brand-700"
                      >
                        <Printer className="w-4 h-4 text-amber-400" /> Thermal Slips (80mm)
                      </button>

                      <button
                        onClick={handleDispatch}
                        disabled={dispatching || selectedOrderIds.length === 0}
                        className="btn-primary text-xs flex items-center gap-1.5 py-2 px-4 shadow-lg shadow-brand-900/60"
                      >
                        <Truck className="w-4 h-4" />
                        {dispatching ? "Dispatching..." : "Dispatch & Set Out For Delivery"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="card text-center py-16 text-brand-600">
                  Select a rider from the left panel to generate gate pass details.
                </div>
              )}

            </div>
          </div>
        )}

      </div>
    </div>
  );
}
