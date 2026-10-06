# Pending Changes — Client Meeting 2026-08-10

Client requested a large batch of changes in one meeting. Broken into modules below so
each can be handed to a **fresh session** as its own task, without re-explaining context.

**How to use this file:** start a new session and say something like
`Implement Module 3 from PENDING_CHANGES.md`. Each module lists its own scope, files
likely touched, open questions, and dependencies — read REQUIREMENTS.md and CLAUDE.md
as usual, this file only adds the new-work backlog.

**Mark modules done by striking the heading** (`~~M3: ...~~`) and moving a one-line note
to the Changelog at the bottom, so this file stays a live backlog, not a historical log.

Business framing that applies everywhere: **the company does not close policies, it only
deals in live transfers.** Any residual "closing"-flavored language (labels, help text,
success messages) should be corrected as it's touched, even outside the module that
specifically owns it.

---

## Suggested order / dependency chain

```
M1 (rebrand)  ─┐
M2 (Team Lead)─┼─► M3 (CPL/CPA + routing) ─► M3b (Admin CPL page uses D1-D4) — done 2026-08-12
                │
                └─► M4 (Plan Type + pricing) ─► M4b (revenue/plan analytics)
                                              └─► M9 (client mgmt, revenue per client)

M6, M7, M8, M10, M11, M12, M13 are independent of each other — order freely, but
M1 and M2 touch nav/role plumbing broadly, so doing those first avoids rebasing pain.
```

---

## ~~M1 — Rebrand copy on public marketing pages only~~ (done 2026-08-10)

**Scope, clarified 2026-08-10: this is public-marketing-copy only.** It does NOT touch
the authenticated portals — the `CLOSER` role, its routes (`/closer/...`), nav labels,
dashboards, etc. all keep saying "Closer" internally, unchanged. This module only
touches the pages a visitor sees **before logging in**: `features/marketing/**`
(home, about, services, contact) and the shared `layout/public-shell` wrapper.

- Sweep every "Closer"/"closer" mention in marketing copy → "Compliance" (the
  visitor-facing term for the licensed person who takes the live transfer).
- Sweep "close the policy" / "Policy Closing" / "closed by our in-house team" language
  → live-transfer framing, since the client's point is **we don't close policies, we
  only do live transfers**. E.g. "Close the policy" → something like "Compliance
  takes the transfer" (exact copy is a judgment call — keep it short, matching
  surrounding card copy).
- Known hit list (confirmed via grep 2026-08-10, re-check for drift before editing):
  - `client/src/app/features/marketing/home/home.ts` — hero copy array (`'Closers'`
    section name/desc, `'Close the policy'` title, `'With Closer'` status tag, other
    `Closer` mentions).
  - `client/src/app/features/marketing/home/home.html` — H1 (`close the policy`),
    intro paragraph, features list.
  - `client/src/app/features/marketing/about/about.html` — pipeline stage copy.
  - `client/src/app/features/marketing/services/services.ts` — service card titles
    (`'Policy Closing'`), descriptions, bullet list (`'Licensed closers...'`).
  - `client/src/app/features/marketing/services/services.html` — intro paragraph.
  - `client/src/app/features/marketing/contact/contact.ts` — FAQ answer copy.
  - `client/src/app/layout/public-shell/public-shell.html` — footer tagline, footer
    nav label ("Policy Closing" service link text).
- Do **not** touch: `nav-config.ts`, any `features/closer/**` portal file, seed data,
  role enum, guards, routes under `/closer`. Those are all logged-in-portal surfaces,
  explicitly out of scope per the clarification.

---

## ~~M2 — New role: Team Lead~~ (done 2026-08-10)

