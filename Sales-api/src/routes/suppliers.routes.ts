import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate, dateOnly } from "../lib/activeDate.js";
import { writeAuditLog } from "../lib/auditLog.js";
import { renderSupplierPayoutPdf, type SupplierPayoutInvoiceRow } from "../lib/pdf.js";
import { buildSupplierPayoutExcel } from "../lib/excel.js";
import { requirePermission } from "../lib/permissions.js";

export const suppliersRouter = Router();

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// §2 — narrow, specific lock: an invoice is read-only once its date's
// ReconciliationRecord.isStaffCommitted is true, UNLESS an admin has
// explicitly reopened that date via supplierInvoicesReopened. This has no
// relationship to (and does not touch) DailySummary.isCommitted /
// isPendingAdminReview, which gate the Summary/Deductions/Lottery/Paypoint
// pages — those are untouched by this change.
async function isInvoiceDateLocked(date: Date): Promise<boolean> {
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });
  if (!record || !record.isStaffCommitted) return false;
  return !record.supplierInvoicesReopened;
}

suppliersRouter.get("/invoices/today", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  const invoices = await prisma.supplierInvoice.findMany({ where: { date }, orderBy: { createdAt: "asc" } });
  res.json(invoices.map((i) => ({ id: i.supplierInvoiceId, supplierName: i.supplierName, invoiceNo: i.invoiceNo, value: i.value })));
});

suppliersRouter.get("/invoices/dates", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const invoices = await prisma.supplierInvoice.findMany({ orderBy: { date: "desc" } });
  const byDate = new Map<string, { count: number; total: number }>();
  for (const inv of invoices) {
    const key = inv.date.toISOString().split("T")[0];
    const entry = byDate.get(key) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += Number(inv.value);
    byDate.set(key, entry);
  }

  res.json(
    Array.from(byDate.entries()).map(([date, { count, total }]) => ({
      date,
      invoiceCount: count,
      totalValue: total,
    })),
  );
});

// Accepts either a single ?date= (legacy, still used by the day-by-day
// SupplierInvoices detail view) or a ?fromDate=&toDate= range (used by the
// range-only filter and the PDF/Excel/Print export). Exactly one style is
// expected per call — date takes precedence if both are somehow supplied.
suppliersRouter.get("/invoices", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const dateParam = req.query.date as string | undefined;
  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;

  if (!dateParam && !fromParam && !toParam) {
    return res.status(400).json({ message: "date, or fromDate/toDate, query parameters are required." });
  }

  const where = dateParam
    ? { date: dateOnly(dateParam) }
    : {
        date: {
          ...(fromParam ? { gte: dateOnly(fromParam) } : {}),
          ...(toParam ? { lte: dateOnly(toParam) } : {}),
        },
      };

  const invoices = await prisma.supplierInvoice.findMany({ where, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  if (invoices.length === 0) return res.status(404).json({ message: "No invoices found for this date." });

  res.json(
    invoices.map((i) => ({
      id: i.supplierInvoiceId,
      date: i.date.toISOString().split("T")[0],
      supplierName: i.supplierName,
      invoiceNo: i.invoiceNo,
      value: i.value,
      enteredBy: i.enteredByName,
      time: i.createdAt,
    })),
  );
});

// Supplier Payout report exports — same "any authenticated user" gate as
// the invoice-viewing routes above (there is no dedicated permission on
// viewing this data today; these deliberately match that, not stricter).
async function loadPayoutRows(fromDate: Date, toDate: Date): Promise<SupplierPayoutInvoiceRow[]> {
  const invoices = await prisma.supplierInvoice.findMany({
    where: { date: { gte: fromDate, lte: toDate } },
    orderBy: [{ supplierName: "asc" }, { date: "asc" }],
  });
  return invoices.map((i) => ({
    date: i.date.toISOString().split("T")[0],
    supplierName: i.supplierName,
    invoiceNo: i.invoiceNo,
    value: Number(i.value),
    enteredBy: i.enteredByName,
  }));
}

suppliersRouter.get("/invoices/download-pdf", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;
  if (!fromParam || !toParam) return res.status(400).json({ message: "fromDate and toDate query parameters are required." });

  const fromDate = dateOnly(fromParam);
  const toDate = dateOnly(toParam);
  const rows = await loadPayoutRows(fromDate, toDate);

  const fromStr = fromDate.toISOString().split("T")[0];
  const toStr = toDate.toISOString().split("T")[0];
  const pdf = await renderSupplierPayoutPdf(rows, fromStr, toStr, { generatedByName: req.userName });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="supplier-payout-${fromStr}-to-${toStr}.pdf"`);
  res.send(pdf);
});

suppliersRouter.get("/invoices/download-excel", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const fromParam = req.query.fromDate as string | undefined;
  const toParam = req.query.toDate as string | undefined;
  if (!fromParam || !toParam) return res.status(400).json({ message: "fromDate and toDate query parameters are required." });

  const fromDate = dateOnly(fromParam);
  const toDate = dateOnly(toParam);
  const rows = await loadPayoutRows(fromDate, toDate);

  const fromStr = fromDate.toISOString().split("T")[0];
  const toStr = toDate.toISOString().split("T")[0];
  const excel = await buildSupplierPayoutExcel(rows, fromStr, toStr, { generatedByName: req.userName });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="supplier-payout-${fromStr}-to-${toStr}.xlsx"`);
  res.send(excel);
});

