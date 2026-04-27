# INFRASTRUCTURE.md — The Sweet Tooth Driver's App

**Read this BEFORE anything else when something is broken.** This document tells you exactly which service hosts what, what dashboard to log into, and what error means what. Every Claude session, every developer, anyone trying to fix this app: start here.

Last updated: April 27, 2026

---

## THE STACK AT A GLANCE

| What it does | Service | Where you log in |
|---|---|---|
| **App hosting** (the running website) | Render | https://dashboard.render.com |
| **Database** (orders, POD records, drivers, history) | **Neon** *(NOT Render Postgres)* | https://console.neon.tech |
| **Photo storage** (POD photos) | Cloudflare R2 | https://dash.cloudflare.com |
| **Order data source** (real orders) | Shopify Admin API | https://admin.shopify.com |
| **Email sending** (POD confirmations) | **Gmail SMTP via Nodemailer** *(NOT SendGrid)* | https://mail.google.com |
| **Address geocoding** (turn addresses into map pins) | Geoapify | https://myprojects.geoapify.com |
| **Code repository** | GitHub | https://github.com/TheSweetToothusa/Driver-s-App |
| **AI development** | Claude Code, Claude.ai | — |

**Important:** Render hosts the APP. The DATABASE is on Neon. These are two different companies. Do NOT assume Render has the database just because the app is on Render.

---

## SERVICE-BY-SERVICE DETAIL

### 1. Render — App Hosting

- **What it does:** Runs the `driver-s-app.onrender.com` website 24/7
- **Auto-deploys:** Every push to `main` branch on GitHub deploys automatically. No manual step.
- **Live URL:** https://driver-s-app.onrender.com
- **Service name on Render:** `Driver-s-App`
- **Workspace:** `Michael's workspace`
- **Login:** Mikey's account
- **Plan:** Standard (paid)
- **Where logs are:** Render dashboard → Driver-s-App → **Logs** (left sidebar)
- **When it breaks:**
  - 503 errors = Render is restarting the app, wait 60 seconds
  - 502 / "Bad Gateway" = the Node.js process crashed; check Logs for the crash reason
  - White screen = the build failed; check Render → Driver-s-App → **Events** for deploy errors

### 2. Neon — Database (PostgreSQL)

- **What it does:** Stores all POD records, driver data, history, message templates
- **Database name in code:** `sweet-tooth-db-v2` *(but Neon project is named "Sweet Tooth Drivers App")*
- **Connection:** Via `DATABASE_URL` env var on Render → points to `*.neon.tech`
- **Live URL:** https://console.neon.tech
- **Login:** Sign in with **GitHub (TheSweetToothusa account)**
- **Project name:** `Sweet Tooth Drivers App`
- **Region:** AWS US East 1 (N. Virginia)
- **Plan:** **Launch ($19/month + usage)** — upgraded April 27, 2026
  - 100 GB data transfer included
  - Free limits removed
- **Why Neon and not Render:** Render's old database was named `sweet-tooth-db` and was broken. We migrated to Neon for `sweet-tooth-db-v2`. The old `render.yaml` still mentions Render Postgres but the live env var overrides it to point to Neon.
- **When it breaks:**
  - Error: `"Your project has exceeded the data transfer quota"` → **Neon Free tier hit. Upgrade plan in Neon dashboard.** This is exactly what happened on April 27, 2026.
  - Error: `ECONNREFUSED` → Neon is down or DATABASE_URL is wrong; check status.neon.tech
  - Error: `XX000` Postgres code → almost always Neon-specific (quota, connection limit)
  - **Slow queries** → Check Neon dashboard → Monitoring; Free/Launch plans suspend the DB after 5 min idle (cold starts add ~1-3 sec)

### 3. Cloudflare R2 — Photo Storage