- Add `TEAM_LEAD` to the `Role` enum (Prisma schema + client `Role` model + seed).
- Access:
  - Performance analytics for both Closer(Compliance)/Junior Closer — **no revenue,
    no expenses** (new analytics endpoint or a stripped-down variant of the existing
    per-role analytics that omits money fields).
  - Submitted leads, **limited visibility**, filterable per day / week / month. Confirmed
    2026-08-10: Team Lead must **never see the phone number**, same anti-data-theft rule
    as M6's Junior/Closer masking — reuse the `JUNIOR_VIEW_SELECT`-shaped field set
    (customerName, status, createdAt, party) rather than inventing a separate select.
    Still open: whether Team Lead sees anything beyond that (SSN/bank definitely not;
    unclear if they need more than the Junior view's field set at all) — confirm before
    building.
  - Also gets Get Quotes (M11) and State Sheet (M12) once those exist.
- Nav config, guards (`roleGuard('TEAM_LEAD')`), a new top-level route tree
  `/team-lead` mirroring the existing per-role pattern.
- No login-account creation flow changes needed beyond adding the enum value to the
  Admin "create user" role dropdown.

**Resolved 2026-08-10:** Team Lead gets its own chat channel (`TEAM_LEADS`, Admin also
joins it — same pattern as CLOSERS/JUNIOR_CLOSERS) but is **not** selectable in any
"assign to" dropdown. Read-only oversight, not an org-chart position above Closer/Junior.

---

## ~~M3 — Lead Type: CPL vs CPA + routing~~ (done 2026-08-12)

Two lead types with different pipelines:

- Add `leadType: 'CPL' | 'CPA'` field to Lead (schema, `FIELD_SCHEMA`, client model).
- **CPA** = current pipeline, unchanged (Junior → Closer/Compliance → Admin → Client).
- **CPL** = "form to receive", **skips Closer entirely** — Junior submits, lead goes
  straight to Admin queue (status jump: `NEW` → `SUBMITTED` bypassing Closer
  enrichment). Rest of the state machine (assign/accept/reject/return) is unchanged.
- Junior Closer selects `D1 | D2 | D3 | D4` on intake — **only shown/required when
  `leadType === 'CPL'`**. New enum + field. This is the client's own internal
  classification code for CPL leads (their term, not ours) — treat it as an opaque
  enum to store/filter/display, no business logic hangs off which value is picked.
- Decide: does a CPL lead get the Closer enrichment fields at all (nulled/skipped), or
  does Admin fill them in directly? Confirm before building the Admin CPL page (M3b).

### CPL intake fields (given 2026-08-11)

Notably shorter than the CPA/full Junior intake — no Marital Status, Birth State, Age,
Height, Weight, Source of Income/Retired/Disability, or Annual Income — and adds two
fields CPA doesn't have (**Decision Maker**, **Bank Account**), which supports CPL being
a genuinely distinct, lighter intake rather than a variant of the CPA form. The D1–D4
code from the bullet above wasn't included in this list — still needs confirming
whether it's meant to be captured alongside these or separately.

| Field | Notes |
|---|---|
| Customer's Name | |
| Phone Number | |
| State | |
| Zipcode | |
| Smoker | |
| DOB | mm/dd/yy |
| Need | Dropdown: Burial / Cremation / Leave money |
| Decision Maker | Yes / No — new, not part of the CPA intake |
| Bank Account | Yes / No — new, not part of the CPA intake |
| Notes | free text |

### ~~M3b — Admin CPL dedicated page~~ (done 2026-08-12)
- New admin route/page listing CPL leads only.
- Filters: D1/D2 (the D-code), date range, submitting user (Junior).
- Reuses `createListView()` pattern per CLAUDE.md conventions.

~~**Open question:** for CPL leads, does `status` still move through `RETURNED_TO_CLOSER`
at all, given there's no closer step? Likely no — confirm the return-to-closer action
is hidden/disabled for CPL leads in the Admin queue.~~ — resolved: no, both server- and
client-enforced (see changelog).

---

## M4 — Plan Type & Pricing

- ~~Add `planType: 'LEVEL' | 'GRADED' | 'MODIFIED' | 'GI'` dropdown field to the lead
  (closer/compliance enrichment form, per REQUIREMENTS.md field conventions).~~ —
  **done 2026-08-11**. `Lead.planType` is now a real `PlanType` enum (was free text);
  the Closer enrichment form uses an `app-select` dropdown.
- ~~Client-specific lead cost by plan type... **GI price wasn't given in the example —
  confirm before implementing the price table.**~~ — **done 2026-08-11**. Resolved via
  direct confirmation rather than the client meeting example: four plain nullable `Int`
  columns on `User` (`levelCost`/`gradedCost`/`modifiedCost`/`giCost`), not a separate
  price-table model — plan type is a closed 4-value set, not admin-configurable. Actual
  $ values are admin-entered per client (creation form + editable later, see M9 below),
  not hardcoded anywhere.
- ~~Annual premium~~ — **done 2026-08-14** for the Analytics half. Closer enrichment form
  still shows the Annual premium field as `monthlyPremiums × 12`, display-only, not
  stored on the Lead. Admin → Analytics → Closers now also surfaces it: `GET
  /api/admin/analytics/closers/plans` sums `monthlyPremiums × 12` (USD) per closer over
  the same sold population (`ACCEPTED`/`ASSIGNED_EXTERNAL`) as the PKR per-plan revenue,
  returned as `annualPremiumRevenue` alongside `totalRevenue` — new stat tile + table
  column, kept as a separate USD figure rather than merged into the PKR revenue since the
  two are different currencies. Computed live from current lead data, not persisted.
- ~~Analytics: sales broken down **by plan type**~~ — **done 2026-08-11, Admin-only**.
  New "Sales by plan" section on Admin → Analytics → Closers (`GET
  /api/admin/analytics/closers/plans`): per-closer, per-plan-type lead count + expected
  revenue (count × that client's cost for the plan), for `ACCEPTED`/`ASSIGNED_EXTERNAL`
  leads. **Not visible to Closer(Compliance) directly** — this app has no closer-facing
  self-service analytics page today (analytics pages are all under `/admin`), so "visible
  to Admin and Closer" from this bullet is only half true; revisit if Closer needs its
  own view rather than Admin looking at it. Revenue is *expected* (price × count), not
  money actually collected — `IncomePayment` batches PKR per payment, not per lead/plan,
  so it can't be reconciled against this number. `ASSIGNED_EXTERNAL` leads count toward
  volume but not revenue (no pricing exists for `ExternalClient` yet).

**Dependency:** the per-client price table here is reused by M9 (client management —
"pre-select Plan type lead cost" when creating a client) and M9b (revenue-per-client
analytics). Build the price-table shape with that in mind rather than building it twice.
**M9's "pre-select at creation" half is done — see M9 below.**

---

## M5 — Compliance / Junior portal dashboard & UI cleanup

Grab-bag of dashboard/UI trims — safe to batch as one session, low interdependency:

- ~~Remove the "progress" UI element from both Junior and Compliance dashboards;
  replace with a simple **accepted lead count** stat tile~~ — **done 2026-08-11**.
  Junior dashboard's "Still in progress" tile removed (Accepted tile was already
  present). Compliance(Closer) dashboard never had a "progress" tile and already
  showed Accepted — no change needed there.
- ~~Junior Dashboard: remove the "Where your leads are" status-breakdown box
  entirely~~ — **done 2026-08-11**. "Recent submissions" card now runs full-width;
  unused `pipeline` computed/`PIPELINE` const removed from `dashboard.ts`.
- ~~Compliance portal: add an icon/badge for **pending leads**~~ — **done 2026-08-11**.
  Clarified with the user: dashboard stat tile, not nav/badge. The "Waiting for you"
  tile on `/closer/dashboard` now uses `lucideHourglass` instead of the generic inbox
  icon.
- ~~Remove the **Settings** page from both Junior and Compliance nav/routes~~ — **done
  2026-08-10**, and extended to Team Lead too per direct instruction (not just
  Junior/Compliance as originally scoped here). Nav entries removed in `nav-config.ts`;
  routes in `app.routes.ts` now `redirectTo: 'dashboard'` instead of loading the
  component, so old bookmarks/links land on the dashboard rather than 404ing out to the
  public marketing site. Admin and Client keep Settings unchanged.
- ~~Compliance(Closer) can create a brand-new lead directly, with the info previously
  only Junior submitted — "AI submission."~~ — **done** (found already shipped and wired
  when auditing this doc against the code on 2026-08-14, not dated at build time). New
  `/closer/new-lead` route + "New Lead" nav item on the Closer portal
  (`features/closer/new-lead/`), one combined form covering both the junior-intake and
  closer-enrichment field sets (`FULL_LEAD_FIELDS`), submitted straight to `SUBMITTED`
  (skips `NEW` and the Junior step entirely — resolves this bullet's first open
  question). No separate `source` field was added (resolves the second question): the
  lead's `juniorCloserId` is simply left `null`, the same signal already used to mean
  "no Junior Closer was ever involved" elsewhere in the schema.
- "Hide the information in closer portal / junior" — still not confirmed with the user.
  Likely already satisfied in spirit by the existing role-based field masking (Junior
  never sees phone/SSN/bank; `JUNIOR_VIEW_SELECT`/`CLOSER_HISTORY_SELECT` hide phone once
  a lead leaves `NEW`), but this bullet was explicitly flagged as **too vague to scope as
  written** and was never resolved with a direct answer to "hide *what*, from *which*
  role" — leaving it open rather than assuming the existing masking is what was meant.

---

## ~~M6 — Lead privacy & copy controls~~ (done 2026-08-14)

- ~~**Lead History never shows the phone number**~~ — **done 2026-08-10** for
  Junior/Closer: confirmed by the user this was about the Junior/Closer masked history
  views specifically ("they can steal the information"), not the Client `client-history`
  view (which stays full-detail post-accept, unchanged). `JUNIOR_VIEW_SELECT` and
  `CLOSER_HISTORY_SELECT` in `server/src/services/lead.service.ts` now expose only
  `customerName`, `status`, `createdAt` and the counterparty name — no phone. Client
  model `LeadHistoryRow`, `my-leads` (Junior) and `closer/history` pages updated to
  match (table column removed, modal detail removed, search no longer matches phone).
  Team Lead's future masked view (M2) must use this same field set — noted there.
- ~~Add a **copy** affordance in the lead-detail view~~ — **done 2026-08-14**. Went with
  "copy all" (a single "Copy details" button) rather than per-field, since `shared/
  lead-detail.ts` is one component reused by 7 pages (Admin Leads, Queue, CPL Leads,
  Charge Backs, Closer Drafts, Client Lead History) — a per-field affordance on every
  row would've meant a button next to every `<app-detail>` cell across all of them.
  Text format went through two iterations same day: first shipped as "whatever
  `sections()` shows" (grouped under the same headers as the on-screen view, empty
  fields dropped); the user then gave an exact desired output — a fixed, shorter field
  list/order, grouped by `____________` dividers instead of section headers, with blank
  fields kept as empty lines rather than dropped. `copyDetails()` now hardcodes that
  exact list rather than deriving from `sections()` — it's a curated carrier-submission
  cheat-sheet (customer/beneficiary/health/policy/billing fields only — no state,
  zipcode, need, income, plan type, notes, or status/dates), not a dump of the full
  lead. Still respects the SSN/bank reveal toggle's current state, so it can never
  expose more than the page already shows. No role gating needed: the `Lead` object
  this component receives is already masked server-side per the caller's role.
  Building that exact template surfaced a field the schema didn't have — **Gender** —
  which the user asked to add as a real field rather than leave blank forever; see the
  Gender entry in REQUIREMENTS.md's Implementation Status for the judgment calls made
  (no option list given, so String? + Male/Female placeholder, same pattern as Marital
  Status). New shared field: schema.prisma, FIELD_SCHEMA/SHARED_FIELDS, client
  Lead model, GENDER_OPTIONS, and a dropdown on all three forms that carry shared
  fields (Junior intake, Closer enrichment, Closer new-lead) — not added to CPL intake
  or the Admin queue's quick-edit form, matching how those already exclude several
  other shared fields.
