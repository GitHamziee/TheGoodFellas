# The Good Fellas — Lead Routing Platform

## Project Overview
4-role lead routing platform (Angular + Node/Express), an insurance-style final-expense lead pipeline. Modeled on the architecture of a prior project (R4Referral/CallPro — see `C:\Users\ossam\source\repos\Diary\CallPro`): thin routes/controllers, business logic isolated in services, role-based access enforced at both the route layer and the client route-matching layer.

**[REQUIREMENTS.md](REQUIREMENTS.md) is the living field-level spec** — full Junior Closer intake fields, Closer enrichment fields, masking rules, and an "Implementation Status" section documenting judgment calls made where the spec didn't say (marital status options, money as whole dollars not cents, SSN/routing formats, etc). Read it before touching lead fields — more detail is still coming from the user and gets appended there, not re-derived from chat history.

## Tech Stack
- **Client**: Angular 21 (standalone components, signals, `CanMatch` guards, functional HTTP interceptor)
- **Server**: Express + TypeScript, thin routes → services pattern
- **ORM**: Prisma 6 → PostgreSQL
- **Auth**: JWT (custom, not a library) — role + `tokenVersion` embedded in token, `tokenVersion` bump invalidates old tokens on password/role change
- **No Stripe / billing** — explicitly out of scope for this project

## Repo Layout
```
TheGoodFellas/
├── client/     Angular app
├── server/     Express API
└── REQUIREMENTS.md   living field-level spec, not fully implemented yet
```

## Commands
```bash
# Server
cd server
npm run dev          # tsx watch, localhost:4000
npm run build         # prisma generate && tsc
npm run db:push        # push schema.prisma to DATABASE_URL, no migrations
npm run db:seed         # seeds one user per role (password: Password1)
npm run db:studio        # Prisma Studio GUI

# Client
cd client
npm start             # ng serve, localhost:4200
npm run build          # ng build
```

Copy `server/.env.example` to `server/.env` and set a real `DATABASE_URL` before running the server against a real database.

---

## Roles & Lead Flow

Four roles: `JUNIOR_CLOSER`, `CLOSER`, `ADMIN`, `CLIENT` (UI-facing label "User" is CLIENT — see REQUIREMENTS.md).

```
JUNIOR_CLOSER submits lead, picks a CLOSER  →  status NEW
CLOSER adds info, submits to admin           →  status SUBMITTED
ADMIN assigns to a CLIENT                     →  status ASSIGNED
CLIENT accepts                                 →  status ACCEPTED
CLIENT rejects → back to ADMIN (edit/reassign)  →  status REJECTED → ASSIGNED (on reassign)
```

After ACCEPTED, Admin can toggle `paymentStatus: UNPAID | PAID` independently of the main status (`PATCH /api/leads/:id/payment-status`). Marking PAID stamps `closedAt`; the lead is then considered closed. This does not gate any workflow transition — it's a secondary admin-only flag.

Self-registration (`/api/auth/register`) always creates a `CLIENT` account. `JUNIOR_CLOSER`, `CLOSER`, and additional `ADMIN` accounts are created by an existing Admin via `POST /api/users`.

---

## Server — `server/src/`

Convention: **routes are thin** (parse request, call service, map result to HTTP status) — **all business logic lives in `services/`**. Every async route handler is wrapped in `asyncHandler` (`lib/async-handler.ts`) so a thrown/rejected error reaches Express's error middleware instead of crashing the process — Express 4 does not do this automatically.

| Path | Purpose |
|---|---|
| `middleware/auth.ts` | `authenticate` (verifies JWT + tokenVersion against DB), `requireRole(...roles)` |
| `services/auth.service.ts` | register (CLIENT only), login, admin-created staff accounts, change password |
| `services/lead.service.ts` | All lead state transitions **and all response-shape masking** — see below |
| `services/user.service.ts` | Closer/client lookups for dropdowns, admin user management |
| `services/analytics.service.ts` | Per-junior-closer and per-closer accepted/rejected counts, overall totals — all derived from *current* lead status, no audit log |
| `routes/*.routes.ts` | HTTP layer only |
| `lib/validation.ts` | `isNonEmptyString`, `isValidEmail`, `isValidPassword` |
| `lib/lead-fields.ts` | The ~50-field Lead schema is validated generically here, not with hand-written per-field checks. `FIELD_SCHEMA` maps each field name → `{ type, enumValues? }`; `sanitizeLeadFields(body, allowedKeys)` picks only the allowed keys, type-checks/coerces each (string/int/boolean/date/ssn/routing), and normalizes SSNs to `xxx-xx-xxxx`. `SHARED_FIELDS` / `JUNIOR_ONLY_FIELDS` / `CLOSER_ONLY_FIELDS` compose into `JUNIOR_INTAKE_FIELDS`, `CLOSER_ENRICHMENT_FIELDS`, `ADMIN_EDIT_FIELDS` — the allowlists each route passes in. Add a new lead field here, not by editing every service function. |

