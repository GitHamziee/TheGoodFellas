# The Good Fellas — Lead Routing Platform

## Project Overview
4-role lead routing platform (Angular + Node/Express), an insurance-style final-expense lead pipeline. Modeled on the architecture of a prior project (R4Referral/CallPro — see `C:\Users\ossam\source\repos\Diary\CallPro`): thin routes/controllers, business logic isolated in services, role-based access enforced at both the route layer and the client route-matching layer.

**[REQUIREMENTS.md](REQUIREMENTS.md) is the living field-level spec** — full Junior Closer intake fields, Closer enrichment fields, masking rules, and an "Implementation Status" section documenting judgment calls made where the spec didn't say (marital status options, money as whole dollars not cents, SSN/routing formats, etc). Read it before touching lead fields — more detail is still coming from the user and gets appended there, not re-derived from chat history.

## Tech Stack
- **Client**: Angular 21 (standalone components, signals, `CanMatch` guards, functional HTTP interceptor)
- **Server**: Express + TypeScript, thin routes → services pattern
- **Realtime**: Socket.IO 4 (chat only) — shares the HTTP server, so `index.ts` uses `createServer(app)` not `app.listen`
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
npm test                 # vitest — test/*.test.ts (field sanitizing, getLeadById masking, payment guards, Manager scope)
npm run lint             # eslint src test

# Client
cd client
npm start             # ng serve, localhost:4200
npm run build          # ng build
npm test               # ng test (vitest) — *.spec.ts next to the code
npm run lint           # ng lint (angular-eslint)
npm run format         # prettier
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

From its own queue (`SUBMITTED` / `REJECTED`) the Admin can also send a lead **back for
correction** to whichever role entered the bad data:

```
ADMIN sends back → RETURNED_TO_JUNIOR → junior fixes intake     → SUBMITTED
ADMIN sends back → RETURNED_TO_CLOSER → closer fixes enrichment → SUBMITTED
```

From the same queue, Admin can instead hand a lead to an **External Client** — an
outside party tracked for bookkeeping only, with no login (`ExternalClient` is not a
`User`, has no password/role). This is a separate action from "assign to client" and
the two never share a dropdown: `ASSIGNED` = offered to a real `CLIENT` account awaiting
accept/reject; `ASSIGNED_EXTERNAL` = handed off, terminal, no further workflow step.
Admin manages the `ExternalClient` roster at `/admin/external-clients` and can still
toggle `paymentStatus` on an `ASSIGNED_EXTERNAL` lead exactly like an `ACCEPTED` one.

Both resubmit straight to `SUBMITTED` rather than re-walking the pipeline — the other
role's work is still valid and the admin is the one waiting. `returnReason` carries what
needs fixing and is cleared on resubmit. This is the one case where a **Junior Closer sees
more than name + phone**: `JUNIOR_EDIT_SELECT` exposes only the intake fields they typed
themselves, never closer-added SSN/bank/beneficiary data, and only while the lead sits in
`RETURNED_TO_JUNIOR`.

After ACCEPTED, `paymentStatus: UNPAID | PAID` is independent of the main status and does not gate any workflow transition — it's a secondary admin-only flag. The two directions are asymmetric on purpose: marking a lead PAID **only** happens through `PATCH /api/leads/batch-payment` (even for a single lead), because that's the one path that requires entering the PKR amount received and creates the matching `IncomePayment` row. `PATCH /api/leads/:id/payment-status` only accepts `{ paymentStatus: 'UNPAID' }` — it exists solely to undo a mistaken PAID, clearing `closedAt`; it rejects `'PAID'` outright so a quick-toggle can never mark a lead paid without recording income.

There is no self-registration. Every account — `CLIENT` included — is created by an existing Admin via `POST /api/users`, role picked from a dropdown at creation time. There is likewise no self-service "forgot password" flow; a locked-out account is recovered by an Admin via `PATCH /api/users/:id/reset-password`, which sets the password directly (no current-password check) and bumps `tokenVersion` to force re-login, same as a role change. The login page just tells the user to contact their admin.