- ~~**Disable copy/paste on the submission forms**~~ — **done** (found already shipped
  when auditing this doc against the code on 2026-08-14, not dated at build time). A
  shared `NoCopy` directive (`shared/no-copy.directive.ts`, `appNoCopy`) blocks
  copy/cut/paste on the form; applied to the Junior intake form
  (`submit-lead.html`), the Closer enrichment form (`enrich-lead.html`), and the
  Closer's own from-scratch intake form (`new-lead.html`, this module's earlier
  "AI submission" bullet).

---

## ~~M7 — Charge back~~ (done 2026-08-11)

- New **Charge Back** page/action: reassign a lead **after** it has already closed
  (i.e. `ACCEPTED` + `paymentStatus: PAID`, or wherever "closed" is defined) back into
  the assignable pool, for the case a client charges back a policy.
- Needs a status/flag to represent "charged back" distinct from the normal
  reject/return flows (those assume the lead never got as far as accepted).
  ~~**Confirm**: is this a new `LeadStatus` value, or a `chargedBack: boolean` flag laid
  over `ACCEPTED`?~~ — resolved: new `LeadStatus.CHARGED_BACK`, per the CLAUDE.md
  state-machine convention.
- **Charge back analytics page**: counts/trends of charged-back leads, likely sliced
  by closer/client/plan similar to existing analytics pages. — shipped, sliced by
  client and by closer (not by plan — see changelog).

