import { useState, useEffect, useRef } from "react";
import { User, MapPin, Phone, ChevronDown } from "lucide-react";
import api from "../api/client";

/**
 * CustomerAutocomplete
 * Renders an input that auto-suggests customers from the address book.
 * When a customer is selected, it calls `onSelect(customer)` so the parent
 * can pre-fill all fields (phone, address, city, rider, items).
 *
 * Props:
 *   value          — current customer name string
 *   onChange(val)  — called when user types
 *   onSelect(obj)  — called when user picks a suggestion
 *   placeholder
 *   inputClassName
 */
export default function CustomerAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Customer name...",
  inputClassName = "input",
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  // Fetch suggestions on keystroke (debounced 300ms)
  useEffect(() => {
    if (!value || value.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/api/customers?q=${encodeURIComponent(value)}&limit=8`);
        setSuggestions(res.data);
        setOpen(res.data.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (cust) => {
    setOpen(false);
    onSelect(cust);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-600 pointer-events-none" />
        <input
          className={`${inputClassName} pl-9`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-surface-900 border border-surface-700 rounded-xl shadow-2xl overflow-hidden">
          {suggestions.map((cust) => (
            <button
              key={cust.id}
              type="button"
              onClick={() => handleSelect(cust)}
              className="w-full text-left px-4 py-3 hover:bg-surface-800 transition-colors border-b border-surface-800 last:border-0 group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{cust.name}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {cust.phone && (
                      <span className="flex items-center gap-1 text-xs text-brand-500">
                        <Phone className="w-3 h-3" /> {cust.phone}
                      </span>
                    )}
                    {(cust.city || cust.delivery_address) && (
                      <span className="flex items-center gap-1 text-xs text-brand-500">
                        <MapPin className="w-3 h-3" /> {cust.city || cust.delivery_address}
                      </span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-brand-700 group-hover:text-brand-400 whitespace-nowrap">
                  {cust.order_count}x orders
                </span>
              </div>
              {cust.preferred_rider && (
                <p className="text-xs text-emerald-600 mt-1">Rider: {cust.preferred_rider}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