---

## Server — `server/src/`

Convention: **routes are thin** (parse request, call service, map result to HTTP status) — **all business logic lives in `services/`**. Every async route handler is wrapped in `asyncHandler` (`lib/async-handler.ts`) so a thrown/rejected error reaches Express's error middleware instead of crashing the process — Express 4 does not do this automatically.

| Path | Purpose |
|---|---|
| `middleware/auth.ts` | `authenticate` (verifies JWT + tokenVersion against DB), `requireRole(...roles)` |
| `services/auth.service.ts` | login, admin-created accounts (any role), self-service change-password, admin-driven reset-password |
| `services/lead.service.ts` | All lead state transitions **and all response-shape masking** — see below |
| `services/user.service.ts` | Closer/client lookups for dropdowns, admin user management |
| `services/analytics.service.ts` | Per-junior-closer and per-closer accepted/rejected counts, overall totals — all derived from *current* lead status, no audit log |
| `routes/*.routes.ts` | HTTP layer only |
| `lib/validation.ts` | `isNonEmptyString`, `isValidEmail`, `isValidPassword` |
| `lib/service-result.ts` | The one `ServiceResult<T>` every service returns — don't redeclare it per service |
| `lib/api-response.ts` | `apiSuccess` / `apiError`, plus `sendResult(res, result, message?, status?)` which maps a `ServiceResult` onto either — use it instead of hand-writing `if ('error' in result) return apiError(...)` |
| `lib/chat-rooms.ts` | **The entire chat access model** — `roomsFor(role)` maps a role to its channels, `canAccessRoom` / `parseRoom` guard every read and write. Change who can see which channel here and nowhere else. |
| `services/chat.service.ts` | Message CRUD, unread counts, read cursors. Re-checks `canAccessRoom` on every operation. |
| `realtime/chat-gateway.ts` | Socket.IO server — JWT handshake auth, role-derived room join, typing relay, broadcast helpers |
| `lib/lead-fields.ts` | The ~50-field Lead schema is validated generically here, not with hand-written per-field checks. `FIELD_SCHEMA` maps each field name → `{ type, enumValues? }`; `sanitizeLeadFields(body, allowedKeys)` picks only the allowed keys, type-checks/coerces each (string/int/boolean/date/ssn/routing), and normalizes SSNs to `xxx-xx-xxxx`. `SHARED_FIELDS` / `JUNIOR_ONLY_FIELDS` / `CLOSER_ONLY_FIELDS` compose into `JUNIOR_INTAKE_FIELDS`, `CLOSER_ENRICHMENT_FIELDS`, `ADMIN_EDIT_FIELDS` — the allowlists each route passes in. Add a new lead field here, not by editing every service function. |

### Masking — enforced in `lead.service.ts`, not the client
Three different Prisma `select` fragments, chosen per role/status combination:
- `FULL_INCLUDE` — everything. Used by ADMIN always; by CLOSER while a lead is still `NEW` (theirs to work); by CLIENT once `ACCEPTED`.
- `JUNIOR_VIEW_SELECT` — `{ customerName, status, createdAt, closer }` only, phone deliberately excluded. Used for **every** JUNIOR_CLOSER read, list or single, regardless of lead status — the requirement was about the risk of a junior closer stealing customer data (phone number included), so it's a role-wide rule, not a "history page only" rule.
- `CLOSER_HISTORY_SELECT` — same shape as the junior view (plus `client` instead of `closer`). Used for CLOSER reads once a lead has moved past `NEW`.
- CLIENT reads while `status = ASSIGNED` get the **full** lead (`FULL_INCLUDE`), not a masked preview — the client can correct an offered lead via `PATCH /:id/client-edit` before deciding, which needs every field. (An earlier `CLIENT_PREVIEW_SELECT` was never wired up and has been removed.)

`getLeadById(id, requester)` is the single chokepoint that picks the right select based on `requester.role` + the lead's current status — this is the real access-control boundary, not the list endpoints (which use the same selects but don't need the branching since the route already pins the role).