---

## ~~M8 — Drafts~~ (done 2026-08-10)

---

## M9 — Client management enhancements

- ~~**Blocked**: "additional fields (which can later be edited) — for Hamza to send."~~
  — **field list received 2026-08-11, mostly shipped** (found already built when
  auditing this doc against the code on 2026-08-14, not dated at build time):

  | Field | Status |
  |---|---|
  | Client Name / Phone / Email | resolved as just restating the existing `User.name`/`phone`/`email` — no new field added |
  | States | **done** — `User.states: String[]`, multi-select toggle list against a fixed US-states list, on both the create form and the account detail modal |
  | Carriers | **done** — `User.carriers: String[]`, free text (not a fixed enum) |
  | Plans | resolved implicitly — a client "accepts" a plan iff its per-plan cost field (M4) is non-null; no separate boolean field was added |
  | Premium Minimum | **still not built** — no field, per-client or per-plan, exists anywhere in the schema |

  Only Premium Minimum remains open on this bullet.
- ~~When creating a Client, **pre-select Plan Type lead cost** — i.e. the per-plan price
  table from M4 gets set up at client-creation time, not edited separately later.~~ —
  **done 2026-08-11, with one deviation**: also editable *after* creation (Admin →
  Clients & Staff → account detail modal → "Lead cost by plan", `PATCH
  /api/users/:id/pricing`), not creation-time-only as this bullet originally specified —
  confirmed directly with the user in the session that shipped it. The four cost fields
  only appear on the create form once role = Client.
