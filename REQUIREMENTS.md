# The Good Fellas — Requirements Reference

Living spec captured from the user directly. This is reference material for implementation, not yet fully built — the barebone scaffold currently has simplified placeholder versions of these pages. Update this file as more detail arrives instead of relying on chat history.

Terminology: the role called **"User"** in the user's description is the **`CLIENT`** role in the schema/codebase (matches R4Referral's USER=Client convention).

---

## Roles & Portals

### Admin
Creates Junior Closer and Closer accounts (staff accounts, admin-managed — no self-registration for these roles).

Pages:
- Analytics — Junior Closer performance (accepted vs. rejected leads)
- Analytics — Closer performance
- Overall Analytics
- Settings

**Gap:** no explicit page listed yet for assigning leads to a client, or for the Paid/Unpaid marking described below. Presumably a Leads/Assignment page — not yet detailed. Flagged for follow-up.

### Junior Closer
3 pages:
- **New Lead** — submission form (fields below) + a dropdown to select the Closer this lead routes to
- **My Lead History** — ⚠️ **restricted view: Customer Name and Phone Number ONLY.** Every other field must be hidden. Reason given by user: risk of the junior closer stealing customer information. This is a hard access-control requirement, not a UI simplification — must be enforced server-side (API must not even return the other fields to this role for history views), not just hidden in the UI.
- **Settings** — password reset only

### Closer
3 pages:
- **Assigned Leads** — leads routed to this closer, full detail, where the enrichment form (below) is filled in and submitted onward to Admin
- **Lead History** — "same hiding drill" as Junior Closer's history: restricted fields once a lead has moved on. (Exact restricted field set for the Closer not yet confirmed — assumed Name + Phone only, matching Junior Closer's rule, but should be confirmed before building.)
- **Settings** — password reset

### Client ("User")
3 pages:
- **New Leads** — leads assigned by Admin; Accept or Reject
- **Lead History**
- **Settings**

Additional rule: after a client **accepts** a lead, **Admin** (not the client) has a Paid / Unpaid toggle on that lead to mark it closed. This is a status Admin controls post-acceptance — effectively a new terminal sub-state, not something in the current 5-state schema (`NEW/SUBMITTED/ASSIGNED/ACCEPTED/REJECTED`). Needs a schema addition (e.g. `paymentStatus: PAID | UNPAID` on accepted leads, admin-writable only).

---

## Lead Data — Junior Closer Intake (New Lead form)

| Field | Notes |
|---|---|
| Customer's Name | |
| Marital Status | |
| Phone Number | |
| State | |
| Zipcode | |
| Birth State | |
| Smoker | |
| DOB | mm/dd/yy |
| Age | |
| Height | |
| Weight | |
| Need | Dropdown: Burial / Cremation / Leave money |
| Source of Income | Employed / Self Employed / Retired |
| — if Retired | SSI / SSDI |
| — if SSDI | Nature of Disability |
| Health Conditions | |
| Annual Income | |
| Notes | free text |
| Closer | dropdown — selects which closer this lead routes to |

---

## Lead Data — Closer Enrichment (added on Assigned Leads, then submitted to Admin)

Personal / contact:
| Field | Notes |
|---|---|
| Customer's Name | |
| Marital Status | |
| Phone Number | |
| Mailing Address | |
| State | |
| Zipcode | |
| Email Address | optional |
| Birth State | |
| Yearly Income | |
| Smoker | |
| DOB | mm/dd/yy |
| Age | |
| Height | |
| Weight | |
| Social (SSN) | format `123-00-1234` — 9 digits only |
| DL/State ID # | |
| Doctor's Name | |

Beneficiary:
| Field | Notes |
|---|---|
| Beneficiary Relation | |
| Beneficiary Name | |
| Beneficiary DOB | mm/dd/yy |

Health:
| Field | Notes |
|---|---|
| Health Conditions | |
| Medications | |

Policy:
| Field | Notes |
|---|---|
| Carrier Name | |
| Plan Type | |
| Coverage Amount | |
| Monthly Premiums | |

Billing:
| Field | Notes |
|---|---|
| Initial Draft Date | US calendar date |
| Future Draft Date | US calendar date |
| Payer | Self / Someone Else |

**If Payer = Self:**
| Field | Notes |
|---|---|
| Bank Name | |
| Account Title | |
| Account Type | Checking / Savings |
| Routing Number | 9 digits only |
| Account Number | |

**If Payer = Someone Else:**
| Field | Notes |
|---|---|
| Account Title | |
| Payer's Social | SSN |
| Account Type | Checking / Savings |
| Routing Number | 9 digits only |
| Account Number | |

