import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getActiveDate, dateOnly } from "../lib/activeDate.js";

export const suppliersRouter = Router();

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

suppliersRouter.get("/invoices", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const dateParam = req.query.date as string | undefined;
  if (!dateParam) return res.status(400).json({ message: "date query parameter is required." });

  const date = dateOnly(dateParam);
  const invoices = await prisma.supplierInvoice.findMany({ where: { date }, orderBy: { createdAt: "asc" } });
  if (invoices.length === 0) return res.status(404).json({ message: "No invoices found for this date." });

  res.json(
    invoices.map((i) => ({
      id: i.supplierInvoiceId,
      supplierName: i.supplierName,
      invoiceNo: i.invoiceNo,
      value: i.value,
      enteredBy: i.enteredByName,
      time: i.createdAt,
    })),
  );
});

suppliersRouter.post("/invoices", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  const date = await getActiveDate();
  const summary = await prisma.dailySummary.findUnique({ where: { date } });
  if (summary?.isCommitted) {
    return res.status(409).json({ message: "Today has already been committed and can no longer be edited." });
  }

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

  res.json({
    id: created.supplierInvoiceId,
    supplierName: created.supplierName,
    invoiceNo: created.invoiceNo,
    value: created.value,
  });
});

suppliersRouter.delete("/invoices/:id", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  await prisma.supplierInvoice.delete({ where: { supplierInvoiceId: Number(req.params.id) } }).catch(() => null);
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
  res.json({ id: created.supplierId, name: created.name });
});

suppliersRouter.delete("/:id", async (req, res) => {
  if (req.userId == null) return res.status(401).json({ message: "User not authenticated" });

  await prisma.supplier.delete({ where: { supplierId: Number(req.params.id) } }).catch(() => null);
  res.json({ message: "Supplier deleted" });
});
