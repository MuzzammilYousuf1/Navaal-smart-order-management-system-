import { useEffect, useState } from "react";
import {
  ClipboardList, CheckCircle2, Clock, Plus, Calendar, User,
  Send, Eye, RefreshCw, Trash2, PlusCircle, GripVertical, FileText
} from "lucide-react";
import api from "../api/client";
import useAuth from "../store/useAuth";

const FIELD_TYPES = [
  { value: "number",   label: "Number" },
  { value: "text",     label: "Short Text" },
  { value: "textarea", label: "Long Text" },
  { value: "select",   label: "Dropdown" },
];

/* ── Field Builder Row ─────────────────────────────────────────── */
function FieldRow({ field, idx, onChange, onRemove }) {
  return (
    <div className="flex items-start gap-2 bg-surface-800 border border-surface-700 rounded-xl p-3">
      <GripVertical className="w-4 h-4 mt-2 text-brand-700 shrink-0" />
      <div className="flex-1 grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] uppercase tracking-wider text-brand-500 font-semibold">Field Label</label>
          <input
            className="input mt-0.5 text-sm"
            placeholder="e.g. Opening Stock"
            value={field.label}
            onChange={e => onChange(idx, "label", e.target.value)}
          />
        </div>
        <div>
          <label className="text-[9px] uppercase tracking-wider text-brand-500 font-semibold">Type</label>
          <select
            className="select mt-0.5 text-sm"
            value={field.type}
            onChange={e => onChange(idx, "type", e.target.value)}
          >
            {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {field.type === "select" && (
          <div className="col-span-2">
            <label className="text-[9px] uppercase tracking-wider text-brand-500 font-semibold">Options (comma-separated)</label>
            <input
              className="input mt-0.5 text-sm"
              placeholder="e.g. Good, Spoiled, Broken"
              value={field.options || ""}
              onChange={e => onChange(idx, "options", e.target.value)}
            />
          </div>
        )}
        <div className="col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            id={`req-${idx}`}
            checked={field.required || false}
            onChange={e => onChange(idx, "required", e.target.checked)}
            className="rounded border-surface-600"
          />
          <label htmlFor={`req-${idx}`} className="text-xs text-brand-400 select-none">Required field</label>
        </div>
      </div>
      <button onClick={() => onRemove(idx)} className="text-red-500 hover:text-red-400 mt-1 p-1 rounded-lg hover:bg-red-950/30">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ── Dynamic Form Renderer (for staff to fill) ─────────────────── */
function DynamicForm({ schema, responses, onChange }) {
  const fields = JSON.parse(schema || "[]");
  return (
    <div className="space-y-3">
      {fields.map((field, i) => (
        <div key={i}>
          <label className="label">
            {field.label}
            {field.required && <span className="text-red-400 ml-1">*</span>}
          </label>
          {field.type === "number" && (
            <input type="number" className="input" value={responses[field.label] || ""}
              onChange={e => onChange(field.label, e.target.value)} required={field.required} />
          )}
          {field.type === "text" && (
            <input type="text" className="input" value={responses[field.label] || ""}
              onChange={e => onChange(field.label, e.target.value)} required={field.required} />
          )}
          {field.type === "textarea" && (
            <textarea className="input min-h-[70px]" value={responses[field.label] || ""}
              onChange={e => onChange(field.label, e.target.value)} required={field.required} />
          )}
          {field.type === "select" && (
            <select className="select" value={responses[field.label] || ""}
              onChange={e => onChange(field.label, e.target.value)} required={field.required}>
              <option value="">Select...</option>
              {(field.options || "").split(",").map(o => (
                <option key={o.trim()} value={o.trim()}>{o.trim()}</option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────── */
export default function Tasks() {
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";

  const [tasks, setTasks]           = useState([]);
  const [users, setUsers]           = useState([]);
  const [products, setProducts]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Create task modal
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "", description: "", assigned_to_id: "", due_date: "",
    requires_report: false, form_schema: null,
  });
  const [formFields, setFormFields] = useState([]);

  // Complete (inventory) modal
  const [completing, setCompleting] = useState(null);
  const [invReport, setInvReport] = useState({ product_id: "", spoiled_qty: 0, broken_qty: 0, actual_qty: "", notes: "" });

  // Complete (custom form) modal
  const [formTask, setFormTask]         = useState(null);
  const [formResponses, setFormResponses] = useState({});
  const [formNotes, setFormNotes]       = useState("");

  // View report modal
  const [viewing, setViewing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [tRes, pRes] = await Promise.all([
        api.get("/api/tasks"),
        api.get("/api/inventory/products"),
      ]);
      setTasks(tRes.data);
      setProducts(pRes.data);
      if (isManager) {
        const uRes = await api.get("/api/users");
        setUsers(uRes.data);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  /* ── Field builder helpers ──────── */
  const addField = () => setFormFields(f => [...f, { label: "", type: "number", required: false, options: "" }]);
  const updateField = (i, k, v) => setFormFields(f => f.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const removeField = (i) => setFormFields(f => f.filter((_, idx) => idx !== i));

  /* ── Create task ──────────────── */
  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        title: newTask.title,
        description: newTask.description || null,
        assigned_to_id: newTask.assigned_to_id ? parseInt(newTask.assigned_to_id) : null,
        due_date: newTask.due_date ? new Date(newTask.due_date).toISOString() : null,
        requires_report: newTask.requires_report,
        form_schema: newTask.requires_report && formFields.length > 0
          ? JSON.stringify(formFields)
          : null,
      };
      await api.post("/api/tasks", payload);
      setShowCreate(false);
      setNewTask({ title: "", description: "", assigned_to_id: "", due_date: "", requires_report: false, form_schema: null });
      setFormFields([]);
      load();
    } catch (err) { alert(err.response?.data?.detail || "Failed to create task"); }
    finally { setSubmitting(false); }
  };

  /* ── Submit inventory report ────── */
  const handleInvSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post(`/api/tasks/${completing.id}/complete`, {
        product_id: parseInt(invReport.product_id),
        spoiled_qty: parseInt(invReport.spoiled_qty) || 0,
        broken_qty: parseInt(invReport.broken_qty) || 0,
        actual_qty: invReport.actual_qty !== "" ? parseInt(invReport.actual_qty) : null,
        notes: invReport.notes || null,
      });
      setCompleting(null);
      setInvReport({ product_id: "", spoiled_qty: 0, broken_qty: 0, actual_qty: "", notes: "" });
      load();
    } catch (err) { alert(err.response?.data?.detail || "Submit failed"); }
    finally { setSubmitting(false); }
  };

  /* ── Submit custom form ─────────── */
  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post(`/api/tasks/${formTask.id}/complete-form`, {
        responses: formResponses,
        notes: formNotes || null,
      });
      setFormTask(null);
      setFormResponses({});
      setFormNotes("");
      load();
    } catch (err) { alert(err.response?.data?.detail || "Submit failed"); }
    finally { setSubmitting(false); }
  };

  const parsedReport = (t) => { try { return JSON.parse(t.report_json); } catch { return null; } };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-brand-400" /> Tasks & Reports
          </h1>
          <p className="text-brand-500 text-sm mt-0.5">Assign duties, attach custom report forms, audit stock</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary text-xs"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          {isManager && <button onClick={() => setShowCreate(true)} className="btn-primary text-xs"><Plus className="w-3.5 h-3.5" /> Assign Task</button>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total", val: tasks.length, color: "text-white" },
          { label: "Pending", val: tasks.filter(t => t.status === "pending").length, color: "text-amber-400" },
          { label: "Completed", val: tasks.filter(t => t.status === "completed").length, color: "text-emerald-400" },
        ].map(s => (
          <div key={s.label} className="card text-center py-4">
            <p className={`text-3xl font-bold ${s.color}`}>{s.val}</p>
            <p className="text-[10px] uppercase tracking-wider text-brand-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Task list */}
      {loading ? (
        <p className="text-brand-500 animate-pulse text-center py-16">Loading...</p>
      ) : tasks.length === 0 ? (
        <div className="card text-center py-16 space-y-2">
          <ClipboardList className="w-10 h-10 text-brand-700 mx-auto" />
          <p className="text-brand-400 font-semibold">No tasks yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => {
            const done = task.status === "completed";
            const rep = done ? parsedReport(task) : null;
            const hasCustomForm = task.requires_report && task.form_schema;
            const hasInvReport = task.requires_report && !task.form_schema;

            return (
              <div key={task.id} className={`card border transition-all ${done ? "border-surface-800 opacity-75" : "border-surface-700 hover:border-brand-700/40"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`font-bold text-base ${done ? "line-through text-brand-500" : "text-white"}`}>{task.title}</h3>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border flex items-center gap-0.5 ${done ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/40" : "bg-amber-950/60 text-amber-400 border-amber-800/40"}`}>
                        {done ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                        {done ? "Done" : "Pending"}
                      </span>
                      {hasCustomForm && !done && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-950/60 text-purple-300 border border-purple-800/30 font-semibold">Custom Form</span>
                      )}
                    </div>
                    {task.description && <p className="text-sm text-brand-400">{task.description}</p>}
                    <div className="flex gap-4 text-xs text-brand-600 flex-wrap">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" />{task.assigned_to_name || "Unassigned"}</span>
                      {task.due_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(task.due_date).toLocaleDateString()}</span>}
                      <span className="text-[10px]">By: {task.assigned_by}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    {done && rep && (
                      <button onClick={() => setViewing({ task, rep })} className="btn-secondary text-xs px-2.5 py-1 flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" /> View Report
                      </button>
                    )}
                    {!done && task.requires_report && hasCustomForm && (
                      <button onClick={() => { setFormTask(task); setFormResponses({}); setFormNotes(""); }}
                        className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" /> Fill Form
                      </button>
                    )}
                    {!done && task.requires_report && !hasCustomForm && (
                      <button onClick={() => setCompleting(task)} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
                        <Send className="w-3.5 h-3.5" /> Stock Report
                      </button>
                    )}
                    {!done && !task.requires_report && (
                      <button onClick={() => { setFormTask(task); setFormResponses({}); setFormNotes(""); }}
                        className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 border-brand-700 text-brand-300">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Mark Done
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── CREATE TASK MODAL ───────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto">
          <div className="card w-full max-w-xl my-8 space-y-4 bg-surface-900 border-surface-700">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-brand-400" /> Assign Task
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="label">Task Title</label>
                <input className="input" placeholder="e.g. Egg Inventory Count" required
                  value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} />
              </div>
              <div>
                <label className="label">Instructions</label>
                <textarea className="input min-h-[70px]" placeholder="Describe what the staff member needs to do..."
                  value={newTask.description} onChange={e => setNewTask({ ...newTask, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Assign To</label>
                  <select className="select" value={newTask.assigned_to_id}
                    onChange={e => setNewTask({ ...newTask, assigned_to_id: e.target.value })}>
                    <option value="">Choose User</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Due Date</label>
                  <input type="date" className="input" value={newTask.due_date}
                    onChange={e => setNewTask({ ...newTask, due_date: e.target.value })} />
                </div>
              </div>

              {/* Report toggle */}
              <div className="border-t border-surface-700 pt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="req-rep" checked={newTask.requires_report}
                    onChange={e => setNewTask({ ...newTask, requires_report: e.target.checked })}
                    className="rounded border-surface-600" />
                  <label htmlFor="req-rep" className="text-xs font-semibold text-brand-350 select-none">
                    This task requires a report on completion
                  </label>
                </div>

                {newTask.requires_report && (
                  <div className="space-y-3 bg-surface-850 border border-surface-700 rounded-xl p-3">
                    <p className="text-xs font-semibold text-brand-400">
                      Build your custom report form — staff will fill these fields when completing the task.
                    </p>
                    <div className="space-y-2">
                      {formFields.map((f, i) => (
                        <FieldRow key={i} field={f} idx={i} onChange={updateField} onRemove={removeField} />
                      ))}
                    </div>
                    <button type="button" onClick={addField}
                      className="btn-secondary w-full text-xs border-dashed border-brand-700 text-brand-400">
                      <PlusCircle className="w-3.5 h-3.5" /> Add Form Field
                    </button>
                    {formFields.length === 0 && (
                      <p className="text-[10px] text-brand-600 text-center">
                        Leave empty to use the default Inventory Report (spoiled/broken stock).
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowCreate(false); setFormFields([]); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary">
                  {submitting ? "Saving..." : "Assign Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── INVENTORY REPORT MODAL ──────────────────────────────── */}
      {completing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-md space-y-4 bg-surface-900 border-surface-700">
            <div className="border-b border-surface-700 pb-2">
              <h2 className="text-base font-bold text-white">Stock Audit: {completing.title}</h2>
              <p className="text-xs text-brand-500 mt-1">Submit damaged stock details to complete this task.</p>
            </div>
            <form onSubmit={handleInvSubmit} className="space-y-3">
              <div>
                <label className="label">Product</label>
                <select className="select" required value={invReport.product_id}
                  onChange={e => setInvReport({ ...invReport, product_id: e.target.value })}>
                  <option value="">Select product...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} — Stock: {p.stock_qty} {p.unit}s</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Spoiled</label>
                  <input type="number" min="0" className="input" value={invReport.spoiled_qty}
                    onChange={e => setInvReport({ ...invReport, spoiled_qty: e.target.value })} />
                </div>
                <div>
                  <label className="label">Broken</label>
                  <input type="number" min="0" className="input" value={invReport.broken_qty}
                    onChange={e => setInvReport({ ...invReport, broken_qty: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Actual Counted Stock (optional — overrides system)</label>
                <input type="number" min="0" className="input" placeholder="Leave blank to just deduct spoiled+broken"
                  value={invReport.actual_qty} onChange={e => setInvReport({ ...invReport, actual_qty: e.target.value })} />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input min-h-[60px]" value={invReport.notes}
                  onChange={e => setInvReport({ ...invReport, notes: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setCompleting(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary">
                  {submitting ? "Submitting..." : "Submit Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CUSTOM FORM MODAL ───────────────────────────────────── */}
      {formTask && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto">
          <div className="card w-full max-w-md my-8 space-y-4 bg-surface-900 border-surface-700">
            <div className="border-b border-surface-700 pb-2">
              <h2 className="text-base font-bold text-white">{formTask.title}</h2>
              {formTask.description && <p className="text-xs text-brand-400 mt-1">{formTask.description}</p>}
            </div>
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {formTask.form_schema ? (
                <DynamicForm
                  schema={formTask.form_schema}
                  responses={formResponses}
                  onChange={(label, val) => setFormResponses(r => ({ ...r, [label]: val }))}
                />
              ) : (
                <p className="text-sm text-brand-400 text-center py-4">Mark this task as completed with a note.</p>
              )}
              <div>
                <label className="label">Additional Notes</label>
                <textarea className="input min-h-[60px]" value={formNotes}
                  onChange={e => setFormNotes(e.target.value)} />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setFormTask(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary">
                  {submitting ? "Submitting..." : "Complete Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── VIEW REPORT MODAL ───────────────────────────────────── */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-md space-y-4 bg-surface-900 border-surface-700">
            <div className="flex justify-between items-center border-b border-surface-700 pb-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" /> Submitted Report
              </h2>
              <button onClick={() => setViewing(null)} className="text-xs text-brand-500 hover:text-white">Close</button>
            </div>
            <p className="text-sm font-semibold text-brand-300">{viewing.task.title}</p>

            {/* Custom form responses */}
            {viewing.rep.form_responses ? (
              <div className="space-y-2">
                {Object.entries(viewing.rep.form_responses).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-surface-800 pb-1.5">
                    <span className="text-xs text-brand-500">{k}</span>
                    <span className="text-xs font-bold text-white">{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              /* Inventory report */
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Product", val: viewing.rep.product_name, color: "text-white" },
                  { label: "Opening Stock", val: `${viewing.rep.opening_stock} ${viewing.rep.unit}s`, color: "text-white" },
                  { label: "Spoiled", val: `-${viewing.rep.spoiled_qty} ${viewing.rep.unit}s`, color: "text-amber-400" },
                  { label: "Broken", val: `-${viewing.rep.broken_qty} ${viewing.rep.unit}s`, color: "text-red-400" },
                  { label: "Actual/Closing", val: `${viewing.rep.actual_qty} ${viewing.rep.unit}s`, color: "text-emerald-400" },
                ].map(row => (
                  <div key={row.label} className="p-2.5 bg-surface-800 rounded-xl">
                    <p className="text-[9px] uppercase tracking-wider text-brand-500">{row.label}</p>
                    <p className={`text-sm font-bold mt-0.5 ${row.color}`}>{row.val}</p>
                  </div>
                ))}
              </div>
            )}

            {(viewing.rep.notes || viewing.rep.submitted_by) && (
              <div className="p-3 bg-surface-800 rounded-xl space-y-1">
                {viewing.rep.notes && <p className="text-xs text-brand-300 whitespace-pre-wrap">{viewing.rep.notes}</p>}
                {viewing.rep.submitted_by && (
                  <p className="text-[10px] text-brand-600">Submitted by {viewing.rep.submitted_by}</p>
                )}
              </div>
            )}

            <button onClick={() => setViewing(null)} className="btn-primary w-full">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