### API Routes
| Route | Method | Role | Purpose |
|---|---|---|---|
| `/api/auth/login` | POST | public | No `/register` — see the no-self-registration note above |
| `/api/auth/me` | GET | any | |
| `/api/auth/change-password` | POST | ADMIN, MANAGER | Bumps tokenVersion — invalidates current token, client must re-login. Every other role has no self-service password change; an Admin resets their password via `PATCH /api/users/:id/reset-password` instead |
| `/api/users` | GET/POST | ADMIN | List/create any account, role included (Admin creates every account here, Client included) |
| `/api/users/:id/role` | PATCH | ADMIN | Role switch (bumps tokenVersion) |
| `/api/users/:id/reset-password` | PATCH | ADMIN | `{ newPassword }` — sets it directly, no current-password check, bumps tokenVersion |
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
| `/api/leads/:id/assign-external` | PATCH | ADMIN | → ASSIGNED_EXTERNAL, `{ externalClientId }` |
| `/api/leads/:id` | PATCH/GET | ADMIN / any (ownership+masking enforced) | Edit only permitted while REJECTED, any field |
| `/api/leads/:id/payment-status` | PATCH | ADMIN | ACCEPTED/ASSIGNED_EXTERNAL only — `{ paymentStatus: 'UNPAID' }` **only**, reverts a mistaken PAID and clears `closedAt`; rejects `'PAID'` |
| `/api/leads/:id/admin-status` | PATCH | ADMIN, MANAGER | `{ adminStatus }` — tracking label (`CLIENT_PAID`, `CLIENT_UNPAID`, `APPROVAL_CONFIRMED`, `UNDERWRITING_REVIEW`, `APPROVED`, `DECLINED`, or `null` to clear). Any lead, any type, any workflow status; independent of `status`/`paymentStatus` and never gates a transition |
| `/api/leads/batch-payment` | PATCH | ADMIN | `{ leadIds, pkrAmount, note? }` — the only path to PAID, one or many leads; one PKR total for the batch; creates an `IncomePayment`, ineligible ids silently skipped |
| `/api/leads/:id/return` | PATCH | ADMIN | SUBMITTED/REJECTED only — `{ target: 'JUNIOR_CLOSER' \| 'CLOSER', reason }` |
| `/api/leads/returned/mine` | GET | JUNIOR_CLOSER | Leads sent back to them — intake fields only |
| `/api/leads/:id/resubmit-intake` | PATCH | JUNIOR_CLOSER | RETURNED_TO_JUNIOR → SUBMITTED |
| `/api/leads/returned/closer` | GET | CLOSER | Leads sent back to them, full detail |
| `/api/leads/:id/resubmit-enrichment` | PATCH | CLOSER | RETURNED_TO_CLOSER → SUBMITTED |
| `/api/leads/assigned` | GET | CLIENT | "New Leads" — ASSIGNED, full detail (see masking note above) |
| `/api/leads/client-history` | GET | CLIENT | "Lead History" — ACCEPTED, full detail |
| `/api/leads/batch-decision` | PATCH | ADMIN, MANAGER | `{ leadIds, decision: 'ACCEPT' \| 'REJECT', reason? }` — admin records the client's decision for many leads at once (select-then-act, like batch-payment). Covers `ASSIGNED` (CLIENT account) **and** `ASSIGNED_EXTERNAL` (no login, so admin is the only way to decide). ACCEPT → ACCEPTED keeping the client/externalClient; REJECT → REJECTED clearing both; ineligible ids silently skipped |
| `/api/leads/retention/batch-assign` | PATCH | ADMIN, MANAGER | `{ leadIds, retentionId }` — hands many unworked (RETENTION + `NEW`) leads to one Retention person; ineligible ids silently skipped; one summary notification to that person |
| `/api/leads/retention/lifecycle` | GET | ADMIN, MANAGER | Retention History list — one summary row per RETENTION lead (creation, closer, months on book, charge-back date, who worked/reassigned/retained). No PKR figures. (`/retention/history` is the Retention role's own page) |
| `/api/leads/retention/lifecycle/:id` | GET | ADMIN, MANAGER | Same summary plus the ordered lifecycle timeline |
| `/api/leads/:id/accept` | PATCH | CLIENT | ASSIGNED → ACCEPTED |
| `/api/leads/:id/reject` | PATCH | CLIENT | ASSIGNED → REJECTED, clears clientId |
| `/api/external-clients` | GET/POST | ADMIN | List/create external clients (no login) |
| `/api/external-clients/:id` | PATCH | ADMIN | Edit an external client |
| `/api/expenses` | GET/POST | ADMIN | List/add PKR expense entries (description, amount, date) |
| `/api/expenses/:id` | DELETE | ADMIN | No edit-in-place — delete and re-add to correct a mistake |
| `/api/expenses/income` | GET | ADMIN | Read-only list of `IncomePayment` records — write path is `/api/leads/batch-payment` above |
| `/api/admin/analytics/junior-closers` | GET | ADMIN | Per-junior-closer total/accepted/rejected |
| `/api/admin/analytics/closers` | GET | ADMIN | Per-closer total/accepted/rejected |
| `/api/admin/analytics/overall` | GET | ADMIN | Totals, status breakdown, closed/unpaid counts, role counts |
| `/api/chat/rooms` | GET | any | Channels the caller may open + unread counts (CLIENT gets `[]`) |
| `/api/chat/:room/messages` | GET | room members | History, newest-first page returned oldest-first; `?before=<id>&limit=` |
| `/api/chat/:room/messages` | POST | room members | Send — persists, then broadcasts over the socket |
| `/api/chat/messages/:id` | PATCH | author | Edit own message |
| `/api/chat/messages/:id` | DELETE | author or ADMIN | Soft-delete (tombstone) |
| `/api/chat/:room/read` | POST | room members | Move the read cursor, clearing the unread badge |

`GET /api/leads/:id` is shared across all roles but enforces ownership + masking inside `lead.service.ts#getLeadById` — this was a real bug caught and fixed during the first scaffolding pass (any authenticated user could originally fetch any lead by ID), not a design given.

---

## Team Chat

Two group channels, membership derived from role — there is no per-user membership table and no way for a client to ask to join a room:

| Channel | Members |
|---|---|
| `CLOSERS` | all CLOSER accounts + all ADMIN accounts |
| `JUNIOR_CLOSERS` | all JUNIOR_CLOSER accounts + all ADMIN accounts |

A Closer sees only the Closers channel, a Junior Closer only the Junior Closers channel, and each group reaches Admin *through its own channel* — the two groups never see each other. **CLIENT has no chat at all**: `roomsFor('CLIENT')` returns `[]`, `/api/chat/rooms` returns an empty list, and the websocket refuses the connection outright rather than holding an idle socket open.

`lib/chat-rooms.ts` is the chokepoint, the same way `getLeadById` is for lead masking. Every REST read/write and the socket's room assignment go through it. The client mirrors the map in `core/models/chat.model.ts` **only to decide what to render** — it is not the boundary.

### Transport split — writes over HTTP, fan-out over the socket
Sending, editing and deleting are ordinary REST calls, so they reuse `authenticate`, the `{ data } / { error }` contract and real status codes. The route then calls `emitMessageCreated` / `emitMessageUpdated` to broadcast what it just persisted. The socket carries no authority of its own and never writes to the DB — the only thing a client may emit is `chat:typing`, which is relayed, never stored.

The sender therefore receives its own message twice (POST response + broadcast). `ChatService#upsert` is keyed on message id so the second arrival replaces rather than duplicates — this also makes reconnect replay harmless.

### Socket auth
The browser cannot set an `Authorization` header on a websocket handshake, so the JWT rides in `socket.handshake.auth.token`. `io.use()` verifies it **and re-checks `tokenVersion` against the DB**, exactly like `middleware/auth.ts` — so a role change or password reset kills live sockets too, not just REST calls.

Rooms are joined server-side from `roomsFor(user.role)` on connect. A Junior Closer cannot subscribe to `CLOSERS` by editing the request, because the request never names a room.

### Deletion is soft
`ChatMessage.deletedAt` tombstones the row; the body is dropped server-side in `publicMessage()` and the client renders "This message was deleted". Authors delete their own; ADMIN can delete anyone's in a channel they belong to. **Editing is author-only even for admins** — an admin can remove a message but never rewrite someone's words.

### Scaling caveat
Broadcast is in-process (single Socket.IO server, in-memory adapter). Running more than one Node instance would need the Redis adapter or Postgres `LISTEN/NOTIFY` — same category of caveat as the in-memory list filtering.

---

## Client — `client/src/app/`

```
core/
  models/            AppUser, Lead (full), LeadHistoryRow (masked), LeadPreview (client pre-accept masked), Role, LeadStatus, PaymentStatus, ChatMessage/ChatRoomKey
  services/          AuthService, LeadService, UserService, AnalyticsService — HTTP only, no state beyond auth
                     ChatService is the one exception: it owns the socket + live message state (see below)
  guards/            authGuard, roleGuard(...roles) — both CanMatch, block lazy chunk loading before it downloads
  interceptors/       authInterceptor — attaches Bearer token, logs out on 401
  nav-config.ts        NAV_BY_ROLE — one nav array per role + a NavIcon key per item, no flag-filtering of a shared list
  lead-options.ts       Dropdown option lists (Need, IncomeSource, RetiredIncomeType, AccountType, PayerType)
  format-utils.ts        timeAgo / formatDate / formatMoney / humanizeEnum / getInitials / getAvatarTone / maskSsn / maskAccount / isToday / isThisMonth
  list-view.ts            createListView() — signal-based search + status filter + sort + pagination over an already-loaded array (see below)
shared/
  ui/modal.ts          <app-modal> — backdrop, Escape-to-close, projected body + [footer] slot with a built-in Close button
  ui/ui.ts              StatTile, EmptyState, SkeletonRows, SearchBox, Pagination, StatusBadge, PaymentBadge, Detail — small presentational components, inline templates
  lead-detail.ts         <app-lead-detail> — full sectioned read-only view of a Lead, hides empty sections, masks SSN/routing/account behind a reveal toggle
layout/
  portal-shell/        ONE shared shell for all 4 roles — black/gold sidebar with @lucide/angular icons, slim topbar showing the active page title, off-canvas drawer below 880px
features/
  auth/                 login only — no self-registration, see the no-self-registration note above
  junior-closer/          dashboard, submit-lead (full intake form, conditional Retired/SSDI), my-leads (masked), returned ("Re-Writes")
  closer/                  dashboard, inbox (list, links out per-lead), enrich-lead (full form at /closer/leads/:id, conditional Payer section), history (masked), returned ("Re-Writes")
  admin/                    dashboard, leads + cpl-leads (a "Needs your action" card on top — SUBMITTED/REJECTED, any day — then a day-by-day log driven by `shared/ui/day-bar.ts`, defaulting to today; the old Queue page is gone, `/admin/queue` redirects to `/admin/leads`), users (create + role switch), analytics-junior, analytics-closer, analytics-overall
  client/                    dashboard, assigned-leads ("New Leads", full detail, accept/reject), lead-history (full detail, accepted only)
  settings/                 ONE shared component, password change only — mounted only at /admin/settings and /manager/settings; every other role's `settings` path redirects to its dashboard/landing page and the nav omits the link, since self-service password change is ADMIN/MANAGER only
  chat/                      ONE shared component, mounted at /{junior,closer,admin}/chat — NOT in the client tree
```

### ChatService is deliberately stateful
Every other core service is HTTP-only with state held in the feature component. `ChatService` breaks that on purpose: the socket has to outlive the chat page so the sidebar unread badge keeps updating while you're on another page, so it is `providedIn: 'root'` and holds the message/room/typing signals itself.

Consequences worth knowing:
- An `effect()` on `auth.user()` ties socket lifetime to the session — it covers login, logout, and the interceptor's forced logout on 401, so no caller has to remember to disconnect.
- The chat page calls `closeRoom()` in `ngOnDestroy`. Without it the room stays "active" after you navigate away and incoming messages get marked read instead of raising the badge.
- The app is **zoneless**, so socket callbacks write into signals — that is what schedules change detection. Do not add `ApplicationRef.tick()`; if a socket update doesn't render, the state it wrote isn't a signal.

The Closer's enrichment form (~30 fields across Personal/Beneficiary/Health/Policy/Billing sections) lives on its own route (`/closer/leads/:id`) rather than inline in the inbox list — too large to embed per-row usefully. `EnrichLead` loads the lead via `getLead(id)`, pre-fills the fields Junior Closer already set (shared fields), and lets the Closer fill in the rest before submitting.

Routing: `app.routes.ts` has one lazy-loaded top-level route per role (`/junior`, `/closer`, `/admin`, `/client`), each gated by `canMatch: [authGuard, roleGuard('ROLE')]` and rendering `PortalShell` as the parent with feature pages as children. This avoids R4Referral's pattern of one shared URL (`/dashboard`) branching three ways internally — each role gets its own URL space.

State/fetching lives in `core/services/`; feature components call the service and hold local UI state in signals only — no separate state library, matches R4Referral's "hooks own state, pages render" convention adapted to Angular.

### List pages — search / filter / sort / pagination are client-side
Every list page (Admin Leads, Queue, Users; Closer Inbox, History; Junior My Leads; Client New Leads, Lead History) uses `createListView()` from `core/list-view.ts`: it takes the loaded array as a signal plus a `searchFields` extractor, an optional `statusOf`, and a `sorters` map, and returns signals for `rows` (current page), `total`, `totalPages`, `isFiltered`, plus `setSearch` / `setStatus` / `toggleSort`. **This filters in memory rather than adding query params to the endpoints** — the datasets are one team's pipeline, so it avoids plumbing pagination through every route. Move server-side if volume grows; the component API wouldn't have to change much.

Per-page stat tiles are likewise `computed()` over the same loaded array, not a separate stats endpoint.

### Styling
`features/shared-page.css` is registered as a **global** stylesheet in `angular.json` — not a per-component `styleUrl`. That's deliberate: Angular's emulated encapsulation would otherwise stop those classes reaching inside shared child components (`app-modal`, `app-stat-tile`, `app-lead-detail`), and 18 components importing the same file duplicated it in the bundle. Component-specific CSS still lives in that component's own `styles`/`styleUrl`. Add new shared vocabulary to `shared-page.css`, not inline `style=` attributes.

### Icons
`@lucide/angular` (NOT the deprecated `lucide-angular`). This version exports **only per-icon standalone components with attribute selectors** — `LucideLayoutDashboard` renders as `<svg lucideLayoutDashboard></svg>`. There is no generic `<lucide-icon name="...">`, and `ngComponentOutlet` won't work with attribute-selector components. To render an icon from a string key (e.g. `NavItem.icon`), import the specific components and `@switch` in the template. Some familiar names don't exist in this version — check `node_modules/@lucide/angular/types/lucide-angular.d.ts` before using one. Notably: `CircleCheck` not `CheckCircle`, `CircleX` not `XCircle`, `CircleAlert` not `AlertCircle`, `ChartColumn` not `BarChart3`, `Clock` (there is no `History`), and no `Filter`.

---

## Conventions
- Business logic in services (server) / core services (client) — never in routes or components
- The `Lead` model is one wide table (~50 nullable fields) rather than normalized sub-tables (Beneficiary, BankAccount, Policy as separate models) — matches R4Referral precedent and keeps the status-transition queries simple. Revisit if the field count keeps growing.
- Adding a new Lead field: add it to `prisma/schema.prisma`, add its type to `FIELD_SCHEMA` in `server/src/lib/lead-fields.ts`, add the key to whichever of `SHARED_FIELDS`/`JUNIOR_ONLY_FIELDS`/`CLOSER_ONLY_FIELDS` it belongs to, then mirror the type on the client in `core/models/lead.model.ts`. Update whichever masked `*_SELECT` fragments in `lead.service.ts` should or shouldn't include it.
- API responses: `{ data, message? }` on success, `{ error }` on failure — checked via `'error' in result` in routes
- Every route handler wrapped in `asyncHandler`; global error middleware in `app.ts` is the last-resort net
- Money-recording writes (`batchMarkPaid`, `markLeadChargedBack`, `batchChargeBack`) run the status-guarded `updateMany` **first** inside an interactive transaction (`runGuardedTransaction`) and abort with 409 if it moved fewer leads than expected — only then create the `IncomePayment` / `ChargeBack` rows. Keep that order for any new write that records money
- Manager lead scope (`leads.routes.ts`) is enforced by `router.param('id')` for `:id` routes plus a body check for `leadIds` batches — `req.params` is empty inside a plain `router.use`, so don't move the check back there
- Client: `core/api.ts` has the shared `ApiSuccess<T>` and `apiErrorMessage(err, fallback)` — use it in `catch` blocks instead of `err?.error?.error ?? ...`
- Request body fields are untrusted (`unknown`) until passed through a validator — do not assume `req.body.x` is a string
- Prisma lead transitions use `updateMany` with the expected current status in the `where` clause to prevent double-transition races, then a follow-up `findUnique` to return the full record with relations
- No Stripe, no billing — do not reintroduce
- Chat access rules change in `lib/chat-rooms.ts` only — never by adding a role check in a route, a component, or the socket handler
- No auto-commits unless explicitly asked
- **Currency scope: PKR is Expenses-page bookkeeping only** — `Expense.amount`, `IncomePayment.pkrAmount` (written via `/api/leads/batch-payment`), and `ChargeBack.pkrAmount`. Every other money field — lead fields (`coverageAmount`, `monthlyPremiums`, `annualIncome`, `yearlyIncome`), the per-plan client/external-client pricing (`levelCost`/`gradedCost`/`modifiedCost`/`giCost`), and anything derived from them (e.g. Analytics' `annualPremiumRevenue`) — is USD (`formatMoney`), not PKR (`formatPkr`). Don't mix the two formatters or sum across them.
- **PKR amounts are ADMIN-only, no exceptions.** `FULL_INCLUDE` omits `chargeBacks[].pkrAmount`; only `ADMIN_FULL_INCLUDE` (picked via `adminInclude(viewer)` / the ADMIN branch of `getLeadById`) carries it, and `chargeBackAnalytics('MANAGER')` strips every PKR field. Never send a stored PKR amount to MANAGER or any other role.

---

## Notifications
Per-user inbox + live toasts for "something happened to you" (lead received, sent back, assigned, accepted/rejected). `Notification` table (`userId`, `kind` success/info/warning/danger, `title`, `message`, `link`, `readAt`). Server: `services/notification.service.ts` — `notifyUsers(ids, input)` / `notifyRoles(roles, input)` persist then push `notification:new` to the private socket room `user:<id>` (joined in `chat-gateway.ts`). They are **best-effort and fire-and-forget** (`void notifyX(...)`, errors swallowed) so a notification failure never fails a lead transition. `page` is a key into `PAGE_PATHS`, resolving the destination route per *recipient role* — add a new target there. Triggers live in `lead.service.ts` next to each transition. Routes: `GET /api/notifications`, `PATCH /api/notifications/read-all`, `PATCH /api/notifications/:id/read` (own rows only). Client: `NotificationService` (root, stateful like ChatService) rides `LiveUpdatesService.notifications$` — no extra socket; `shared/ui/notifications.ts` has `<app-toast-host>` (top-right stack, hover pauses) and `<app-notification-bell>` (topbar), both mounted in `PortalShell`. Messages carry only customer name, never other lead fields.

## Retention History
Admin/Manager page at `/{admin,manager}/retention-history` (client `features/admin/retention-history/`), server `services/retention-history.service.ts`. Lifecycle comes from the `LeadEvent` audit table (written best-effort via `recordRetentionEvents` in `services/lead-event.service.ts`, RETENTION leads only, next to each transition in `lead.service.ts`) merged with `Lead` timestamps and `ChargeBack` rows. Charge-backs are deliberately not an event type — `ChargeBack` stays the source of truth. Leads that predate `LeadEvent` have no events, so their timeline falls back to created / paid (`IncomePayment.createdAt`) / charged back and their "who worked it" falls back to the current `retentionId`. Definitions: time on book = whole months first-paid → first charge-back (or today while active); RETAINED = charged back at least once and now ACCEPTED/ASSIGNED_EXTERNAL again; retained-by = last retention person to submit it. New transitions that touch a retention lead should add a `recordRetentionEvents` call.

## Live Data Refresh
Any successful non-GET `/api` write (except `/chat`, `/auth`) triggers a payload-free `data:changed` Socket.IO broadcast (middleware in `app.ts` → `emitDataChanged()` in `chat-gateway.ts`). It carries no data, so masking is unaffected. Client: `LiveUpdatesService` (own socket, debounced) exposes a `version` signal; list/dashboard/analytics components call `reloadOnChange(() => this.refresh())` as a field initializer and refetch **only their own data**. Loaders guard their skeleton with `if (!isSilentReload()) this.loading.set(true)` so updates land in place. Form pages (submit/enrich/edit) are deliberately excluded. A CLIENT socket now connects (no chat rooms) for this purpose.

## Zoom Phone Dialer (Retention only)
Zoom Phone **Smart Embed** iframe (`applications.zoom.us/integration/phone/embeddablephone/home`); each agent signs in with their own licensed Zoom account inside it, and nothing Zoom-side touches the server. `shared/ui/zoom-dialer.ts` is mounted in `PortalShell` for RETENTION only and is hidden, never destroyed, when minimized, so a live call survives navigation (that's why it isn't a routed page). `ZoomPhoneService` (root, stateful) sends `zp-make-call` via `postMessage` to the Zoom origin and queues a dial requested before the iframe loads. The iframe src **must** carry `?originDomain=<window.location.origin>`: Zoom only accepts `postMessage` from that origin (falling back to `document.referrer`, which turns into a Zoom URL after the in-frame sign-in, silently dropping every dial). The origin must be HTTPS and listed in the Smart Embed app's Approved Domains (Marketplace → app → Manage → Configure app); `http://localhost` is rejected, so local dev runs `ng serve --ssl` with `CLIENT_ORIGIN=https://localhost:4200`. "Dial lead" buttons are on the Retention lead page (dials the current phone field) and on pending queue rows (fetches the lead via `getLead` and sends the number straight to the dialer — the masked list never renders it). Numbers are converted to E.164 (`toE164`, US only).

## Deployment
Hostinger VPS (Ubuntu 26.04), live at `https://thegoodfellasbpo.com` (DNS in the same Hostinger account; `www`, the old `187-127-115-225.sslip.io` hostname and the bare IP all 301 to it). **Every push to `main` goes live within ~1 minute**: a systemd timer on the VPS (`goodfellas-autodeploy.timer`) runs `~/auto-deploy.sh` as `deploy` every 60s, which compares `origin/main` to the checkout and, if it moved, runs `~/deploy.sh` (pull, `npm ci` + build both apps, `prisma db push`, `pm2 reload goodfellas-api`), logging to `~/deploy.log`. It is pull-based on purpose — Hostinger drops inbound SSH from GitHub Actions runners, so `.github/workflows/deploy.yml` is disabled and unused. Caddy (`/etc/caddy/Caddyfile`) serves `client/dist/client/browser` and proxies `/api` + `/socket.io` to `:4000`; Postgres 17 runs in Docker (`goodfellas-db`, bound to 127.0.0.1); nightly `goodfellas-backup` cron writes DB dumps + `uploads/` to `/root/backups` (14 days). Production has no seeded accounts — never run `db:seed` there (its password is public).