- ~~**Analytics: revenue per client**~~ — **done** (found already shipped when auditing
  this doc against the code on 2026-08-14, not dated at build time). Admin → Analytics →
  Clients (`/admin/analytics/clients`, `GET /api/admin/analytics/clients/plans`) —
  `clientPlanAnalytics()` is the per-client cut of the same per-plan revenue model M4
  shipped per-closer; `ASSIGNED_EXTERNAL` leads still don't count here (no `clientId`).
  Admin-only, same as the closer version — whether the Client role should see its own
  revenue was never confirmed, so that stayed out of scope.

---

## M10 — Jornaya integration

- When a Junior Closer submits a lead (either CPA or CPL), integrate with **Jornaya**
  (TCPA lead-consent/compliance verification service) and store the returned Jornaya
  LeadiD linked to the Lead record.
- New field on Lead schema (`jornayaLeadId` or similar).
- Needs Jornaya account credentials/API details from the client before implementation
  — flag as blocked pending that, same as M9's client fields.
- Likely a snippet/token captured client-side during the intake form (Jornaya
  typically works via a JS snippet that tags the browser session, then a server-side
  lookup by token) — research Jornaya's actual integration model before designing the
  schema field, don't assume a single "ID" round-trip.

---

## M11 — Get Quotes page

- New page for **Closer(Compliance) / Admin / Team Lead** — integrates against an
  external quoting API.
- **Blocked** on API details (provider, auth, request/response shape) — ask the user
  which quoting service/API before scoping this module further.

---

## ~~M12 — State Sheet page~~ (done — found already shipped when auditing this doc
against the code on 2026-08-14, not dated at build time)

- New page: lists **states**, and for each state, which **clients** operate there and
  which **services/carriers** are available. `GET /api/users/state-sheet` →
  `userService.listClientCoverage()`, client at `/{closer,admin,team-lead}/state-sheet`.
- Access: Closer(Compliance) / Team Lead / Admin — matches exactly
  (`requireRole('ADMIN', 'CLOSER', 'TEAM_LEAD')`).
- No separate join model was needed — the `states`/`carriers` array columns added to
  `User` for M9's client-fields bullet turned out to be exactly this data, read
  directly rather than through a new `ClientStateCoverage` model.

---

## ~~M13 — Expenses & income tracking~~ (done 2026-08-10)

---

## Changelog

_(move a one-line note here and strike the module heading above when a module ships)_

- **Retention gets State Sheet access** (2026-09-02): confirmed with the user this meant
  specifically the State Sheet reference page (which clients/carriers cover which states),
  not Closer's whole nav — Closer's other pages (New Lead, Inbox, Drafts, Sent Back to Me)
  are tied to the CPA pipeline and don't map onto Retention's shared-queue model (Retention
  drafts already resurface in the shared queue rather than needing a separate page).
  `GET /api/users/state-sheet` now also accepts `RETENTION`; new `/retention/state-sheet`
  route reuses the existing shared `StateSheet` component; nav item added to `RETENTION` in
  `nav-config.ts`.

