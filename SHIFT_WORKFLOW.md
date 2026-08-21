# Two-Shift X Report Workflow — Reference

Morning X → Night X → admin correction → Z reconciliation.

Branch: work applied on top of the session-photo changes (uncommitted).
Status: backend and frontend complete, verified. See section 1 for the one
manual step left.


================================================================================
1. WHAT YOU STILL HAVE TO DO
================================================================================

1.1 Connect Gmail with the send scope
-------------------------------------

Every outbound email in this app is currently failing. The stored Gmail grant
carries only `gmail.readonly`, but the code asks for `readonly + send`. That
breaks admin OTP login, commit notifications, AND the shift-variance and
X-vs-Z alerts that already existed before this work.

There was a deadlock: /api/gmail/connect needs an admin session, an admin
session needs an emailed OTP, and the OTP needs gmail.send. A one-time script
breaks it without weakening the endpoint:

    cd Sales-api
    npm run dev                 # the callback must be reachable
    # in another terminal:
    npm run gmail:consent       # prints a consent URL, valid 10 minutes

Open the URL, approve BOTH permissions (read AND send). The existing ungated
callback stores the new grant. Verify with a real send before trusting any
alert.

If you want a specific admin account: `npm run gmail:consent -- 3`

1.2 Turn the two-shift feature on when you are ready
----------------------------------------------------

`SHIFT_ENTRY_ENABLED` ships false. While it is false every entry lands in the
legacy FULL_DAY bucket and the per-shift workflow is inert — this is
deliberate, and the code comments call it "an explicit opt-in on a chosen
cutover date".

    SHIFT_ENTRY_ENABLED=true
    SHIFT_CUTOFF_TIME=17:00
    SHOP_TIMEZONE=Europe/London

Pick a cutover date and set it at the start of that business day. Turning it on
mid-day splits that day's figures across two shifts partway through.


================================================================================
2. WHAT ALREADY EXISTED (and was NOT rebuilt)
================================================================================

Most of the requested workflow was already implemented. It was reused, not
replaced:

  * X and Z reports are NOT typed in by staff. The till emails them; the
    poller ingests them (every 10 min) and tillReportParser.ts parses them into
    an immutable TillReport table.
  * "Staff entered" means the sum of what staff typed across the entry pages
    (computeShiftTotals in lib/dailyTotals.ts) — compared against the till's
    own X-Report figure. That IS the "Entered vs Expected" model.
  * Per-shift variance with a £5 tolerance (lib/variance.ts), and a
    PENDING / OK / VARIANCE / RESOLVED state machine.
  * Admin correction with a MANDATORY reason and full before/after audit:
    POST /api/admin/reconciliation/shift/edit
  * Combined calculation on FINAL (admin-approved) totals, and the X-vs-Z
    comparison: evaluateDay() in lib/shiftReconciliation.ts
  * The admin shift breakdown UI showing the whole provenance chain.
  * Two alert emails, de-duped so an unchanged variance is not re-sent.

TillReport is immutable by design. A till figure is never hand-edited;
corrections live on ShiftReconciliation.adminEditedTotal beside the original.


================================================================================
3. WHAT WAS BUILT
================================================================================

3.1 Per-shift commit (the real gap)
------------------------------------

Commit used to be per-DAY only, and gated on the Z-Report arriving. The Z
lands after the night shift, so THE MORNING SHIFT COULD NEVER COMMIT.

New endpoint:

    POST /api/Summary/shift-commit
      body: { staffNotes?: string }
      date + shift come from getActiveContext() — never from the body

  * No Z-Report gate. A shift is validated against its own X-Report.
  * 400 if the active shift is FULL_DAY (feature off).
  * 409 if the shift is already committed, or the day is locked.
  * Rejects negative/non-finite figures, naming the offending field.
  * Runs evaluateAndNotify() so an out-of-tolerance shift still raises the
    existing variance email.
  * Audited as `shift_commit`.