Closer then submits → lead goes to Admin.

---

## Security Notes (flagged, not yet implemented)

- SSN and bank routing/account numbers are highly sensitive PII/financial data — will need encryption at rest at minimum, and likely masking in any UI that displays them back, plus tight audit logging on who viewed/exported a full lead record.
- The "hide everything except Name/Phone in history" rule is an access-control requirement that must be enforced in the API response shape (server strips fields for that role+view), not just hidden client-side.
- Format validators needed: SSN (9 digits, `xxx-xx-xxxx` pattern), routing number (exactly 9 digits).

---

## Open Questions / Gaps (for follow-up)

1. ~~Closer's "Lead History" restricted field set~~ — resolved: Name + Phone only, same as Junior Closer. Implemented.
2. ~~Admin's Paid/Unpaid toggle~~ — resolved: it's a secondary flag on an ACCEPTED lead (`paymentStatus: UNPAID | PAID`), independent of the main status. Marking PAID stamps `closedAt` and the lead is treated as closed; reverting to UNPAID clears it. Implemented on Admin → Leads.
3. More details still to come per the user ("there is some more but I'll provide that later").

---

## Implementation Status (first full pass)

Everything above is now built — schema, API, and Angular forms. Notes on judgment calls made along the way, since they weren't specified and are easy to revisit:

- **Junior Closer masking is role-wide, not just the History page.** Any lead the API returns to a JUNIOR_CLOSER — list or single — is capped to `{ customerName, phone, status, createdAt, closer }`, for any lead at any time. Simpler and safer than trying to special-case "only on the history view."
- **Closer masking is state-based.** While a lead is `NEW` (still theirs to work), the Closer API returns full detail. Once they've submitted it (any other status), it's masked the same way as Junior Closer's view. This is what lets "Assigned Leads" show everything but "Lead History" show almost nothing.
- **Client-side masking on ASSIGNED leads was added beyond what was explicitly requested**, mirroring R4Referral's "masked until accepted" pattern — given the field set now includes SSN and bank account/routing numbers, sending that to a client before they've committed felt like an unacceptable default. A client's "New Leads" page only gets `{ customerName, state, zipcode, need, maritalStatus, status, closer }` until they accept; full detail (including SSN/bank info) is only returned once `status = ACCEPTED`. Flag if this isn't wanted.
- **Analytics ("accepted vs rejected") reflect current lead status, not history.** There's no event/audit log yet, so a lead that was rejected once, reassigned, and later accepted only counts toward "accepted" — the earlier rejection isn't separately tracked. Worth a real audit table later if rejection *frequency* matters, not just current outcome.
- **Marital Status** has no defined option list in the spec — implemented as a plain select with Single/Married/Divorced/Widowed as a placeholder set.
- **Height** is free text (e.g. `5'10"`), **Weight** is a plain number (lbs) — no format was specified.
- **Income fields** (`annualIncome`, `yearlyIncome`, `coverageAmount`, `monthlyPremiums`) are stored as whole-dollar integers, not cents — this project has no payment processor requiring cents precision, unlike R4Referral.
- **DOB / Beneficiary DOB / Draft Dates** are stored as real `DateTime` values (not raw `mm/dd/yy` strings) and formatted for display — safer than free-text dates, same information.
- **SSN and Payer's Social** accept `123-00-1234` or 9 raw digits and are normalized to the dashed format; **Routing Number** must be exactly 9 digits. These are shape checks (format only), not fraud/validity checks.
- **Admin can edit any field** (not just name/phone) on a REJECTED lead before reassigning, since "edit" in the original ask wasn't scoped to specific fields.

---

## UI Pass — per-page functionality (added after the first build)

The first pass built every page but left them as bare tables. This pass brought each page up to the level of
functionality R4Referral's equivalents have. None of it changed the API or the masking rules.

**Shared behaviour on every list page** — free-text search, status filter pills that double as a count
breakdown, sortable columns, pagination, loading skeletons, distinct "no data" vs "no match" empty states,
and a click-through detail modal. All derived **client-side** from the existing endpoints via
`core/list-view.ts` (see CLAUDE.md) — no new query params, no new routes.

