import { useEffect, useState, useRef } from "react";
import { QrCode, CheckCircle, AlertCircle, PackageCheck, Search, ArrowRight } from "lucide-react";
import { Html5QrcodeScanner } from "html5-qrcode";
import api from "../api/client";
import { useNavigate } from "react-router-dom";

export default function ScanOrder() {
  const [manualCode, setManualCode] = useState("");
  const [scannedOrder, setScannedOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [verifiedItems, setVerifiedItems] = useState({});
  const [packingDone, setPackingDone] = useState(false);
  const navigate = useNavigate();

  const handleScanSuccess = async (decodedText) => {
    fetchOrderDetails(decodedText);
  };

  const fetchOrderDetails = async (codeStr) => {
    if (!codeStr) return;
    setLoading(true);
    setErrorMsg("");
    setPackingDone(false);
    try {
      const { data } = await api.get(`/api/invoices/scan/${encodeURIComponent(codeStr.trim())}`);
      setScannedOrder(data);
      // Reset verified items checklist
      const vMap = {};
      (data.items || []).forEach((it, idx) => {
        vMap[idx] = false;
      });
      setVerifiedItems(vMap);
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || "Order not found or invalid barcode scan.");
      setScannedOrder(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      "reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose= */ false
    );

    scanner.render(
      (text) => {
        handleScanSuccess(text);
        scanner.clear().catch(console.error);
      },
      (err) => {
        // ignore scan errors
      }
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, []);

  const toggleItemVerify = (idx) => {
    setVerifiedItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const allItemsVerified = scannedOrder && scannedOrder.items.length > 0 &&
    scannedOrder.items.every((_, idx) => verifiedItems[idx]);

  const handleConfirmRTS = async () => {
    if (!scannedOrder) return;
    setLoading(true);
    try {
      await api.post(`/api/orders/${scannedOrder.id}/status`, {
        new_status: "ready_to_ship",
        note: "Pack Verified via QR Code Scan",
      });
      setPackingDone(true);
    } catch (err) {
      alert(err.response?.data?.detail || "Packing verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <QrCode className="w-6 h-6 text-emerald-400" />
            Barcode & QR Packing Verification Scanner
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">
            Scan invoice QR codes with your camera or hardware USB barcode scanner
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Scanner Column */}
        <div className="space-y-4">
          {/* Manual Input / Hardware Scanner Box */}
          <div className="card space-y-3 bg-surface-900 border-surface-700">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">USB Barcode Scanner / Manual Entry</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchOrderDetails(manualCode);
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-500" />
                <input
                  type="text"
                  className="input pl-9 font-mono"
                  placeholder="Scan or enter code (e.g. NOF-2026-0001)..."
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-primary">
                Lookup
              </button>
            </form>
          </div>

          {/* Camera Scanner Box */}
          <div className="card space-y-3 bg-surface-900 border-surface-700">
            <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wider">Live Camera Scanner</h2>
            <div id="reader" className="w-full rounded-xl overflow-hidden bg-black text-white"></div>
          </div>
        </div>

        {/* Verification Result Column */}
        <div className="space-y-4">
          {errorMsg && (
            <div className="card bg-red-950/40 border-red-700/50 text-red-300 flex items-center gap-3">
              <AlertCircle className="w-8 h-8 text-red-400 shrink-0" />
              <div>
                <p className="font-bold text-sm">🔴 SCAN UNVERIFIED</p>
                <p className="text-xs">{errorMsg}</p>
              </div>
            </div>
          )}

          {packingDone && (
            <div className="card bg-emerald-950/40 border-emerald-700/50 text-emerald-300 flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-emerald-400 shrink-0" />
              <div>
                <p className="font-bold text-sm">✅ PACK VERIFIED & READY TO SHIP!</p>
                <p className="text-xs">Order #{scannedOrder?.order_number} marked as Ready to Ship.</p>
              </div>
            </div>
          )}

          {scannedOrder && (
            <div className="card space-y-4 bg-surface-900 border-emerald-700/40">
              <div className="flex items-center justify-between border-b border-surface-700 pb-3">
                <div>
                  <span className="text-xs text-brand-500 uppercase tracking-wider font-bold">Scanned Order</span>
                  <h2 className="text-xl font-bold font-mono text-emerald-400">{scannedOrder.order_number}</h2>
                </div>
                <span className="px-3 py-1 bg-surface-800 text-brand-300 rounded-full font-semibold text-xs capitalize">
                  {scannedOrder.status.replace("_", " ")}
                </span>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">{scannedOrder.customer_name}</p>
                <p className="text-xs text-brand-500">{scannedOrder.customer_phone}</p>
                <p className="text-xs text-brand-400">{scannedOrder.city}</p>
              </div>

              {/* Items Verification Checklist */}
              <div className="space-y-2 pt-2 border-t border-surface-800">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-brand-400 uppercase tracking-wider">Item Verification Checklist</p>
                  <span className="text-xs text-brand-500">Tap items to verify</span>
                </div>

                {(scannedOrder.items || []).map((it, idx) => (
                  <div
                    key={idx}
                    onClick={() => toggleItemVerify(idx)}
                    className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-colors ${
                      verifiedItems[idx]
                        ? "bg-emerald-950/40 border-emerald-700/60 text-emerald-300"
                        : "bg-surface-800 border-surface-700 text-white hover:border-brand-600"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold">{it.product_name}</p>
                      <p className="text-xs opacity-75">Qty: {it.quantity} × PKR {it.unit_price}</p>
                    </div>
                    <CheckCircle className={`w-5 h-5 ${verifiedItems[idx] ? "text-emerald-400" : "text-surface-600"}`} />
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-surface-700 flex items-center justify-between">
                <span className="text-sm font-bold text-white">Total: PKR {scannedOrder.total_amount?.toLocaleString()}</span>

                <button
                  onClick={handleConfirmRTS}
                  disabled={!allItemsVerified || loading || packingDone}
                  className={`btn ${allItemsVerified ? "btn-emerald" : "btn-secondary opacity-50"} text-sm font-bold px-6`}
                >
                  <PackageCheck className="w-4 h-4" />
                  {packingDone ? "Verified" : allItemsVerified ? "PACK VERIFIED (RTS)" : "Verify All Items"}
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
