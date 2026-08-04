import { RECONCILIATION_URL } from './utils';

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });
const jsonHeaders = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

export async function fetchDay(token, date) {
  const res = await fetch(`${RECONCILIATION_URL}/day/${date}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to load record.');
  return res.json();
}

export async function submitRecord(token, body) {
  const res = await fetch(`${RECONCILIATION_URL}/submit`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to save changes.');
  return res.json();
}

export async function bulkApprove(token, dates) {
  const res = await fetch(`${RECONCILIATION_URL}/bulk-approve`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ dates }),
  });
  if (!res.ok) throw new Error('Failed to approve selected records.');
  return res.json();
}

export async function fetchAuditLog(token, date) {
  const res = await fetch(`${RECONCILIATION_URL}/audit-log/${date}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to load activity log.');
  return res.json();
}

export async function fetchZReport(token, date) {
  const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://localhost:7276/api'}/z-reports/${date}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to load the Z-Report email.');
  return res.json();
}

export async function downloadBillPdf(token, date) {
  const res = await fetch(`${RECONCILIATION_URL}/download-bill?date=${date}`, { headers: authHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Download failed.');
  }
  return res.blob();
}