// Lets the staff-facing edit UI know, for a given date, whether invoices are
// currently editable — i.e. either never committed, or committed but
// reopened by an admin. Read by Deductions.jsx before showing Edit controls.
suppliersRouter.get("/invoices/lock-status", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const dateParam = req.query.date as string | undefined;
  if (!dateParam) return res.status(400).json({ message: "date query parameter is required." });

  const date = dateOnly(dateParam);
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });
  const isStaffCommitted = record?.isStaffCommitted ?? false;
  const supplierInvoicesReopened = record?.supplierInvoicesReopened ?? false;

  res.json({
    date: date.toISOString().split("T")[0],
    isStaffCommitted,
    supplierInvoicesReopened,
    editable: !isStaffCommitted || supplierInvoicesReopened,
  });
});

// Admin-only: flips supplierInvoicesReopened for a specific already-committed
// date, toggling between locked and reopened. This is the ONLY mechanism
// that unlocks a committed date's invoices — it does nothing to
// isStaffCommitted itself, the day's totals, or any other module.
suppliersRouter.put("/invoices/reopen/:date", async (req, res) => {
  if (!requirePermission(req, res, "commitHistory")) return;

  const date = dateOnly(req.params.date);
  const record = await prisma.reconciliationRecord.findUnique({ where: { date } });
  if (!record || !record.isStaffCommitted) {
    return res.status(400).json({ message: "This date has not been committed, so there is nothing to reopen." });
  }

  const updated = await prisma.reconciliationRecord.update({
    where: { date },
    data: { supplierInvoicesReopened: !record.supplierInvoicesReopened },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: updated.supplierInvoicesReopened ? "supplier_invoices_reopen" : "supplier_invoices_relock",
    entity: "ReconciliationRecord",
    entityId: date.toISOString().split("T")[0],
    previousValue: { supplierInvoicesReopened: record.supplierInvoicesReopened },
    newValue: { supplierInvoicesReopened: updated.supplierInvoicesReopened },
  });

  res.json({
    date: date.toISOString().split("T")[0],
    supplierInvoicesReopened: updated.supplierInvoicesReopened,
    message: updated.supplierInvoicesReopened
      ? "Supplier invoices reopened for editing on this date."
      : "Supplier invoices locked again for this date.",
  });
});

suppliersRouter.post("/invoices", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  const { supplierId, invoiceNo, value } = req.body ?? {};
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { supplierId: Number(supplierId) } }) : null;

  const created = await prisma.supplierInvoice.create({
    data: {
      date,
      supplierId: supplier?.supplierId ?? null,
      supplierName: supplier?.name ?? "Unknown Supplier",
      invoiceNo: String(invoiceNo ?? ""),
      value: toNumber(value),
      enteredByUserId: req.userId,
      enteredByName: req.userName ?? null,
    },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "supplier_invoice_create",
    entity: "SupplierInvoice",
    entityId: created.supplierInvoiceId,
    newValue: { supplierName: created.supplierName, invoiceNo: created.invoiceNo, value: created.value },
  });

  res.json({
    id: created.supplierInvoiceId,
    supplierName: created.supplierName,
    invoiceNo: created.invoiceNo,
    value: created.value,
  });
});

