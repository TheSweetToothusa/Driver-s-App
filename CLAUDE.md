# Sweet Tooth Driver App — Claude Agent Briefing

Read this entire file before doing anything. It contains everything you need to work on this project.

---

## Store Info (NEVER GET THIS WRONG)

- **Store Name:** The Sweet Tooth — Chocolate Factory
- **Address:** 18435 NE 19th Ave, North Miami Beach, FL 33179
- **Phone:** (305) 682-1400
- **Hours:** Mon–Fri: 10 AM – 5 PM · Same-day cutoff: 2 PM

---

## What This Is

The **Sweet Tooth Driver App** is a React 19 + TypeScript delivery management PWA used by drivers and admins at The Sweet Tooth, a chocolate gift delivery business in Miami. It connects to Shopify for order data.

**Live URL:** https://driver-s-app.onrender.com  
**GitHub:** https://github.com/TheSweetToothusa/Driver-s-App  
**Render Service ID:** srv-d6ngbv14tr6s73c4jkq0

---

## How to Clone & Push (DO THIS FIRST, EVERY SESSION)

```bash
# Check if already cloned
ls /tmp/Driver-s-App 2>/dev/null && cd /tmp/Driver-s-App && git pull && echo "READY" || echo "NEED TO CLONE"
```

**If not cloned yet** — the token is in Claude's project memory.  
Look in memory for: `Sweet Tooth Driver App GitHub token` — it has the full clone command.  
It looks like:
```bash
git clone https://TOKEN@github.com/TheSweetToothusa/Driver-s-App.git /tmp/Driver-s-App
```

Once cloned, a `.env.claude` file (gitignored) lives in the repo root with the token for future reference:
```bash
cat /tmp/Driver-s-App/.env.claude
# GH_TOKEN=...
# CLONE_CMD=...
```

**To push changes:**
```bash
cd /tmp/Driver-s-App
git add -A
git commit -m "describe what you changed"
git push origin main
```

**After pushing:** Tell Mikey to go to Render Dashboard → Manual Deploy → Deploy Latest Commit.

---

## Key People

- **Mikey** — Owner, SUPER_ADMIN, PIN: 1979
- **Katie** — Manager/Driver, MANAGER role, PIN: 4070, phone: 3059944070

---

## Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS, Vite 6 — `App.tsx` (~2500 lines)
- **Backend:** Express 5, Node.js — `server.ts`
- **Database:** PostgreSQL via Render, `kv_store` table (key/value)
- **Shopify:** Orders pulled via `services/shopifyService.ts`
- **Email:** SendGrid (`orders@thesweettooth.com`)
- **Hosting:** Render (not free tier — no spin-down)

## Key Files

```
App.tsx                          # Entire frontend — all components in one file
server.ts                        # Express backend + all API routes
services/shopifyService.ts       # Shopify order fetching + mapping
types.ts                         # TypeScript interfaces
users.json                       # Fallback only — real data is in PostgreSQL
```

---

## Hard Rules (NEVER violate these)

- Never use the word "payroll" — always say "delivery fees"
- Never say "rate" — always say "fee"
- The DELIVERED button requires a photo before it becomes active
- Never show "FAILED" status unless an actual failure occurred
- Never add call/text buttons without confirming UX with Mikey first
- Phone numbers must be tapped to reveal — never shown by default
- No one-tap calling (pocket dial risk) — calling requires a reveal step
- Recipient and Gift Sender names must be extremely large, bold, black
- Order number must always be sticky at the top
- DONE button stays grey until delivery confirmed, then turns green "DELIVERED"
- All orders default to Katie as driver — never show "Not Assigned"
- **Lionwheel** is the UX benchmark — match its patterns

---

## Architecture Notes

### Database
- All persistent data lives in **PostgreSQL** via `kv_store` table
- Render's filesystem resets on every deploy — never write critical data to files only
- `getKV(key)` / `setKV(key, value)` — helper functions in server.ts
- `readUsersDB()` / `writeUsers()` — user management (writeUsers is async — always await it)

### Default Driver
- All unassigned orders automatically assign to Katie (`manager_1`)
- Set via `/api/config/default-driver` endpoint
- Frontend falls back to `{ driverId: 'manager_1', driverName: 'Katie' }` if not configured

### Shopify Data Mapping
```
Recipient name:  shipping.first_name + last_name
Recipient phone: shipping.phone
Gift Sender name: buyer.first_name + last_name
Gift Sender phone: buyer.phone || billing.phone
Gift Sender email: buyer.email
Address street:  shipping.address1
Address unit:    shipping.address2
Address company: shipping.company
Driver ID:       order._st_driverId  (from st_driver: Shopify tag)
Driver Name:     order._st_driverName (from st_drivername: Shopify tag)
Status:          order._st_status (from st_status: Shopify tag)
```

### React Rules — Critical
- **Never place hooks after early returns or inside conditionals** — this causes blank screens
- Check every edit to App.tsx for hooks violations before pushing
- Run `npx tsc --noEmit` to check for TypeScript errors before pushing

---

## API Routes (server.ts)

```
POST /api/auth/login              # PIN login
GET  /api/users                   # All users
POST /api/users                   # Add driver
PATCH /api/users/:id              # Update user
POST /api/users/:id/reset-pin     # Change PIN
GET  /api/orders                  # Fetch from Shopify
PATCH /api/orders/:id/assign      # Assign driver
PATCH /api/orders/:id/status      # Update status
POST /api/orders/:id/note         # Add admin note
PATCH /api/orders/:id/edit        # Edit order fields
POST /api/pod                     # Save proof of delivery
POST /api/reschedule/auto         # Auto-reschedule failed delivery
GET  /api/config/default-driver   # Get default driver
POST /api/config/default-driver   # Set default driver
GET  /api/templates               # SMS templates
PATCH /api/templates/:id          # Edit SMS template
POST /api/notify/preview          # Preview notification email
POST /api/notify                  # Send notification email
```

---

## Deployment Checklist

Before every push:
1. `npx tsc --noEmit` — fix any TypeScript errors (ignore the `@types/node` warning)
2. Check for React hooks violations in any edited components
3. `git add -A && git commit -m "..." && git push origin main`
4. Tell Mikey: "Deploy via Render Dashboard → Manual Deploy → Deploy Latest Commit"

---

## Current Known Issues / Pending Work

- Waze navigation not integrated yet (Google Maps works)
- Push notifications to drivers not implemented
- Delivery date parsing mismatches possible in shopifyService.ts
- All orders should auto-assign to default driver (Katie) — if "Not Assigned" appears, check `/api/config/default-driver`

---

## DO NOT

- Do not ask Mikey for the GitHub token — it's in the git remote already
- Do not try to set up SSH keys or new auth — the HTTPS token works
- Do not use `npm run build` to test — use `npx tsc --noEmit`
- Do not write user data only to the filesystem — always use the DB
- Do not make UX changes without confirming with Mikey first
- Do not add features not requested — surgical changes only