### Masking — enforced in `lead.service.ts`, not the client
Three different Prisma `select` fragments, chosen per role/status combination:
- `FULL_INCLUDE` — everything. Used by ADMIN always; by CLOSER while a lead is still `NEW` (theirs to work); by CLIENT once `ACCEPTED`.
- `JUNIOR_VIEW_SELECT` — `{ customerName, phone, status, createdAt, closer }` only. Used for **every** JUNIOR_CLOSER read, list or single, regardless of lead status — the requirement was about the risk of a junior closer stealing customer data, so it's a role-wide rule, not a "history page only" rule.
- `CLOSER_HISTORY_SELECT` — same shape as the junior view (plus `client` instead of `closer`). Used for CLOSER reads once a lead has moved past `NEW`.
- `CLIENT_PREVIEW_SELECT` — `{ customerName, state, zipcode, need, maritalStatus, status, createdAt, closer }`. Used for CLIENT reads while `status = ASSIGNED` (not yet accepted) — added beyond the original ask, because the field set now includes SSN and bank/routing numbers and sending that pre-acceptance seemed like the wrong default. Flag if unwanted.

`getLeadById(id, requester)` is the single chokepoint that picks the right select based on `requester.role` + the lead's current status — this is the real access-control boundary, not the list endpoints (which use the same selects but don't need the branching since the route already pins the role).

### API Routes
| Route | Method | Role | Purpose |
|---|---|---|---|
| `/api/auth/register` | POST | public | Create CLIENT account |
| `/api/auth/login` | POST | public | |
| `/api/auth/me` | GET | any | |
| `/api/auth/change-password` | POST | any | Bumps tokenVersion — invalidates current token, client must re-login |
| `/api/users` | GET/POST | ADMIN | List/create staff+client accounts (Admin creates Junior Closer / Closer accounts here) |
| `/api/users/:id/role` | PATCH | ADMIN | Role switch (bumps tokenVersion) |
| `/api/users/closers` | GET | JUNIOR_CLOSER, ADMIN | Dropdown source |
| `/api/users/clients` | GET | ADMIN | Dropdown source |
| `/api/leads` | POST | JUNIOR_CLOSER | Submit lead (full intake field set) |
| `/api/leads/mine` | GET | JUNIOR_CLOSER | Masked history |
| `/api/leads/inbox` | GET | CLOSER | NEW leads assigned to this closer, full detail |
| `/api/leads/:id/enrich` | PATCH | CLOSER | NEW → SUBMITTED, full enrichment field set |
| `/api/leads/closer-history` | GET | CLOSER | Masked — leads no longer `NEW` |
| `/api/leads/queue` | GET | ADMIN | SUBMITTED + REJECTED |
| `/api/leads/all` | GET | ADMIN | |
| `/api/leads/:id/assign` | PATCH | ADMIN | → ASSIGNED |
| `/api/leads/:id` | PATCH/GET | ADMIN / any (ownership+masking enforced) | Edit only permitted while REJECTED, any field |
| `/api/leads/:id/payment-status` | PATCH | ADMIN | ACCEPTED only — `{ paymentStatus: 'PAID' \| 'UNPAID' }`, stamps/clears `closedAt` |
| `/api/leads/assigned` | GET | CLIENT | "New Leads" — ASSIGNED, masked preview |
| `/api/leads/client-history` | GET | CLIENT | "Lead History" — ACCEPTED, full detail |
| `/api/leads/:id/accept` | PATCH | CLIENT | ASSIGNED → ACCEPTED |
| `/api/leads/:id/reject` | PATCH | CLIENT | ASSIGNED → REJECTED, clears clientId |
| `/api/admin/analytics/junior-closers` | GET | ADMIN | Per-junior-closer total/accepted/rejected |
| `/api/admin/analytics/closers` | GET | ADMIN | Per-closer total/accepted/rejected |
| `/api/admin/analytics/overall` | GET | ADMIN | Totals, status breakdown, closed/unpaid counts, role counts |