- **What it does:** Stores POD photos as `.jpg` files. The database only stores the photo's filename (key), not the photo itself.
- **Bucket name:** `sweet-tooth-pod-photos`
- **Live URL:** https://dash.cloudflare.com
- **Login:** Mikey's Cloudflare account
- **File pattern:** `photos/YYYY-MM-DD/ORDERNUMBER.jpg` (e.g., `photos/2026-04-27/35416.jpg`)
- **When it breaks:**
  - Photos don't display → check R2 bucket exists, check API credentials in Render env vars
  - Upload fails → app falls back to storing photo as base64 in the database (much slower, but works)
- **NEVER call this "R2" when talking to Mikey. Always say "Cloudflare."**

### 4. Shopify — Order Data Source

- **What it does:** The actual store. Every real order comes from here. The app reads orders, then writes back tags when delivered.
- **Store URL:** https://thesweettoothfl.myshopify.com
- **Admin URL:** https://admin.shopify.com
- **API version:** 2025-01 (set in `server.ts`)
- **Auth:** Private app via `SHOPIFY_ACCESS_TOKEN` env var on Render
- **Tags written by the app:**
  - `st_status:DELIVERED` (or `FAILED`)
  - `st_completed:2026-04-27T19-30-00.000Z`
  - `st_driver:manager_1`
  - `st_drivername:Katie`
- **Critical:** Manual orders (created in the app, not from Shopify) have IDs starting with `manual_` and skip Shopify entirely.
- **When it breaks:**
  - 401 errors = `SHOPIFY_ACCESS_TOKEN` expired or wrong; regenerate in Shopify admin → Apps → Your app
  - Missing data = check `note_attributes` and `fulfillment_orders[0].delivery_method.additional_information.instructions` (where Bird stores delivery info)

### 5. Gmail SMTP — Email Sending

- **What it does:** Sends POD confirmation emails to customers
- **From address:** `orders@thesweettooth.com`
- **BCC on every email:** `orders@thesweettooth.com` AND `raiver72@gmail.com`
- **Method:** Nodemailer using `smtp.gmail.com:587` with an **App Password**
- **Env vars on Render:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- **`SENDGRID_API_KEY` env var:** LEFT OVER FROM OLD CODE. Not actually used. We migrated off SendGrid when its free tier ran out. Variable name is misleading.
- **Where to see what was sent:** Hit `https://driver-s-app.onrender.com/api/email-log` OR check the BCC inbox
- **When it breaks:**
  - "Maximum credits exceeded" → that was SendGrid, no longer relevant
  - "Authentication failed" → Gmail App Password expired; generate new one at https://myaccount.google.com/apppasswords
  - "Less secure apps blocked" → Gmail Workspace admin must enable App Passwords
  - 2-Step Verification must be ON for the orders@thesweettooth.com Google account, otherwise App Passwords don't exist

### 6. Geoapify — Geocoding

- **What it does:** Converts shipping addresses to GPS coordinates so the map sorting works
- **Login:** https://myprojects.geoapify.com
- **API Key:** `c721dbc68297447e9fa57a0cc401b6db` (also hardcoded as default in server.ts)
- **Plan:** Free tier (3,000 requests/day, no credit card)
- **When it breaks:** Free tier reset is daily. If addresses don't sort, you've likely hit the daily cap; either upgrade or wait 24 hours.

### 7. GitHub — Source Code