// §2 — edit an invoice's value/details. Blocked once the invoice's date has
// been staff-committed, unless an admin has reopened that date (see
// PUT /invoices/reopen/:date above).
suppliersRouter.put("/invoices/:id", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const existing = await prisma.supplierInvoice.findUnique({ where: { supplierInvoiceId: Number(req.params.id) } });
  if (!existing) return res.status(404).json({ message: "Invoice not found." });

  if (await isInvoiceDateLocked(existing.date)) {
    return res.status(403).json({
      message: "This date has been committed. Ask an admin to reopen supplier invoices for this date before editing.",
    });
  }

  const { supplierId, invoiceNo, value } = req.body ?? {};
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { supplierId: Number(supplierId) } }) : null;

  const updated = await prisma.supplierInvoice.update({
    where: { supplierInvoiceId: existing.supplierInvoiceId },
    data: {
      supplierId: supplier?.supplierId ?? existing.supplierId,
      supplierName: supplier?.name ?? existing.supplierName,
      invoiceNo: invoiceNo != null ? String(invoiceNo) : existing.invoiceNo,
      value: value != null ? toNumber(value) : existing.value,
    },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "supplier_invoice_update",
    entity: "SupplierInvoice",
    entityId: updated.supplierInvoiceId,
    previousValue: { supplierName: existing.supplierName, invoiceNo: existing.invoiceNo, value: existing.value },
    newValue: { supplierName: updated.supplierName, invoiceNo: updated.invoiceNo, value: updated.value },
  });

  res.json({
    id: updated.supplierInvoiceId,
    date: updated.date.toISOString().split("T")[0],
    supplierName: updated.supplierName,
    invoiceNo: updated.invoiceNo,
    value: updated.value,
  });
});

suppliersRouter.delete("/invoices/:id", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const existing = await prisma.supplierInvoice.findUnique({ where: { supplierInvoiceId: Number(req.params.id) } });
  if (existing && (await isInvoiceDateLocked(existing.date))) {
    return res.status(403).json({
      message: "This date has been committed. Ask an admin to reopen supplier invoices for this date before deleting.",
    });
  }
  await prisma.supplierInvoice.delete({ where: { supplierInvoiceId: Number(req.params.id) } }).catch(() => null);

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "supplier_invoice_delete",
    entity: "SupplierInvoice",
    entityId: req.params.id,
    previousValue: existing
      ? { supplierName: existing.supplierName, invoiceNo: existing.invoiceNo, value: existing.value }
      : null,
  });

  res.json({ message: "Invoice deleted" });
});

suppliersRouter.get("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  res.json(suppliers.map((s) => ({ id: s.supplierId, name: s.name })));
});

suppliersRouter.post("/", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const { name } = req.body ?? {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Supplier name is required." });
  }

  const created = await prisma.supplier.create({ data: { name: String(name).trim() } });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "supplier_create",
    entity: "Supplier",
    entityId: created.supplierId,
    newValue: { name: created.name },
  });

  res.json({ id: created.supplierId, name: created.name });
});

// §11 — edit a supplier's own details (name). Gated on the "suppliers"
// permission, matching the instruction for this new route; the pre-existing
// POST/DELETE above are left as-is (any authenticated user), since retrofitting
// stricter gating onto them is outside this change's scope.
suppliersRouter.put("/:id", async (req, res) => {
  if (!requirePermission(req, res, "suppliers")) return;

  const { name } = req.body ?? {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Supplier name is required." });
  }

  const existing = await prisma.supplier.findUnique({ where: { supplierId: Number(req.params.id) } });
  if (!existing) return res.status(404).json({ message: "Supplier not found." });

  const updated = await prisma.supplier.update({
    where: { supplierId: existing.supplierId },
    data: { name: String(name).trim() },
  });

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "supplier_update",
    entity: "Supplier",
    entityId: updated.supplierId,
    previousValue: { name: existing.name },
    newValue: { name: updated.name },
  });

  res.json({ id: updated.supplierId, name: updated.name });
});

suppliersRouter.delete("/:id", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const existing = await prisma.supplier.findUnique({ where: { supplierId: Number(req.params.id) } });
  await prisma.supplier.delete({ where: { supplierId: Number(req.params.id) } }).catch(() => null);

  void writeAuditLog({
    userId: req.userId,
    userName: req.userName,
    action: "supplier_delete",
    entity: "Supplier",
    entityId: req.params.id,
    previousValue: existing ? { name: existing.name } : null,
  });

  res.json({ message: "Supplier deleted" });
});
