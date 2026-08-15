import { useEffect, useState } from "react";
import { FileText, Download, Printer, Clock, CheckCircle } from "lucide-react";
import api, { API_BASE } from "../api/client";

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/invoices/");
      setInvoices(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  const getAuthUrl = (path) => {
    const token = localStorage.getItem("sof_token");
    return `${API_BASE}${path}?token=${encodeURIComponent(token)}`;
  };

  const handleDownloadPDF = (orderId) => {
    window.open(getAuthUrl(`/api/invoices/${orderId}/pdf`), "_blank");
  };

  const handleDownloadReceipt = (orderId) => {
    window.open(getAuthUrl(`/api/invoices/${orderId}/receipt`), "_blank");
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-emerald-400" />
            PDF Invoices & Delivery Receipts
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">
            Download branded A4 PDF invoices & print 80mm thermal receipts with delivery time breakdowns
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="table-wrap">
          <table className="table">
            <thead className="thead">
              <tr>
                <th className="th">Order #</th>
                <th className="th">Customer</th>
                <th className="th">City</th>
                <th className="th">Status</th>
                <th className="th">Amount</th>
                <th className="th">Total Time</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="td text-center text-brand-600 py-12">Loading invoices...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={7} className="td text-center text-brand-700 py-12">No invoices generated yet</td></tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="tr-hover">
                    <td className="td font-mono font-bold text-brand-300">{inv.order_number}</td>
                    <td className="td">
                      <p className="font-semibold text-white">{inv.customer_name}</p>
                      <p className="text-xs text-brand-500">{inv.customer_phone}</p>
                    </td>
                    <td className="td text-xs text-brand-400">{inv.city || "—"}</td>
                    <td className="td">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-surface-800 text-brand-300 border border-surface-700">
                        {inv.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="td font-bold text-emerald-400">PKR {(inv.total_amount || 0).toLocaleString()}</td>
                    <td className="td text-xs">
                      {inv.total_fulfillment_time ? (
                        <span className="px-2 py-0.5 bg-emerald-950/50 text-emerald-400 rounded-md font-mono font-semibold flex items-center gap-1 w-fit">
                          <Clock className="w-3 h-3" /> {inv.total_fulfillment_time}
                        </span>
                      ) : (
                        <span className="text-brand-600">—</span>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDownloadPDF(inv.id)}
                          className="btn-secondary text-xs px-2.5 py-1 border-brand-700/60 text-brand-300"
                        >
                          <Download className="w-3.5 h-3.5 text-emerald-400" /> A4 Invoice
                        </button>
                        <button
                          onClick={() => handleDownloadReceipt(inv.id)}
                          className="btn-secondary text-xs px-2.5 py-1 border-brand-700/60 text-brand-300"
                        >
                          <Printer className="w-3.5 h-3.5 text-amber-400" /> Receipt
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
