import { prisma } from "./prisma.js";

export function dateOnly(input: Date | string): Date {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function getActiveDate(): Promise<Date> {
  const override = await prisma.activeDateOverride.findUnique({ where: { id: 1 } });
  if (override?.activeDate) return override.activeDate;
  return dateOnly(new Date());
}