| Page | Functionality added |
|---|---|
| Admin → Leads | 6 stat tiles, search, filter by closer, status pills, sort by name/status/date, detail modal, inline Paid/Unpaid toggle that patches in place instead of refetching |
| Admin → Queue | Stats, search, Submitted/Rejected pills, **assign modal** with client search + selectable list, **edit modal** for rejected leads (name, phone, state, zip, marital, health, notes) surfacing the client's rejection reason, detail modal |
| Admin → Clients & Staff | Role stat tiles, search, role filter pills, sortable, **create-account modal**, **account detail modal with role switcher + explicit confirmation** warning that the person gets signed out; changing your own role is blocked |
| Admin → Analytics (Junior/Closer) | Now one shared `OutcomeAnalytics` component: team totals, accept-rate metric, accepted-vs-rejected bar chart of the busiest 8, searchable + sortable table with a per-person accept/reject split meter |
| Admin → Analytics (Overall) | Metric cards incl. **accept rate** and **collection rate**, status bar chart, status table with plain-English explanations and share-of-total, account breakdown |
| Closer → Assigned Leads | Stats incl. an **ageing count** (3+ days waiting), search, per-row stale flag, intake preview modal showing the junior closer's notes |
| Closer → Lead History | Stats incl. accept rate, search, status pills, masked detail modal that states *why* the view is restricted |
| Closer → Complete Lead | Sectioned form (Personal / Health / Beneficiary / Policy / Billing / Notes), intake recap header, **live completeness meter**, conditional Self vs Someone-Else bank section, inline required-field validation, sticky submit bar |
| Junior → New Lead | Sectioned form, **closer picked from avatar cards** rather than a bare `<select>`, inline validation with a "still needed" list, sticky submit bar |
| Junior → My Lead History | Stats incl. accept rate, search, status pills, masked detail modal |
| Client → New Leads | Stats, search, explicit locked-preview banner, preview modal, **reject modal that collects a reason** (previously an untitled inline text box) |
| Client → Lead History | Stats incl. total coverage, search, Open/Closed pills, sortable by coverage, full detail modal |
| All four dashboards | Greeting, 5–6 stat tiles, **pipeline funnel**, recent-activity feed, quick-action tiles. Closer's shows oldest-waiting leads first; Client's shows offers awaiting a decision |
| Settings | Account card, **live password-requirement checklist**, mismatch validation, explicit warning that changing the password signs you out |

**PII display masking** — `app-lead-detail` masks SSN, payer SSN, routing and account numbers behind a
"Reveal" toggle wherever a full lead is shown. This is presentation only; the API-level masking in
`lead.service.ts` is still the real access-control boundary.

**Not added, deliberately:** a profile-edit tab in Settings. R4Referral has one, but this spec scopes
Settings to "password reset only", so name/email stay admin-managed.

---

## Team Chat (added after the UI pass)

As specified by the user: two groups, **Closers** and **Junior Closers**. Admin interacts with both;
a Junior Closer sees only the Junior Closer chat; a Closer sees only theirs; each group reaches Admin
through its own group channel.

| Channel | Who is in it |
|---|---|
| Closers | every CLOSER + every ADMIN |
| Junior Closers | every JUNIOR_CLOSER + every ADMIN |

The two groups cannot see each other. Only Admin holds both, and Admin gets a channel switcher; the
single-channel roles get no switcher at all.

Confirmed in scope for v1: live send/receive, scrollback history, **unread badge** in the sidebar,
**typing indicator**, and **edit/delete your own message**. File and image attachments were considered
and left out — no file storage exists in this project yet.

### Judgment calls made (not specified, easy to revisit)

- **CLIENT has no chat.** The user described chat for Closers, Junior Closers and Admin only. Clients
  are external to the org, so they get no nav item, an empty room list, and the websocket refuses their
  connection. Flag if clients were meant to have a support channel with admin.
- **Channels are group chats, not DMs.** "Both can interact with admin via their Group" was read as
  literally one shared room per group — every Closer sees every other Closer's messages to Admin. If
  the intent was private Closer↔Admin threads, that's a different (larger) model: per-pair conversations
  rather than two rooms.
- **Membership is derived from role, not stored.** Promote a Junior Closer to Closer and their channel
  changes on next login — there is no per-user membership to migrate. Their old messages stay in the
  Junior Closers channel, attributed to them.
- **Admin can delete anyone's message but cannot edit anyone's.** Moderation without being able to put
  words in someone's mouth. Deletes are soft — the row is tombstoned and shows as "This message was
  deleted" rather than vanishing from the timeline.
- **No message retention limit or export.** Messages persist indefinitely. Given the PII sensitivity
  noted elsewhere in this file, a retention policy is probably worth deciding on — nothing stops staff
  pasting a customer's SSN into a channel, and there is no audit log of who read what.
- **History is unrestricted within a channel.** Unlike leads, chat has no masking rule — a new Closer
  can scroll back through everything said in the Closers channel before they joined. Say so if that
  should be capped to messages sent after their account was created.