- **Doc audit against the code** (2026-08-14): the user pasted their own master
  requirements checklist and asked this doc to be reconciled against it. Several items
  turned out to be already built but never marked done here — this doc had drifted from
  the code. Verified against nav-config.ts/app.routes.ts/schema.prisma/actual page
  markup rather than assumed: M6's "disable copy/paste on forms" bullet (a `NoCopy`
  directive already existed on all three lead forms), M5's "AI submission" bullet (Closer
  → New Lead was already live), M9's States/Carriers fields and its revenue-per-client
  analytics bullet (`/admin/analytics/clients`), and all of M12 (State Sheet, fully
  wired for Closer/Team Lead/Admin). All marked done below with what was actually found.
  Two items the user's checklist marked done are **not** actually true yet and need a
  decision, not a doc edit — flagged separately rather than silently resolved: (1) the
  Closer→Compliance rename only ever shipped for the public marketing pages, per an
  explicit 2026-08-10 scope-down in M1 — the authenticated portal (nav, routes, the
  `CLOSER` role itself) still says "Closer" everywhere; (2) "Sales by plan" analytics
  (M4) is Admin-only — Admin can view any closer's numbers, but the Closer role has no
  analytics page of its own to self-serve them, so "show to admin/Closer" is only half
  true. M5's "hide the information in closer/junior portal" bullet also stays open —
  still too vague to confirm it's actually satisfied by the existing masking rather than
  something else.
- **M6 — Copy details button** (2026-08-14): closed M6's copy-affordance bullet.
  `shared/lead-detail.ts` gained a "Copy details" button next to the status badges —
  copies the customer name, status, and every currently-visible section/field as plain
  text via `navigator.clipboard`. Went with one whole-lead button over per-field copying
  since the component is shared by 7 pages; requested specifically for CPL Leads but
  landed in the shared component so it's live everywhere `<app-lead-detail>` is used
  (Admin Leads, Queue, CPL Leads, Charge Backs, Closer Drafts, Client Lead History).
- **M4 — Annual premium in Analytics, currency fix** (2026-08-14): closed M4's last open
  bullet, plus a currency-labeling bug found in the process. Admin → Analytics → Closers
  now shows expected annual premium revenue (`monthlyPremiums × 12`) alongside the
  existing "Sales by plan" revenue — same `ACCEPTED`/`ASSIGNED_EXTERNAL` sold population,
  summed per closer, kept as a separate figure from the per-plan revenue since it's a
  different underlying data source (`closerPlanAnalytics()` returns a new
  `annualPremiumRevenue` field per closer; computed live from `Lead.monthlyPremiums`, not
  persisted). While adding it, found the existing "Sales by plan" revenue was silently
  summing two mismatched currency labels: real `CLIENT` accounts' per-plan lead cost
  (`levelCost`/`gradedCost`/`modifiedCost`/`giCost`) was labeled **$** on Admin → Users,
  but the identically-named fields on `ExternalClient` were labeled **PKR** on Admin →
  External Clients — so a closer with both accepted and externally-assigned leads got a
  revenue total that was literally dollars-plus-rupees. Confirmed with the user: both are
  meant to be USD. Fixed by relabeling External Clients' "Lead cost by plan" hint to $
  (`external-clients.html`) and switching every "Sales by plan" revenue display (Closer
  *and* Client analytics pages — same bug existed on both, `formatPkr` → `formatMoney`)
  plus their description copy. Added a **Currency scope** convention to CLAUDE.md: PKR is
  Expenses-page/`IncomePayment`/`ChargeBack` bookkeeping only, everything lead-pricing-
  related is USD — check that note before adding new money fields or analytics.
