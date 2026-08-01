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
| `lib/chat-rooms.ts` | **The entire chat access model** — `roomsFor(role)` maps a role to its channels, `canAccessRoom` / `parseRoom` guard every read and write. Change who can see which channel here and nowhere else. |
| `services/chat.service.ts` | Message CRUD, unread counts, read cursors. Re-checks `canAccessRoom` on every operation. |
| `realtime/chat-gateway.ts` | Socket.IO server — JWT handshake auth, role-derived room join, typing relay, broadcast helpers |
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
  auth/                 login, register
  junior-closer/          dashboard, submit-lead (full intake form, conditional Retired/SSDI), my-leads (masked)
  closer/                  dashboard, inbox (list, links out per-lead), enrich-lead (full form at /closer/leads/:id, conditional Payer section), history (masked)
  admin/                    dashboard, queue (assign + edit-on-reject), leads (all, + Paid/Unpaid toggle), users (create + role switch), analytics-junior, analytics-closer, analytics-overall
  client/                    dashboard, assigned-leads ("New Leads", masked preview, accept/reject), lead-history (full detail, accepted only)
  settings/                 ONE shared component, mounted at /{role}/settings in all 4 route trees — password change only
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
- Request body fields are untrusted (`unknown`) until passed through a validator — do not assume `req.body.x` is a string
- Prisma lead transitions use `updateMany` with the expected current status in the `where` clause to prevent double-transition races, then a follow-up `findUnique` to return the full record with relations
- No Stripe, no billing — do not reintroduce
- Chat access rules change in `lib/chat-rooms.ts` only — never by adding a role check in a route, a component, or the socket handler
- No auto-commits unless explicitly asked
