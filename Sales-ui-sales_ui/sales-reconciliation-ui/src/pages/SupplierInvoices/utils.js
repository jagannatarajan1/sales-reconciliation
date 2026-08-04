export const fmtGBP = (val) => {
  if (val == null) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : `£${n.toFixed(2)}`;
};

export const fmtDateLong = (str) =>
  new Date(str).toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

export const fmtDateMed = (str) =>
  new Date(str).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

export const fmtTime = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

const toISODate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const todayStr = () => toISODate(new Date());

export const daysAgoStr = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

export function groupInvoices(invoices, keyFn) {
  const map = new Map();
  for (const inv of invoices) {
    const key = keyFn(inv);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(inv);
  }
  return map;
}

export function sumValue(rows) {
  return rows.reduce((acc, r) => acc + parseFloat(r.value || 0), 0);
}