- **M3 + M3b** (2026-08-12): CPL lead type shipped end-to-end. New `LeadType`
  (`CPA`/`CPL`) and `DCode` (`D1`-`D4`) enums; `Lead.closerId`/`closer` made nullable
  since a CPL lead never has one. Junior "New Lead" form gained a CPA/CPL toggle — CPL
  shows the shorter confirmed field set (Customer's Name, Phone, State, Zipcode, Smoker,
  DOB, Need, Decision Maker, Bank Account, Notes, D-code) with no closer picker.
  `POST /api/leads/cpl` creates the lead directly at `SUBMITTED` (skips `NEW` and the
  Closer step entirely) — confirmed with the user that a CPL lead **never** acquires
  Closer-enrichment fields, not even via Admin edit (`editLead` sanitizes CPL leads
  against the CPL field set, not `ADMIN_EDIT_FIELDS`). "Return to Closer" is rejected
  server-side (`returnLeadForEdit`) and hidden client-side (Admin Queue's send-back
  modal) for CPL leads — only "Return to Junior" applies. New Admin → **CPL Leads** page
  (`/admin/cpl-leads`, `GET /api/leads/cpl`) filtered by D-code, date range, and
  submitting Junior Closer, built on the Charge Backs page template with Assign/Assign
  External/Send-back-to-Junior actions; Paid/Unpaid and charge-back for a CPL lead are
  handled by the existing Admin → Leads page, not duplicated here. Assign/accept/reject
  and per-closer analytics are otherwise unaffected — CPL leads (`closerId: null`)
  naturally fall out of every closer-keyed grouping; a charged-back CPL lead counts
  toward `byClient` chargeback analytics but not `byCloser`, mirroring the existing
  `ASSIGNED_EXTERNAL`-has-no-pricing precedent. The nullable-`closer` ripple was audited
  and null-guarded across Admin Queue, Admin Leads, Admin Dashboard's closer leaderboard,
  Client "New Leads", and the Charge-back analytics recent-activity table.
- **M7** (2026-08-11): Charge back shipped end-to-end, admin-only, eligible only from
  `ACCEPTED` + `paymentStatus: PAID` (confirmed with the user — a chargeback is money
  coming back after it was actually received, not just any accepted lead). New
  `LeadStatus.CHARGED_BACK` and a `ChargeBack` ledger model (mirrors `IncomePayment`:
  `pkrAmount`, `reason`, `createdAt`) that snapshots the `clientId` at the time, since
  the lead's own `clientId` is cleared for reassignment — this is what lets the
  analytics page report by-client even after the lead moves elsewhere.
  `PATCH /api/leads/:id/charge-back` records the chargeback and resets the lead to
  `paymentStatus: UNPAID` / `closedAt: null` (same fields the existing "revert to
  unpaid" toggle already resets). Admin → Leads gained a "Charge back" action on
  ACCEPTED+PAID rows. New dedicated `GET /api/leads/charge-backs` +
  Admin → Charge Backs page reuse the existing `assignLeadToClient`/
  `assignLeadToExternalClient` service functions (their status guard now also accepts
  `CHARGED_BACK`) rather than duplicating the assign flow — kept as its own page rather
  than folded into the existing Queue (SUBMITTED+REJECTED), since the user asked for it
  as distinct functionality. New `GET /api/admin/analytics/charge-backs` +
  Admin → Analytics → Charge Backs page: totals, by-client and by-closer breakdowns,
  recent-activity table — not sliced by plan type (the original bullet said "likely
  sliced by closer/client/plan"; plan wasn't in the `ChargeBack` model, so only
  client/closer shipped — revisit if plan-level chargeback reporting is wanted).
- **M1** (2026-08-10): Swept "Closer"→"Compliance" and removed "close the policy"
  framing across the 4 public marketing pages (home, about, services, contact) and the
  `public-shell` footer. Portal (`/closer/*`, role enum, nav, dashboards) untouched —
  confirmed out of scope.
- **M6** (2026-08-10, partial): Junior/Closer masked history views no longer return or
  render the phone number — server selects, `LeadHistoryRow` model, `my-leads` and
  `closer/history` pages. Copy-button and disable-copy-on-forms bullets in M6 still open.
- **M2** (2026-08-10): `TEAM_LEAD` role added end-to-end — Prisma enum + seed account,
  `/team-lead` route tree (dashboard, masked Submitted Leads with day/week/month filter,
  reused Junior-Closer/Closer analytics pages, own `TEAM_LEADS` chat channel, Settings),
  Admin "create user" dropdown. Submitted-leads masking mirrors the no-phone
  Junior/Closer view plus both the junior closer and closer who worked the lead. No
  revenue/expense data exposed — `overall` analytics stayed Admin-only.
- **M8** (2026-08-10): Drafts shipped end-to-end. New `DRAFT` LeadStatus + `DraftReason`
  enum (`MISSING_INFO`, `CLIENT_NOT_REACHABLE`, `NEEDS_FOLLOW_UP`, `PENDING_DOCUMENTATION`,
  `OTHER` — a generic starter list, since the client hadn't sent one; rename/extend in
  `lead-fields.ts`/`lead-options.ts`/`lead.model.ts` if theirs differs). A Closer can save
  a draft from a `NEW` lead they're working (reason required) via `PATCH /leads/:id/draft`;
  it's excluded from every other role's queue (closer inbox, admin queue, closer history)
  and lives at `GET /leads/drafts` / `/closer/drafts` — visible and resumable only by the
  owning closer. `enrichAndSubmitLead` now accepts `NEW` or `DRAFT` as the starting status,
  so resuming and submitting reuses the existing enrichment route/form (`enrich-lead.ts`
  gained a "Save as draft" action alongside Submit, plus an `isDraft` header state).
  Drafts analytics is a new Admin-only page (`/admin/analytics/drafts`,
  `GET /admin/analytics/drafts`) — counts/aging per closer and per reason. Not extended to
  Team Lead's oversight scope, matching how `overall` analytics is Admin-only.
- **M5** (2026-08-11, partial): Three of five bullets shipped. Junior dashboard's
  "Still in progress" stat tile removed (Accepted tile already covered the
  replacement ask); Compliance dashboard needed no equivalent change since it never
  had a progress tile. Junior dashboard's "Where your leads are" pipeline
  breakdown card removed entirely, "Recent submissions" now full-width. Compliance
  portal's pending-leads icon request was clarified with the user as the dashboard
  stat tile (not nav/badge) — "Waiting for you" tile now uses `lucideHourglass`.
  Still open: the "AI submission" intake-for-Closer bullet, and the vague
  "hide the information in closer portal / junior" line (needs a follow-up question
  before it can be scoped).
- **M4** (2026-08-11, partial): `Lead.planType` converted from free text to a real
  `PlanType` enum (`LEVEL`/`GRADED`/`MODIFIED`/`GI`), Closer enrichment form now a
  dropdown. Per-client per-plan lead cost added as four nullable `Int` columns on `User`
  (`levelCost`/`gradedCost`/`modifiedCost`/`giCost`) rather than a separate price-table
  model. New Admin-only "Sales by plan" analytics on Analytics → Closers
  (`GET /api/admin/analytics/closers/plans`): count + expected revenue per plan per
  closer, for `ACCEPTED`/`ASSIGNED_EXTERNAL` leads — both count toward revenue,
  `ASSIGNED_EXTERNAL` priced off `ExternalClient`'s own per-plan cost fields (see
  2026-08-14 entry above; `ExternalClient` pricing was mislabeled PKR in the UI at the
  time this note was first written, since corrected to $). Still open: this
  analytics isn't visible to Closer(Compliance) directly (no closer-facing analytics
  page exists in the app today). Existing free-text `planType` values on old/seeded leads were cleared (no migration
  path — `db:push`, not `prisma migrate`), confirmed acceptable since it's dev data.
