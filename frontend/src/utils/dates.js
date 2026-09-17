export function pakistanDateInput(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function pakistanMonthInput(date = new Date()) {
  return pakistanDateInput(date).slice(0, 7);
}

export function serverDate(value) {
  if (!value) return null;
  const text = String(value);
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`);
}
