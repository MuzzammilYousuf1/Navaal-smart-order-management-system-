import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet, Search, Plus, RefreshCw, Phone, UserCheck, ShieldCheck, Trash2, Edit3,
  CheckCircle, FileText, Download, X, DollarSign, PlusCircle, BookOpen, AlertCircle,
  FileSpreadsheet, Receipt, HelpCircle, User, Landmark, Building
} from "lucide-react";
import api, { API_BASE } from "../api/client";

export default function Accounts() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("accounts");
  
  // Summaries
  const [summary, setSummary] = useState({
    total_accounts: 0,
    b2b_count: 0,
    b2c_count: 0,
    total_receivable: 0,
    b2b_receivable: 0,
    b2c_receivable: 0,
    overdue_invoices_count: 0
  });

  // Accounts List States
  const [accounts, setAccounts] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Invoices States
  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);

  // Status Message
  const [statusMsg, setStatusMsg] = useState("");

  // Account Modal (Add/Edit)
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountForm, setAccountForm] = useState({
    name: "",
    phone: "",
    email: "",
    delivery_address: "",
    city: "Karachi",
    notes: "",
    account_type: "b2c",
    company_name: "",
    contact_person: "",
    tax_id: "",
    credit_limit: 0,
    payment_terms: "cod",
    opening_balance: 0,
    is_account_active: true
  });

  // Ledger States
  const [selectedLedgerCustomer, setSelectedLedgerCustomer] = useState(null);
  const [ledgerStatement, setLedgerStatement] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerForm, setLedgerForm] = useState({
    entry_type: "credit",
    amount: "",
    description: "",
    payment_method: "cash",
    reference_no: "",
    notes: ""
  });
  const [postingLedger, setPostingLedger] = useState(false);

  // Invoice Modal
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    customer_id: "",
    invoice_type: "sale",
    due_date: "",
    discount_amount: 0,
    tax_amount: 0,
    notes: "",
    payment_terms: "cod",
    line_items: [{ description: "", qty: 1, unit_price: 0, total: 0 }]
  });
  const [savingInvoice, setSavingInvoice] = useState(false);

  // Invoice Details / Record Payment modal
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_method: "bank_transfer",
    reference_no: "",
    notes: ""
  });
  const [recordingPayment, setRecordingPayment] = useState(false);

  const getAuthUrl = (path) => {
    const token = localStorage.getItem("sof_token");
    return `${API_BASE}${path}?token=${encodeURIComponent(token)}`;
  };

  const showStatus = (msg) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(""), 5000);
  };

  // Fetch summaries
  const fetchSummary = async () => {
    try {
      const res = await api.get("/api/accounts/summary");
      setSummary(res.data);
    } catch (err) {
      console.error("Failed to load accounts summary", err);
    }
  };

  // Fetch Accounts
  const fetchAccounts = async () => {
    setAccountsLoading(true);
    try {
      const res = await api.get("/api/accounts", {
        params: {
          q: searchQuery || undefined,
          account_type: typeFilter === "all" ? undefined : typeFilter
        }
      });
      setAccounts(res.data);
    } catch (err) {
      console.error("Failed to load accounts", err);
    } finally {
      setAccountsLoading(false);
    }
  };

  // Fetch Invoices
  const fetchInvoices = async () => {
    setInvoicesLoading(true);
    try {
      const res = await api.get("/api/accounts/invoices");
      setInvoices(res.data);
    } catch (err) {
      console.error("Failed to load invoices", err);
    } finally {
      setInvoicesLoading(false);
    }
  };

  // Run on tab / search change
  useEffect(() => {
    fetchSummary();
    if (activeTab === "accounts") {
      fetchAccounts();
    } else if (activeTab === "invoices") {
      fetchInvoices();
    }
  }, [activeTab, searchQuery, typeFilter]);

  // Handle Account Create / Edit
  const handleOpenAddAccount = () => {
    setEditingAccount(null);
    setAccountForm({
      name: "",
      phone: "",
      email: "",
      delivery_address: "",
      city: "Karachi",
      notes: "",
      account_type: "b2c",
      company_name: "",
      contact_person: "",
      tax_id: "",
      credit_limit: 0,
      payment_terms: "cod",
      opening_balance: 0,
      is_account_active: true
    });
    setShowAccountModal(true);
  };

  const handleOpenEditAccount = (acc) => {
    setEditingAccount(acc);
    setAccountForm({
      name: acc.name || "",
      phone: acc.phone || "",
      email: acc.email || "",
      delivery_address: acc.delivery_address || "",
      city: acc.city || "Karachi",
      notes: acc.notes || "",
      account_type: acc.account_type || "b2c",
      company_name: acc.company_name || "",
      contact_person: acc.contact_person || "",
      tax_id: acc.tax_id || "",
      credit_limit: acc.credit_limit || 0,
      payment_terms: acc.payment_terms || "cod",
      opening_balance: acc.opening_balance || 0,
      is_account_active: acc.is_account_active ?? true
    });
    setShowAccountModal(true);
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    try {
      if (editingAccount) {
        await api.put(`/api/accounts/${editingAccount.id}`, accountForm);
        showStatus(`Account '${accountForm.name}' updated successfully!`);
      } else {
        await api.post("/api/accounts", accountForm);
        showStatus(`New Account '${accountForm.name}' created successfully!`);
      }
      setShowAccountModal(false);
      fetchAccounts();
      fetchSummary();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to save account profile");
    }
  };

  const handleDeleteAccount = async (acc) => {
    if (!window.confirm(`Are you sure you want to permanently delete the account '${acc.name}'? This will also wipe all ledger transactions for this account.`)) {
      return;
    }
    try {
      await api.delete(`/api/accounts/${acc.id}`);
      showStatus(`Account '${acc.name}' deleted successfully.`);
      fetchAccounts();
      fetchSummary();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to delete account");
    }
  };

  // View Customer Ledger
  const handleViewLedger = async (customer) => {
    setSelectedLedgerCustomer(customer);
    setActiveTab("ledger");
    fetchLedgerData(customer.phone);
  };

  const fetchLedgerData = async (phone) => {
    if (!phone) return;
    setLedgerLoading(true);
    try {
      const res = await api.get(`/api/ledger/${phone}`);
      setLedgerStatement(res.data);
    } catch (err) {
      console.error("Failed to load ledger details", err);
    } finally {
      setLedgerLoading(false);
    }
  };

  const handlePostLedger = async (e) => {
    e.preventDefault();
    if (!selectedLedgerCustomer || !ledgerForm.amount) return;
    setPostingLedger(true);
    try {
      await api.post("/api/accounts/payments", {
        customer_phone: selectedLedgerCustomer.phone,
        channel: selectedLedgerCustomer.account_type || "b2c",
        entry_type: ledgerForm.entry_type,
        amount: parseFloat(ledgerForm.amount),
        description: ledgerForm.description,
        payment_method: ledgerForm.entry_type === "credit" ? ledgerForm.payment_method : undefined,
        reference_no: ledgerForm.reference_no || undefined,
        notes: ledgerForm.notes || undefined
      });
      showStatus("Ledger adjustment posted successfully!");
      setLedgerForm({
        entry_type: "credit",
        amount: "",
        description: "",
        payment_method: "cash",
        reference_no: "",
        notes: ""
      });
      fetchLedgerData(selectedLedgerCustomer.phone);
      fetchSummary();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to post ledger entry");
    } finally {
      setPostingLedger(false);
    }
  };

  const handleDownloadLedgerPDF = () => {
    if (!selectedLedgerCustomer) return;
    window.open(getAuthUrl(`/api/ledger/${selectedLedgerCustomer.phone}/pdf`), "_blank");
  };

  // Invoice Line Items Form Helpers
  const addInvoiceLineItem = () => {
    setInvoiceForm({
      ...invoiceForm,
      line_items: [...invoiceForm.line_items, { description: "", qty: 1, unit_price: 0, total: 0 }]
    });
  };

  const removeInvoiceLineItem = (idx) => {
    const list = [...invoiceForm.line_items];
    list.splice(idx, 1);
    setInvoiceForm({ ...invoiceForm, line_items: list });
  };

  const handleLineItemChange = (idx, field, val) => {
    const list = [...invoiceForm.line_items];
    list[idx][field] = val;
    if (field === "qty" || field === "unit_price") {
      list[idx].total = list[idx].qty * list[idx].unit_price;
    }
    setInvoiceForm({ ...invoiceForm, line_items: list });
  };

  const handleSaveInvoice = async (e) => {
    e.preventDefault();
    if (!invoiceForm.customer_id) {
      alert("Please select a customer account first");
      return;
    }
    setSavingInvoice(true);
    try {
      await api.post("/api/accounts/invoices", invoiceForm);
      showStatus("Standalone Invoice generated & posted to ledger!");
      setShowInvoiceModal(false);
      fetchInvoices();
      fetchSummary();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to create invoice");
    } finally {
      setSavingInvoice(false);
    }
  };

  // Record Invoice Payment
  const handleOpenRecordPayment = (inv) => {
    setSelectedInvoice(inv);
    setPaymentForm({
      amount: inv.amount_due.toString(),
      payment_method: "bank_transfer",
      reference_no: "",
      notes: ""
    });
    setShowPaymentModal(true);
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    setRecordingPayment(true);
    try {
      await api.post(`/api/accounts/invoices/${selectedInvoice.id}/pay`, null, {
        params: {
          amount: parseFloat(paymentForm.amount),
          payment_method: paymentForm.payment_method,
          reference_no: paymentForm.reference_no || undefined,
          notes: paymentForm.notes || undefined
        }
      });
      showStatus("Invoice payment recorded successfully!");
      setShowPaymentModal(false);
      fetchInvoices();
      fetchSummary();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to record payment");
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleDownloadInvoicePDF = (invId) => {
    window.open(getAuthUrl(`/api/accounts/invoices/${invId}/pdf`), "_blank");
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wallet className="w-6 h-6 text-brand-400" />
            Financial Accounts Ledger
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">
            Professional B2B & B2C account tracking, credit balances, ledger entries, and standalone invoices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleOpenAddAccount}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Open New Account
          </button>
          <button
            onClick={() => {
              setInvoiceForm({
                customer_id: "",
                invoice_type: "sale",
                due_date: "",
                discount_amount: 0,
                tax_amount: 0,
                notes: "",
                payment_terms: "cod",
                line_items: [{ description: "", qty: 1, unit_price: 0, total: 0 }]
              });
              setShowInvoiceModal(true);
            }}
            className="btn-emerald text-xs flex items-center gap-1.5"
          >
            <PlusCircle className="w-3.5 h-3.5" /> Add Accounts Invoice
          </button>
        </div>
      </div>

      {/* Status Notifications */}
      {statusMsg && (
        <div className="card bg-emerald-950/40 border border-emerald-700/60 text-emerald-300 py-3 flex items-center gap-2 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="kpi-card bg-surface-900 border-surface-800 p-4">
          <span className="kpi-label">Accounts Receivable (Outstanding)</span>
          <span className="kpi-value text-red-400">
            PKR {summary.total_receivable.toLocaleString()}
          </span>
          <span className="text-[10px] text-brand-500 font-semibold uppercase mt-1 block">
            Total Owed by Customers
          </span>
        </div>
        <div className="kpi-card bg-surface-900 border-surface-800 p-4">
          <span className="kpi-label">B2B Mart Outstanding</span>
          <span className="kpi-value text-amber-500">
            PKR {summary.b2b_receivable.toLocaleString()}
          </span>
          <span className="text-[10px] text-brand-500 font-semibold uppercase mt-1 block">
            From {summary.b2b_count} Corporate / Mart Accounts
          </span>
        </div>
        <div className="kpi-card bg-surface-900 border-surface-800 p-4">
          <span className="kpi-label">B2C Retail Outstanding</span>
          <span className="kpi-value text-emerald-400">
            PKR {summary.b2c_receivable.toLocaleString()}
          </span>
          <span className="text-[10px] text-brand-500 font-semibold uppercase mt-1 block">
            From {summary.b2c_count} Retail Customers
          </span>
        </div>
        <div className="kpi-card bg-surface-900 border-surface-850 p-4 border-red-950">
          <span className="kpi-label text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> Overdue Invoices
          </span>
          <span className="kpi-value text-red-500">
            {summary.overdue_invoices_count}
          </span>
          <span className="text-[10px] text-brand-500 font-semibold uppercase mt-1 block">
            Outstanding past payment term terms
          </span>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-surface-700">
        <button
          onClick={() => setActiveTab("accounts")}
          className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === "accounts"
              ? "border-brand-500 text-brand-300"
              : "border-transparent text-brand-500 hover:text-brand-300"
          }`}
        >
          Account Directory
        </button>
        <button
          onClick={() => setActiveTab("invoices")}
          className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === "invoices"
              ? "border-brand-500 text-brand-300"
              : "border-transparent text-brand-500 hover:text-brand-300"
          }`}
        >
          Accounts Invoices
        </button>
        <button
          onClick={() => setActiveTab("ledger")}
          className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === "ledger"
              ? "border-brand-500 text-brand-300"
              : "border-transparent text-brand-500 hover:text-brand-300"
          }`}
        >
          Ledger & Statement
        </button>
      </div>

      {/* ─── TAB 1: ACCOUNTS DIRECTORY ─── */}
      {activeTab === "accounts" && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="card flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="w-4 h-4 text-brand-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                className="input pl-9 text-xs"
                placeholder="Search accounts by name, phone, company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                className="select py-1.5 px-3 text-xs w-full md:w-44"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">All Account Types</option>
                <option value="b2b">B2B Commercial Accounts</option>
                <option value="b2c">B2C Retail Accounts</option>
              </select>
            </div>
          </div>

          {/* Accounts Directory Table */}
          {accountsLoading ? (
            <div className="text-center py-16 text-brand-500 animate-pulse">
              Loading accounts directory...
            </div>
          ) : accounts.length === 0 ? (
            <div className="card text-center py-12 space-y-3">
              <Wallet className="w-12 h-12 text-brand-600 mx-auto" />
              <p className="text-white font-semibold">No Accounts Found</p>
              <p className="text-xs text-brand-500">
                Create B2B or B2C accounts to manage their credit limits, outstanding balances, and custom payment terms.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead className="thead">
                  <tr>
                    <th className="th">Account Details</th>
                    <th className="th">Type</th>
                    <th className="th">Company Name</th>
                    <th className="th">Tax / NTN ID</th>
                    <th className="th">Credit Limit</th>
                    <th className="th">Payment Terms</th>
                    <th className="th text-right">Ledger Balance</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-800 text-xs">
                  {accounts.map((acc) => {
                    // Custom calculation or representation of credit limit usage
                    const owesMoney = acc.opening_balance > 0; // simple heuristic
                    
                    return (
                      <tr key={acc.id} className="tr-hover">
                        <td className="td font-medium">
                          <div>
                            <span className="font-semibold text-white text-sm">{acc.name}</span>
                            <span className="block text-[10px] text-brand-500 font-mono mt-0.5">
                              {acc.phone || "No phone"} {acc.email ? `| ${acc.email}` : ""}
                            </span>
                          </div>
                        </td>
                        <td className="td">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            acc.account_type === "b2b"
                              ? "bg-amber-950 text-amber-300 border border-amber-800"
                              : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          }`}>
                            {acc.account_type.toUpperCase()}
                          </span>
                        </td>
                        <td className="td text-brand-300">{acc.company_name || "—"}</td>
                        <td className="td font-mono">{acc.tax_id || "—"}</td>
                        <td className="td font-mono">
                          {acc.credit_limit > 0 ? `PKR ${acc.credit_limit.toLocaleString()}` : "No Limit"}
                        </td>
                        <td className="td uppercase tracking-wider">{acc.payment_terms}</td>
                        <td className="td text-right font-bold whitespace-nowrap">
                          {/* We can pull balance from statement dynamically or display. Since it will require multiple api calls, we fetch summaries on ledger tab. Let's just view Ledger directly. */}
                          <button
                            onClick={() => handleViewLedger(acc)}
                            className="text-emerald-400 hover:text-emerald-300 underline font-semibold flex items-center gap-1 justify-end ml-auto"
                          >
                            <BookOpen className="w-3.5 h-3.5" /> View Ledger
                          </button>
                        </td>
                        <td className="td text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenEditAccount(acc)}
                              className="btn-secondary py-1 px-2.5 text-[11px] flex items-center gap-1 border-surface-700 hover:text-white"
                              title="Edit Account Details"
                            >
                              <Edit3 className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button
                              onClick={() => {
                                setInvoiceForm({
                                  customer_id: acc.id.toString(),
                                  invoice_type: "sale",
                                  due_date: "",
                                  discount_amount: 0,
                                  tax_amount: 0,
                                  notes: "",
                                  payment_terms: acc.payment_terms || "cod",
                                  line_items: [{ description: "", qty: 1, unit_price: 0, total: 0 }]
                                });
                                setShowInvoiceModal(true);
                              }}
                              className="btn-primary py-1 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-500 border-none flex items-center gap-1"
                              title="Create Invoice"
                            >
                              <Receipt className="w-3.5 h-3.5" /> Invoice
                            </button>
                            <button
                              onClick={() => handleDeleteAccount(acc)}
                              className="btn-danger py-1 px-2.5 text-[11px] flex items-center gap-1"
                              title="Delete Account Profile"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 2: STANDALONE ACCOUNTS INVOICES ─── */}
      {activeTab === "invoices" && (
        <div className="space-y-4">
          {invoicesLoading ? (
            <div className="text-center py-16 text-brand-500 animate-pulse">
              Loading invoices...
            </div>
          ) : invoices.length === 0 ? (
            <div className="card text-center py-12 space-y-3">
              <FileText className="w-12 h-12 text-brand-600 mx-auto" />
              <p className="text-white font-semibold">No Accounts Invoices Found</p>
              <p className="text-xs text-brand-500">
                Click "Add Accounts Invoice" to generate commercial standalone sales/services invoices.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead className="thead">
                  <tr>
                    <th className="th">Invoice No</th>
                    <th className="th">Phone / Account</th>
                    <th className="th">Issue Date</th>
                    <th className="th">Due Date</th>
                    <th className="th text-right">Total Amount</th>
                    <th className="th text-right">Paid</th>
                    <th className="th text-right">Due Balance</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-800 text-xs">
                  {invoices.map((inv) => {
                    const isOverdue = inv.status !== "paid" && inv.due_date && new Date(inv.due_date) < new Date();
                    
                    return (
                      <tr key={inv.id} className="tr-hover">
                        <td className="td font-bold text-white font-mono">{inv.invoice_number}</td>
                        <td className="td">
                          <span className="font-semibold">{inv.customer_phone}</span>
                        </td>
                        <td className="td text-brand-400">
                          {new Date(inv.issue_date).toLocaleDateString("en-GB")}
                        </td>
                        <td className="td text-brand-400">
                          {inv.due_date ? new Date(inv.due_date).toLocaleDateString("en-GB") : "Immediate"}
                          {isOverdue && (
                            <span className="block text-[10px] text-red-500 font-semibold animate-pulse">
                              OVERDUE
                            </span>
                          )}
                        </td>
                        <td className="td text-right font-mono font-bold">
                          PKR {inv.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="td text-right text-emerald-400 font-mono">
                          PKR {inv.amount_paid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className={`td text-right font-mono font-bold ${inv.amount_due > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          PKR {inv.amount_due.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="td">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            inv.status === "paid"
                              ? "bg-brand-950 text-brand-300 border border-brand-850"
                              : inv.status === "partial"
                              ? "bg-amber-950 text-amber-300 border border-amber-850"
                              : "bg-red-950 text-red-300 border border-red-850"
                          }`}>
                            {inv.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="td text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => handleDownloadInvoicePDF(inv.id)}
                              className="btn-secondary py-1 px-2.5 text-[11px] border-surface-700 hover:text-white flex items-center gap-1"
                              title="Download Invoice PDF"
                            >
                              <Download className="w-3.5 h-3.5" /> PDF
                            </button>
                            {inv.status !== "paid" && (
                              <button
                                onClick={() => handleOpenRecordPayment(inv)}
                                className="btn-primary py-1 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-500 border-none flex items-center gap-1"
                              >
                                <DollarSign className="w-3.5 h-3.5" /> Record Pay
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 3: LEDGER & STATEMENT ─── */}
      {activeTab === "ledger" && (
        <div className="space-y-6">
          {/* Account Selection */}
          <div className="card space-y-3">
            <label className="label">Select Account to View Statement</label>
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                className="select flex-1"
                onChange={(e) => {
                  const acc = accounts.find((a) => a.id.toString() === e.target.value);
                  if (acc) handleViewLedger(acc);
                }}
                value={selectedLedgerCustomer?.id || ""}
              >
                <option value="">-- Choose Account (B2B / B2C) --</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.account_type.toUpperCase()}) {a.company_name ? ` - ${a.company_name}` : ""} - {a.phone}
                  </option>
                ))}
              </select>

              {selectedLedgerCustomer && (
                <button
                  onClick={handleDownloadLedgerPDF}
                  className="btn-primary bg-emerald-600 hover:bg-emerald-500 flex items-center gap-1.5 justify-center py-2.5 px-4 text-xs font-semibold"
                >
                  <Download className="w-4 h-4" /> Download Statement PDF
                </button>
              )}
            </div>
          </div>

          {/* Statement details */}
          {!selectedLedgerCustomer ? (
            <div className="card text-center py-12 text-brand-500">
              Please choose an account from the selection dropdown to view transaction statements and ledger adjustments.
            </div>
          ) : ledgerLoading ? (
            <div className="text-center py-12 text-brand-500 animate-pulse">
              Fetching ledger details...
            </div>
          ) : (
            <div className="space-y-6">
              {/* Financial Balance Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="card bg-surface-900 border-surface-800 p-4">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-brand-500">Total Debit (Billed)</span>
                  <span className="text-xl font-bold text-white mt-1">
                    PKR {ledgerStatement?.total_debit?.toLocaleString() || "0"}
                  </span>
                </div>
                <div className="card bg-surface-900 border-surface-800 p-4">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-brand-500">Total Credit (Received)</span>
                  <span className="text-xl font-bold text-white mt-1">
                    PKR {ledgerStatement?.total_credit?.toLocaleString() || "0"}
                  </span>
                </div>
                <div className={`card p-4 flex flex-col justify-between ${
                  (ledgerStatement?.balance || 0) > 0 
                    ? "bg-red-950/40 border-red-900/40 text-red-200" 
                    : "bg-emerald-950/40 border-emerald-900/40 text-emerald-200"
                }`}>
                  <span className="text-[10px] uppercase font-bold tracking-wider opacity-85">Net Balance Outstanding</span>
                  <span className="text-xl font-extrabold mt-1">
                    PKR {ledgerStatement?.balance?.toLocaleString() || "0"}
                    <span className="text-[10px] block font-normal opacity-90 mt-0.5">
                      {ledgerStatement?.balance > 0 ? "Customer owes company" : ledgerStatement?.balance < 0 ? "Account Credit Balance" : "Account Settled"}
                    </span>
                  </span>
                </div>
              </div>

              {/* Transactions Table */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider text-brand-500">Transaction History</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr className="bg-surface-850 border-b border-surface-800 text-[10px] uppercase font-bold text-brand-400">
                        <th className="p-3">Date</th>
                        <th className="p-3">Description</th>
                        <th className="p-3">Ref/Payment Details</th>
                        <th className="p-3 text-right">Debit (+)</th>
                        <th className="p-3 text-right">Credit (-)</th>
                        <th className="p-3 text-right">Running Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-800 text-xs">
                      {!ledgerStatement || ledgerStatement.entries.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-brand-600">
                            No ledger transaction records found for this account.
                          </td>
                        </tr>
                      ) : (
                        (() => {
                          let running = 0;
                          return ledgerStatement.entries.map((entry) => {
                            if (entry.entry_type === "debit") {
                              running += entry.amount;
                            } else {
                              running -= entry.amount;
                            }
                            
                            return (
                              <tr key={entry.id} className="hover:bg-surface-900/50 transition-colors">
                                <td className="p-3 text-brand-400 whitespace-nowrap">
                                  {new Date(entry.created_at).toLocaleDateString("en-GB", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric"
                                  })}
                                </td>
                                <td className="p-3 text-white">
                                  <span className="font-semibold">{entry.description}</span>
                                  {entry.related_order_id && (
                                    <span className="text-[10px] bg-surface-800 px-1.5 py-0.5 rounded text-brand-400 font-mono ml-2">
                                      Order #{entry.related_order_id}
                                    </span>
                                  )}
                                  {entry.account_invoice_id && (
                                    <span className="text-[10px] bg-emerald-950/80 px-1.5 py-0.5 rounded text-emerald-300 font-mono ml-2 border border-emerald-900">
                                      Invoice ID: {entry.account_invoice_id}
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 text-brand-400 font-medium">
                                  {entry.payment_method ? (
                                    <div>
                                      <span className="uppercase font-bold text-[10px] bg-surface-750 px-1.5 py-0.5 rounded text-brand-300">
                                        {entry.payment_method.replace("_", " ")}
                                      </span>
                                      {entry.reference_no && <span className="block text-[10px] font-mono mt-1">Ref: {entry.reference_no}</span>}
                                      {entry.notes && <span className="block text-[9px] italic text-brand-500 mt-0.5">{entry.notes}</span>}
                                    </div>
                                  ) : "—"}
                                </td>
                                <td className="p-3 text-right text-red-400 font-semibold font-mono">
                                  {entry.entry_type === "debit" ? `PKR ${entry.amount.toLocaleString()}` : "—"}
                                </td>
                                <td className="p-3 text-right text-emerald-400 font-semibold font-mono">
                                  {entry.entry_type === "credit" ? `PKR ${entry.amount.toLocaleString()}` : "—"}
                                </td>
                                <td className={`p-3 text-right font-bold font-mono ${running > 0 ? "text-red-400" : "text-emerald-400"}`}>
                                  PKR {running.toLocaleString()}
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

              {/* Adjustments Form */}
              <div className="card space-y-4 bg-surface-850 border-surface-850">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-brand-500 flex items-center gap-1.5">
                  <PlusCircle className="w-4 h-4 text-brand-500" />
                  Post Manual Ledger Adjustment (Payment / Charge)
                </h3>

                <form onSubmit={handlePostLedger} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="label">Entry Type</label>
                      <select
                        className="select"
                        value={ledgerForm.entry_type}
                        onChange={(e) => setLedgerForm({ ...ledgerForm, entry_type: e.target.value })}
                      >
                        <option value="credit">Credit (Payment Received / Discount)</option>
                        <option value="debit">Debit (Owed / Charge / Opening Balance)</option>
                      </select>
                    </div>

                    <div>
                      <label className="label">Amount (PKR)</label>
                      <input
                        type="number"
                        step="any"
                        required
                        className="input font-bold"
                        placeholder="e.g. 5000"
                        value={ledgerForm.amount}
                        onChange={(e) => setLedgerForm({ ...ledgerForm, amount: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="label">Description / Particulars</label>
                      <input
                        type="text"
                        required
                        className="input"
                        placeholder="e.g. Bulk payment for March"
                        value={ledgerForm.description}
                        onChange={(e) => setLedgerForm({ ...ledgerForm, description: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="label">Payment Method (For Credits)</label>
                      <select
                        className="select"
                        disabled={ledgerForm.entry_type !== "credit"}
                        value={ledgerForm.payment_method}
                        onChange={(e) => setLedgerForm({ ...ledgerForm, payment_method: e.target.value })}
                      >
                        <option value="cash">Cash Payment</option>
                        <option value="bank_transfer">Bank Transfer (IBFT)</option>
                        <option value="cheque">Bank Cheque</option>
                        <option value="online">Online Credit/Debit Card</option>
                        <option value="other">Other / Adjustment</option>
                      </select>
                    </div>
                  </div>

                  {ledgerForm.entry_type === "credit" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="label">Cheque No / Transaction Ref</label>
                        <input
                          type="text"
                          className="input"
                          placeholder="e.g. Cheque # 12345678 or Txn ID IBFT998272"
                          value={ledgerForm.reference_no}
                          onChange={(e) => setLedgerForm({ ...ledgerForm, reference_no: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label">Private Account Notes</label>
                        <input
                          type="text"
                          className="input"
                          placeholder="Internal admin reference notes"
                          value={ledgerForm.notes}
                          onChange={(e) => setLedgerForm({ ...ledgerForm, notes: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={postingLedger}
                      className="btn-primary px-6"
                    >
                      {postingLedger ? "Posting..." : "Post Transaction Entry"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── MODAL 1: ADD / EDIT ACCOUNT ─── */}
      {showAccountModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-2xl bg-surface-900 border-surface-700 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-surface-800">
              <h2 className="text-lg font-bold text-white">
                {editingAccount ? `Edit Profile — ${editingAccount.name}` : "Create New Financial Account"}
              </h2>
              <button onClick={() => setShowAccountModal(false)} className="text-brand-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Account Full Name *</label>
                  <input
                    type="text"
                    required
                    className="input"
                    placeholder="e.g. Alpha Distributors"
                    value={accountForm.name}
                    onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Account Type *</label>
                  <select
                    className="select"
                    value={accountForm.account_type}
                    onChange={(e) => setAccountForm({ ...accountForm, account_type: e.target.value })}
                  >
                    <option value="b2c">B2C Retail Customer</option>
                    <option value="b2b">B2B Commercial / Mart Account</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Mobile Phone Number</label>
                  <input
                    type="text"
                    className="input font-mono"
                    placeholder="e.g. 03001234567"
                    value={accountForm.phone}
                    onChange={(e) => setAccountForm({ ...accountForm, phone: e.target.value })}
                  />
                </div>
                
                <div>
                  <label className="label">Email Address</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="customer@domain.com"
                    value={accountForm.email}
                    onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">City</label>
                  <input
                    type="text"
                    className="input"
                    value={accountForm.city}
                    onChange={(e) => setAccountForm({ ...accountForm, city: e.target.value })}
                  />
                </div>
              </div>

              {accountForm.account_type === "b2b" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-surface-850 rounded-xl border border-surface-800">
                  <div>
                    <label className="label">Company Registered Name</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Alpha Foods Pvt Ltd"
                      value={accountForm.company_name}
                      onChange={(e) => setAccountForm({ ...accountForm, company_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Contact Person Name</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Muzzammil (Procurement)"
                      value={accountForm.contact_person}
                      onChange={(e) => setAccountForm({ ...accountForm, contact_person: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">STRN / NTN Tax ID</label>
                    <input
                      type="text"
                      className="input font-mono"
                      placeholder="e.g. 1234567-8"
                      value={accountForm.tax_id}
                      onChange={(e) => setAccountForm({ ...accountForm, tax_id: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Credit Limit (PKR)</label>
                  <input
                    type="number"
                    className="input font-mono"
                    value={accountForm.credit_limit}
                    onChange={(e) => setAccountForm({ ...accountForm, credit_limit: parseFloat(e.target.value) || 0 })}
                  />
                </div>

                <div>
                  <label className="label">Payment Terms</label>
                  <select
                    className="select"
                    value={accountForm.payment_terms}
                    onChange={(e) => setAccountForm({ ...accountForm, payment_terms: e.target.value })}
                  >
                    <option value="cod">Cash on Delivery (COD)</option>
                    <option value="net7">Net 7 Days</option>
                    <option value="net15">Net 15 Days</option>
                    <option value="net30">Net 30 Days</option>
                    <option value="net45">Net 45 Days</option>
                  </select>
                </div>

                {!editingAccount && (
                  <div>
                    <label className="label">Opening Balance Owed (PKR)</label>
                    <input
                      type="number"
                      className="input font-mono"
                      value={accountForm.opening_balance}
                      onChange={(e) => setAccountForm({ ...accountForm, opening_balance: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="label">Billing / Delivery Address</label>
                <textarea
                  className="input h-16 resize-none"
                  placeholder="Billing address for generating commercial invoices..."
                  value={accountForm.delivery_address}
                  onChange={(e) => setAccountForm({ ...accountForm, delivery_address: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Special Financial Notes</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. VIP mart - requires approval from director for balance credit limit increase"
                  value={accountForm.notes}
                  onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-surface-800">
                <button type="button" onClick={() => setShowAccountModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingAccount ? "Save Changes" : "Create Account Profile"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: CREATE STANDALONE INVOICE ─── */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-4xl bg-surface-900 border-surface-700 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-surface-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-1.5">
                <Receipt className="w-5 h-5 text-brand-400" />
                Generate Accounts Commercial Invoice
              </h2>
              <button onClick={() => setShowInvoiceModal(false)} className="text-brand-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveInvoice} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Customer Account *</label>
                  <select
                    className="select"
                    required
                    value={invoiceForm.customer_id}
                    onChange={(e) => {
                      const acc = accounts.find((a) => a.id.toString() === e.target.value);
                      setInvoiceForm({
                        ...invoiceForm,
                        customer_id: e.target.value,
                        payment_terms: acc?.payment_terms || "cod"
                      });
                    }}
                  >
                    <option value="">-- Select Customer Account --</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.account_type.toUpperCase()}) {a.company_name ? ` - ${a.company_name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">Invoice Type</label>
                  <select
                    className="select"
                    value={invoiceForm.invoice_type}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_type: e.target.value })}
                  >
                    <option value="sale">Commercial Sale Invoice</option>
                    <option value="service">Services Rendered Invoice</option>
                    <option value="credit_note">Credit Note (Discount Adjustment)</option>
                    <option value="debit_note">Debit Note (Charge Correction)</option>
                  </select>
                </div>

                <div>
                  <label className="label">Payment Terms</label>
                  <select
                    className="select"
                    value={invoiceForm.payment_terms}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, payment_terms: e.target.value })}
                  >
                    <option value="cod">Cash on Delivery (COD)</option>
                    <option value="net7">Net 7 Days</option>
                    <option value="net15">Net 15 Days</option>
                    <option value="net30">Net 30 Days</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Due Date (Optional)</label>
                  <input
                    type="date"
                    className="input"
                    value={invoiceForm.due_date}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Discount (PKR)</label>
                  <input
                    type="number"
                    className="input font-mono"
                    value={invoiceForm.discount_amount}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, discount_amount: parseFloat(e.target.value) || 0 })}
                  />
                </div>

                <div>
                  <label className="label">Tax Amount (GST / STRN - PKR)</label>
                  <input
                    type="number"
                    className="input font-mono"
                    value={invoiceForm.tax_amount}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, tax_amount: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>

              {/* Dynamic Line Items */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider text-brand-500">Billing Line Items</h3>
                  <button
                    type="button"
                    onClick={addInvoiceLineItem}
                    className="btn-secondary py-1.5 px-3 text-xs bg-surface-800 border-surface-700 hover:text-white"
                  >
                    + Add Particulars Line
                  </button>
                </div>

                <div className="space-y-2">
                  {invoiceForm.line_items.map((item, idx) => (
                    <div key={idx} className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="label text-[10px]">Description particulars *</label>
                        <input
                          type="text"
                          required
                          className="input text-xs"
                          placeholder="e.g. Navaal Honey 500g bulk cargo"
                          value={item.description}
                          onChange={(e) => handleLineItemChange(idx, "description", e.target.value)}
                        />
                      </div>
                      <div className="w-20">
                        <label className="label text-[10px]">Qty *</label>
                        <input
                          type="number"
                          required
                          min="1"
                          className="input text-xs font-mono text-center"
                          value={item.qty}
                          onChange={(e) => handleLineItemChange(idx, "qty", parseFloat(e.target.value) || 1)}
                        />
                      </div>
                      <div className="w-32">
                        <label className="label text-[10px]">Unit Price *</label>
                        <input
                          type="number"
                          required
                          className="input text-xs font-mono"
                          value={item.unit_price}
                          onChange={(e) => handleLineItemChange(idx, "unit_price", parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="w-32">
                        <label className="label text-[10px]">Total Amount</label>
                        <input
                          type="text"
                          disabled
                          className="input text-xs font-mono bg-surface-850"
                          value={`PKR ${item.total.toLocaleString()}`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeInvoiceLineItem(idx)}
                        disabled={invoiceForm.line_items.length <= 1}
                        className="btn-danger py-2 px-2.5 rounded-xl self-end"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Invoice Notes</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Visible on the invoice PDF"
                  value={invoiceForm.notes}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-surface-800">
                <button type="button" onClick={() => setShowInvoiceModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={savingInvoice}>
                  {savingInvoice ? "Generating..." : "Generate Invoice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 3: RECORD PAYMENT SPECIFIC TO INVOICE ─── */}
      {showPaymentModal && selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-md bg-surface-900 border-surface-700 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-surface-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-1.5">
                <DollarSign className="w-5 h-5 text-emerald-400" />
                Record Invoice Payment
              </h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-brand-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-surface-850 p-3 rounded-xl border border-surface-800 space-y-1 text-xs">
              <p className="text-brand-400">Invoice: <span className="text-white font-bold font-mono">{selectedInvoice.invoice_number}</span></p>
              <p className="text-brand-400">Total Owed: <span className="text-white font-bold font-mono">PKR {selectedInvoice.total_amount.toLocaleString()}</span></p>
              <p className="text-brand-400">Current Balance Due: <span className="text-red-400 font-bold font-mono">PKR {selectedInvoice.amount_due.toLocaleString()}</span></p>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-4">
              <div>
                <label className="label">Amount Received (PKR) *</label>
                <input
                  type="number"
                  required
                  step="any"
                  className="input font-bold text-lg"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Payment Mode *</label>
                <select
                  className="select"
                  required
                  value={paymentForm.payment_method}
                  onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                >
                  <option value="bank_transfer">Direct Bank Transfer (IBFT)</option>
                  <option value="cash">Cash Payment</option>
                  <option value="cheque">Bank Cheque</option>
                  <option value="online">Online Payment Portal</option>
                  <option value="other">Other Adjustment</option>
                </select>
              </div>

              <div>
                <label className="label">Transaction ID / Cheque Reference</label>
                <input
                  type="text"
                  className="input font-mono"
                  placeholder="e.g. cheque number or bank reference code"
                  value={paymentForm.reference_no}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference_no: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Payment Receipt Notes</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Internal receipt description notes"
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-surface-800">
                <button type="button" onClick={() => setShowPaymentModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={recordingPayment}>
                  {recordingPayment ? "Saving..." : "Record Payment Receipt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