- **Repo:** https://github.com/TheSweetToothusa/Driver-s-App
- **Branch:** `main` (only branch that matters; pushes to main auto-deploy to Render)
- **Clone command for Claude sessions:**
  ```
  git clone https://github.com/TheSweetToothusa/Driver-s-App.git
  ```
  *(For private clones, the GitHub Personal Access Token is stored in Mikey's notes — never commit it to the repo.)*
- **Architecture:** Single `App.tsx` (frontend) + single `server.ts` (backend). If you see `shopifyService.ts` or `types.ts` as separate files, you have OLD CODE. Re-clone.

---

## "WHEN SOMETHING BREAKS" — DEBUG ORDER

When Mikey says "the app is broken," follow this exact order. Do not skip steps. Do not theorize.

### Step 1: Run the debug endpoint
```
curl https://driver-s-app.onrender.com/api/debug/pod-check/35412
```

What the result tells you:
- Returns clean JSON with order data → app and database are alive. Problem is elsewhere (frontend, Shopify, etc).
- Returns JSON with `__dbError: true` and `"Your project has exceeded the data transfer quota"` → **NEON QUOTA EXCEEDED**. Go to Neon dashboard, upgrade plan.
- Returns `ECONNREFUSED` or DNS errors → Render is down OR DATABASE_URL is broken
- Returns 503 / 502 → Render app is restarting or crashed; check Render logs

### Step 2: Check Render logs
https://dashboard.render.com → Driver-s-App → **Logs** (left sidebar)

Look for the most recent error. Errors usually contain the exact provider name (`neon.tech`, `cloudflarestorage.com`, `myshopify.com`, etc.) which tells you which service is the actual problem.

### Step 3: Match the error to the service
- Mentions `neon.tech` or "data transfer quota" → **Neon**
- Mentions `r2.cloudflarestorage.com` or "R2" → **Cloudflare**
- Mentions `myshopify.com` or 401/403 → **Shopify**
- Mentions `smtp.gmail.com` or "Authentication failed" → **Gmail**
- Mentions `geoapify.com` → **Geoapify**

Then go to that service's dashboard.

---

## ENVIRONMENT VARIABLES (set on Render)

These power the app. Never hardcode in source.

| Variable | What it's for | Where to get it |
|---|---|---|
| `DATABASE_URL` | Connect to Neon | Neon dashboard → Connection string |
| `SHOPIFY_ACCESS_TOKEN` | Read/write Shopify orders | Shopify admin → Apps → custom app |
| `SHOPIFY_STORE_URL` | Which Shopify store | `thesweettoothfl.myshopify.com` |
| `SMTP_HOST` | Gmail server | `smtp.gmail.com` |
| `SMTP_PORT` | Gmail port | `587` |
| `SMTP_USER` | Gmail address | `orders@thesweettooth.com` |
| `SMTP_PASS` | Gmail App Password | Google account → App Passwords |
| `R2_ACCOUNT_ID` | Cloudflare account | Cloudflare dashboard → R2 |
| `R2_ACCESS_KEY_ID` | Cloudflare API key | Cloudflare R2 → API Tokens |
| `R2_SECRET_ACCESS_KEY` | Cloudflare API secret | Cloudflare R2 → API Tokens |
| `R2_BUCKET` | Bucket name | `sweet-tooth-pod-photos` |
| `GEOAPIFY_API_KEY` | Maps geocoding | Geoapify dashboard |
| `SENDGRID_API_KEY` | LEGACY, NOT USED | — |
| `SENDGRID_FROM_EMAIL` | LEGACY, NOT USED | — |

To view/edit on Render: Driver-s-App → **Environment** (left sidebar)

---

## RULES FOR CLAUDE WHEN HELPING IN A CRISIS

1. **Read this document FIRST.** Don't guess.
2. **Run the debug endpoint FIRST.** Real evidence, not theory.
3. **Read the server logs SECOND.** They name the broken service explicitly.
4. **Don't send Mikey to a dashboard you haven't confirmed is the right one.** It's worse than saying "I'm not sure."
5. **NEVER push code in an emergency without explicit approval from Mikey.** Ever.
6. **If you don't know where something lives, search past chats with `conversation_search` BEFORE asking Mikey.** He's not a developer and may not have the answer.
7. **Always say "Cloudflare" not "R2."**
8. **Always say "delivery fees" not "payroll."**
9. **The word "Optional" must NEVER appear in driver-facing UI.**

---

## DOCUMENT MAINTENANCE

If a service is added, removed, or changed, update this file in the SAME push as the code change. A stale infrastructure doc is worse than no doc — it sends you to wrong dashboards.