- **M9** (2026-08-11, partial): Per-client plan pricing (from M4) is now set at client
  creation *and* editable afterward from the account detail modal — confirmed with the
  user as a deliberate deviation from this bullet's original "not edited separately
  later." Revenue-per-client analytics (this module's third bullet) and the blocked
  additional-fields bullet remain open.
- **M13** (2026-08-10): Expenses & income tracking shipped, Admin-only. New `Expense`
  model (description, PKR amount, date) with full CRUD except edit-in-place (add/list/
  delete only, confirmed no edit needed) at `/admin/expenses`. Batch mark-paid lives on
  the admin Leads page instead: checkboxes appear only on `ACCEPTED`/`ASSIGNED_EXTERNAL`
  + `UNPAID` rows, a selection bar exposes "Mark Paid", and confirming asks for **one
  PKR total for the whole batch** (not per lead — matches a single bank transfer/cash
  drop covering several leads) via `PATCH /api/leads/batch-payment`. That PKR figure is
  stored as a new `IncomePayment` record linked to every lead it covered (`Lead.
  incomePaymentId`), created in the same transaction as the `paymentStatus`/`closedAt`
  update. The Expenses page reads both ledgers (`GET /api/expenses`, `GET /api/expenses/
  income`) and shows income/expenses/net as PKR stat tiles — confirmed PKR for expenses
  too, so the net total on that page doesn't mix currencies with the USD lead-cost
  fields elsewhere (coverage amount, premiums, M4's per-plan pricing). The older
  single-lead Paid/Unpaid toggle is untouched and still doesn't record a PKR figure —
  `incomePaymentId` stays null for leads paid that way.