`GET /api/leads/:id` is shared across all roles but enforces ownership + masking inside `lead.service.ts#getLeadById` — this was a real bug caught and fixed during the first scaffolding pass (any authenticated user could originally fetch any lead by ID), not a design given.

---

## Client — `client/src/app/`

```
core/
  models/            AppUser, Lead (full), LeadHistoryRow (masked), LeadPreview (client pre-accept masked), Role, LeadStatus, PaymentStatus
  services/          AuthService, LeadService, UserService, AnalyticsService — HTTP only, no state beyond auth
  guards/            authGuard, roleGuard(...roles) — both CanMatch, block lazy chunk loading before it downloads
  interceptors/       authInterceptor — attaches Bearer token, logs out on 401
  nav-config.ts        NAV_BY_ROLE — one nav array per role, no flag-filtering of a shared list
  lead-fields.ts (options)  Dropdown option lists (Need, IncomeSource, RetiredIncomeType, AccountType, PayerType)
layout/
  portal-shell/        ONE shared shell (sidebar+topbar) reused by all 4 role trees; dark variant via [class.shell--dark] when role===ADMIN
features/
  auth/                 login, register
  junior-closer/          dashboard, submit-lead (full intake form, conditional Retired/SSDI), my-leads (masked)
  closer/                  dashboard, inbox (list, links out per-lead), enrich-lead (full form at /closer/leads/:id, conditional Payer section), history (masked)
  admin/                    dashboard, queue (assign + edit-on-reject), leads (all, + Paid/Unpaid toggle), users (create + role switch), analytics-junior, analytics-closer, analytics-overall
  client/                    dashboard, assigned-leads ("New Leads", masked preview, accept/reject), lead-history (full detail, accepted only)
  settings/                 ONE shared component, mounted at /{role}/settings in all 4 route trees — password change only
```

The Closer's enrichment form (~30 fields across Personal/Beneficiary/Health/Policy/Billing sections) lives on its own route (`/closer/leads/:id`) rather than inline in the inbox list — too large to embed per-row usefully. `EnrichLead` loads the lead via `getLead(id)`, pre-fills the fields Junior Closer already set (shared fields), and lets the Closer fill in the rest before submitting.

Routing: `app.routes.ts` has one lazy-loaded top-level route per role (`/junior`, `/closer`, `/admin`, `/client`), each gated by `canMatch: [authGuard, roleGuard('ROLE')]` and rendering `PortalShell` as the parent with feature pages as children. This avoids R4Referral's pattern of one shared URL (`/dashboard`) branching three ways internally — each role gets its own URL space.

State/fetching lives in `core/services/`; feature components call the service and hold local UI state in signals only — no separate state library, matches R4Referral's "hooks own state, pages render" convention adapted to Angular.

---

## Conventions
- Business logic in services (server) / core services (client) — never in routes or components
- The `Lead` model is one wide table (~50 nullable fields) rather than normalized sub-tables (Beneficiary, BankAccount, Policy as separate models) — matches R4Referral precedent and keeps the status-transition queries simple. Revisit if the field count keeps growing.
- Adding a new Lead field: add it to `prisma/schema.prisma`, add its type to `FIELD_SCHEMA` in `server/src/lib/lead-fields.ts`, add the key to whichever of `SHARED_FIELDS`/`JUNIOR_ONLY_FIELDS`/`CLOSER_ONLY_FIELDS` it belongs to, then mirror the type on the client in `core/models/lead.model.ts`. Update whichever masked `*_SELECT` fragments in `lead.service.ts` should or shouldn't include it.
- API responses: `{ data, message? }` on success, `{ error }` on failure — checked via `'error' in result` in routes
- Every route handler wrapped in `asyncHandler`; global error middleware in `app.ts` is the last-resort net
- Request body fields are untrusted (`unknown`) until passed through a validator — do not assume `req.body.x` is a string
- Prisma lead transitions use `updateMany` with the expected current status in the `where` clause to prevent double-transition races, then a follow-up `findUnique` to return the full record with relations
- No Stripe, no billing — do not reintroduce
- No auto-commits unless explicitly asked
