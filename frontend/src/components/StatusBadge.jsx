// Status badge with colored pill
const STATUS_MAP = {
  pending:          { label: "Pending",           cls: "badge-pending" },
  ready_to_ship:    { label: "Ready to Ship",     cls: "badge-rts" },
  out_for_delivery: { label: "Out for Delivery",  cls: "badge-otd" },
  delivered:        { label: "Delivered",         cls: "badge-delivered" },
  returned:         { label: "Returned",          cls: "badge-cancelled" },
  cancelled:        { label: "Cancelled",         cls: "badge-cancelled" },
};

const PRIORITY_MAP = {
  normal: { label: "Normal",  cls: "badge-normal" },
  high:   { label: "High",    cls: "badge-high" },
  urgent: { label: "URGENT",  cls: "badge-urgent" },
};

const PAYMENT_MAP = {
  cod:    { label: "COD",     cls: "badge-cod" },
  paid:   { label: "Paid",    cls: "badge-paid" },
  unpaid: { label: "Unpaid",  cls: "badge-unpaid" },
  received: { label: "Received", cls: "badge-paid" },
  credit: { label: "Credit", cls: "badge-unpaid" },
  returned: { label: "Returned", cls: "badge-unpaid" },
};

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { label: status, cls: "badge-pending" };
  return <span className={s.cls}>{s.label}</span>;
}

export function PriorityBadge({ priority }) {
  const p = PRIORITY_MAP[priority] || { label: priority, cls: "badge-normal" };
  return <span className={p.cls}>{p.label}</span>;
}

export function PaymentBadge({ payment_status }) {
  const p = PAYMENT_MAP[payment_status] || { label: payment_status, cls: "badge-cod" };
  return <span className={p.cls}>{p.label}</span>;
}
