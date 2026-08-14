import { prisma } from "./prisma.js";
import { Shift } from "@prisma/client";

export function dateOnly(input: Date | string): Date {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function getActiveDate(): Promise<Date> {
  const override = await prisma.activeDateOverride.findUnique({ where: { id: 1 } });
  if (override?.activeDate) return override.activeDate;
  return dateOnly(new Date());
}

// ── Shift classification ──────────────────────────────────────────────────
// Pure, DB-free helpers so till-report ingestion can classify a report's
// shift from its own printed time without needing "what shift is it right
// now" context (that's getActiveContext, layered on top of these — see the
// active-shift work). Kept here alongside dateOnly/getActiveDate since both
// are "what point in the business calendar does this belong to" concerns.

// "HH:MM", default 15:00. Read from the env on every call (not cached at
// module load) so a Render env var change takes effect on redeploy without a
// code change.
export function shiftCutoffMinutes(): number {
  const raw = process.env.SHIFT_CUTOFF_TIME ?? "15:00";
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 15 * 60;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return 15 * 60;
  return hours * 60 + minutes;
}

// Minutes since local midnight in the SHOP's timezone — deliberately not
// `at.getHours()`, which reads the server's timezone. Render runs UTC; the
// shop is Europe/London, so during BST that would put the cutoff an hour
// wrong for half the year.
export function shopMinutesOfDay(at: Date): number {
  const tz = process.env.SHOP_TIMEZONE ?? "Europe/London";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

// Single source of truth for cutoff classification — used both for
// classifying a till report's own printed time (shop-local, from the report
// body, timezone-free by construction) and for the live active-shift clock
// (shopMinutesOfDay above), so the two can never disagree about where the
// line falls.
export function classifyShift(minutesOfDay: number): Shift {
  return minutesOfDay >= shiftCutoffMinutes() ? Shift.NIGHT : Shift.DAY;
}

// Off by default — deliberately requires an explicit opt-in on a chosen
// cutover date. This is the single switch that decides whether every entry
// write (DailySummary, Deduction, LotteryRecord, PaypointRecord,
// InstantLotteryInventoryEntry, SupplierInvoice) targets today's real
// DAY/NIGHT shift or the legacy FULL_DAY bucket every pre-split row already
// uses — the schema change and the behaviour change are deliberately
// decoupled so they can be verified independently before going live.
export function isShiftEntryEnabled(): boolean {
  return process.env.SHIFT_ENTRY_ENABLED === "true";
}

export interface ActiveContext {
  date: Date;
  // FULL_DAY exactly when isShiftEntryEnabled() is false — every write
  // lands where it always has. DAY/NIGHT only once the feature is live.
  shift: Shift;
  shiftSource: "clock" | "override";
}

// The nine staff entry pages have no date picker of their own — they rely
// on the server telling them what date/shift they're writing to. This is
// that single source, reading the ActiveDateOverride singleton once and
// deriving both date and shift from it together (rather than calling
// getActiveDate() separately, which would mean two round trips and a
// window where the two could theoretically read a different override row).
export async function getActiveContext(): Promise<ActiveContext> {
  const override = await prisma.activeDateOverride.findUnique({ where: { id: 1 } });
  const date = override?.activeDate ?? dateOnly(new Date());

  if (!isShiftEntryEnabled()) {
    return { date, shift: Shift.FULL_DAY, shiftSource: "clock" };
  }

  if (override?.activeShift) {
    return { date, shift: override.activeShift, shiftSource: "override" };
  }

  return { date, shift: classifyShift(shopMinutesOfDay(new Date())), shiftSource: "clock" };
}
