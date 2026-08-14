import { dateOnly } from "./activeDate.js";
import { ingestTillReports } from "./tillReportIngest.js";
import { evaluateAndNotify } from "./shiftReconciliation.js";

// "notify the admin so they can go check and correct it" cannot depend on a
// staff member happening to load a page — this is the primary path that
// actually delivers on that requirement. ensureReportsForDate (the lazy,
// per-request path used everywhere else) only ever fires when someone is
// looking at a specific date, which an admin who isn't already worried has
// no reason to do.
//
// Ingestion itself is unconditional (till reports are cached/parsed
// regardless of the shift-entry feature, same as every other phase of this
// work) — only evaluateAndNotify's actual notification behaviour is gated
// on SHIFT_ENTRY_ENABLED, and that gate lives inside evaluateAndNotify
// itself, not here, so flipping the flag on requires no restart to start
// catching up on whatever was already ingested while it was off.
export async function runTillPollCycle(): Promise<void> {
  const today = dateOnly(new Date());
  const from = new Date(today);
  from.setDate(from.getDate() - 1);
  const to = new Date(today);
  to.setDate(to.getDate() + 1);

  const result = await ingestTillReports(from, to);

  const seen = new Set<string>();
  for (const { date, shift } of result.affected) {
    const key = `${date.toISOString()}|${shift}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      await evaluateAndNotify(date, shift);
    } catch (err) {
      console.error(`[tillPoller] evaluateAndNotify failed for ${key}`, err);
    }
  }
}

export function startTillPoller(): void {
  const minutes = Number(process.env.TILL_POLL_INTERVAL_MINUTES ?? 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log("[tillPoller] disabled (TILL_POLL_INTERVAL_MINUTES=0)");
    return;
  }

  console.log(`[tillPoller] polling every ${minutes} minute(s)`);
  setInterval(() => {
    runTillPollCycle().catch((err) => console.error("[tillPoller] cycle failed", err));
  }, minutes * 60_000);
}