New columns on ShiftReconciliation:

    isShiftCommitted, shiftCommittedByUserId, shiftCommittedByName,
    shiftCommittedAt, shiftStaffNotes

These are written ONLY by that endpoint. evaluateShift deliberately excludes
them from its write set, exactly as it excludes the admin-edit columns — so a
poller cycle or a staff re-save can never silently un-commit a shift.

The day-level POST /Summary/commit is unchanged and still Z-gated. It remains
the final step that closes the whole day.

3.2 Locking — and two bugs this fixed
--------------------------------------

New shared predicate: `src/lib/entryLock.ts`

    isDayLocked(date)            ReconciliationRecord.isStaffCommitted
                                 || isAdminReconciled
    isShiftCommitted(date,shift) ShiftReconciliation.isShiftCommitted
    getLockState(date, shift)    both, composed, with a message
    blockIfLocked(res,date,shift) guard returning 409

TWO PRE-EXISTING BUGS were found and fixed while wiring this up:

  1. GET /Summary/today returned DailySummary.isCommitted and
     .isPendingAdminReview — DEAD COLUMNS that nothing has ever written. They
     are permanently false, so the UI's lock expression
     (`isCommitted || isPendingAdminReview`) never engaged. The entry pages
     did not lock after a day was committed.

  2. PUT /api/Summary had NO server-side lock check at all.

So "staff cannot change committed values" was not enforced anywhere — not on
the server, and not even in the UI. Both are now fixed: /Summary/today reports
the real lock state, and the write routes enforce it.

Guarded routes: PUT /Summary, POST /Deduction, POST+PUT /lottery,
POST+PUT /paypoint, POST+DELETE /LotteryInstant, and session photos.

The lottery/paypoint PUT /:id handlers lock against the EXISTING row's own
(date, shift), not the active context — they update by id, so the row may
belong to a different session than the caller is working.

DELIBERATE EXEMPTION: supplier invoices are NOT lock-guarded. The code states
the rule — "supplier payout values must remain editable at all times" —
because invoices arrive with deliveries rather than on the shift schedule. A
guard was added there and then removed on finding that comment.

3.3 Staff shift isolation
--------------------------

GET /Summary/shift-status now scopes money to the caller's own shift. The
other shift returns status only:

    { shift: "DAY", isOwnShift: false, originalStatus, finalStatus, hasEntries }

No originalTotal, staffEnteredTotal, finalTotal or differences. Status is kept
deliberately so the Shop Sale handover calendar still works — you can see the
other shift is in variance without seeing its figures.

The active shift is read server-side, so requesting another date cannot widen
what a staff member sees. Passing FULL_DAY (feature off) returns everything,
which is correct — there is only one shift then.

3.4 Reports
-----------

Every existing renderer was day-level. Two new ones in `src/lib/pdf.ts`, built
on the same newDocument/drawHeader/drawTable/addPageNumbers helpers:

    GET /api/admin/reconciliation/download-shift?date=&shift=DAY|NIGHT
    GET /api/admin/reconciliation/download-daily?date=

The shift PDF shows the full chain: till total (with a note when more than one
X-Report was printed and the totals were summed), staff entry and who
submitted it, any admin correction with its reason, and the final approved
value with status.

The daily PDF is the six-part document: Day shift, Night shift, corrections
inline with each, final reconciliation (Day + Night), Z Report, and the X vs Z
comparison ending in MATCH / MISMATCH.

Both are gated on the `commitHistory` permission like every sibling endpoint.
Buttons are wired into the admin Shift Breakdown panel.


