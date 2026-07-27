# The Good Fellas

Lead routing platform with four roles: Junior Closer, Closer, Admin, Client.

```
Junior Closer submits a lead, picks a Closer
  → Closer adds detail, sends to Admin
    → Admin assigns to a Client
      → Client accepts, or rejects back to Admin to edit/reassign
```

Angular client + Express/Prisma/PostgreSQL API. No payments — this is lead routing only.

## Structure
- [`client/`](client) — Angular app
- [`server/`](server) — Express API
- [`REQUIREMENTS.md`](REQUIREMENTS.md) — detailed field-level spec (intake forms, enrichment forms, access rules), still growing
- [`CLAUDE.md`](CLAUDE.md) — architecture reference

## Quick start
```bash
# Server
cd server
cp .env.example .env    # set a real DATABASE_URL
npm install
npm run db:push
npm run db:seed          # creates one login per role, password: Password1
npm run dev               # http://localhost:4000

# Client (separate terminal)
cd client
npm install
npm start                  # http://localhost:4200
```