================================================================================
4. THE WORKFLOW
================================================================================

  Morning staff enter figures on the entry pages
        |
        v
  POST /Summary/shift-commit          <- no Z-Report needed
        |
        +-- shift freezes (409 on further writes, photos included)
        +-- variance email if outside £5 tolerance
        |
        v
  Night staff — a fresh, unlocked session
        |
        +-- sees the day shift's STATUS, not its figures
        +-- scratch-card Open No carries from the day shift's Close No
        |
        v
  POST /Summary/shift-commit
        |
        v
  Admin corrects if needed (reason mandatory, fully audited)
        |
        v
  evaluateDay: X(day) + X(night) on FINAL totals, compared to Z
        |
        v
  POST /Summary/commit                <- Z-Report required, closes the day


================================================================================
5. VERIFICATION PERFORMED
================================================================================

11 new unit tests (vitest) covering the lock composition, plus the 17 existing
parser tests — 28 pass.

End-to-end against a throwaway Postgres, with SHIFT_ENTRY_ENABLED=true:

  Shift commit
    day shift committed with NO Z-Report present     <- the core fix
    writes then 409 on Summary / lottery / deduction
    re-commit 409
    /Summary/today reports isShiftCommitted + isLocked

  Isolation
    night is a fresh unlocked session while day is committed
    day shift figures hidden from night staff (no money keys at all)
    day shift STATUS still visible
    body-supplied shift/date ignored

  Reconciliation, with real till figures
    DAY   till 200 vs staff 185 -> £15 -> VARIANCE
    NIGHT till 275 vs staff 275 -> £0  -> OK
    X vs Z: 185 + 275 = 460 vs Z 460 -> MATCH
    admin corrects DAY to 200, reason required (400 without one)
    -> finalStatus RESOLVED
    -> X vs Z recomputes: 200 + 275 = 475 vs 460 -> MISMATCH
    -> AuditLog previousValue holds the pre-correction state

  Downloads
    shift PDF and daily PDF return real PDFs with correct figures
    correction chain and reason appear in the PDF
    bad shift 400, missing date 400, staff 403, unauthenticated 401

  Regression (12 checks)
    session photos still work, and now lock with their shift
    all existing admin reconciliation endpoints still 200
    all existing staff endpoints still 200
    day commit still refuses without a Z-Report

Build state:
    API typecheck            PASS
    API tests                28 passed
    UI build                 PASS
    UI lint                  27 errors / 17 warnings == pre-existing baseline
                             (this work adds none)


================================================================================
6. NOT BUILT (agreed out of scope)
================================================================================

  * "Shift submitted" emails for in-tolerance submissions. Variance and X-vs-Z
    alerts already fire; only the "all fine" notification is missing.
  * Full staff isolation — the Shop Sale two-shift status calendar was kept.
  * History search by user / match status / corrected. AuditLog has no read
    endpoint at all today, so this needs one built from scratch.
  * Per-user alert routing. COMMIT_NOTIFICATION_EMAIL is still one address.
  * A UI for /api/admin/till-reports — three working endpoints, still no page.
  * Manual override of a till figure. TillReport is immutable by design.
  * Excel/CSV equivalents of the two new PDFs (PDF only for now).


================================================================================
7. GOTCHAS
================================================================================

PUT /api/Summary is a FULL-ROW REPLACE. Any omitted numeric key is written as
0. Each entry page compensates with a hand-maintained PRESERVE_KEYS list
(CashBanking.jsx, CreditCardBanking.jsx). Add a field without updating those
lists and it gets silently zeroed on their save.

ReconciliationRecord.zReportTotal is a legacy column written only by the day
commit and admin submit. It can disagree with the Z value that
xVsZDifference was computed against. Two places in the code already work
around this — read evaluateDay's return value, not that column.

evaluateDay upserts a ReconciliationRecord with neither commit flag set, purely
to hold the X-vs-Z figures. Those phantom rows must not read as committed —
the lock predicate and GET /pending both filter for the flags explicitly.

pdfkit's standard Helvetica uses WinAnsi encoding: U+2212 MINUS renders as a
stray quote. Use an ASCII hyphen in PDF text. (Hit and fixed during this work.)
