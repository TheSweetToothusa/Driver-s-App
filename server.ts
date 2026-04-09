import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import pkg from 'pg';
const { Pool } = pkg;
import { BERKOWITZ_SEED_ORDERS } from './seedData.js';

config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || '';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@thesweettooth.com';
const KATIE_PHONE = '305-994-4070';

// --- PostgreSQL pool (persistent across deploys) ---
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// --- File paths (fallback if no DB) ---
const POD_STORAGE_PATH = path.join(__dirname, "pod_data.json");
const USERS_PATH = path.join(__dirname, "users.json");
const TEMPLATES_PATH = path.join(__dirname, "templates.json");
const RESCHEDULE_PATH = path.join(__dirname, "reschedule_queue.json");
const MESSAGE_LOG_PATH = path.join(__dirname, "message_log.json");

// --- Initialize file storage fallbacks ---
if (!fs.existsSync(POD_STORAGE_PATH)) fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify({}));
if (!fs.existsSync(RESCHEDULE_PATH)) fs.writeFileSync(RESCHEDULE_PATH, JSON.stringify([]));
if (!fs.existsSync(MESSAGE_LOG_PATH)) fs.writeFileSync(MESSAGE_LOG_PATH, JSON.stringify([]));

// --- DB helpers ---
async function dbGet(key: string): Promise<any> {
  if (!pool) return null;
  try {
    const r = await pool.query('SELECT value FROM kv_store WHERE key=$1', [key]);
    return r.rows[0] ? JSON.parse(r.rows[0].value) : null;
  } catch { return null; }
}

async function dbSet(key: string, value: any): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO kv_store(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()',
      [key, JSON.stringify(value)]
    );
  } catch(e) { console.error('dbSet error', e); }
}

// Aliases used throughout
const getKV = dbGet;
const setKV = dbSet;

// --- POD helpers (PostgreSQL-backed, survives deploys) ---
// Each order's POD data is stored under key "pod:{orderId}"
async function readPodData(): Promise<Record<string, any>> {
  // Try DB first
  if (pool) {
    try {
      const r = await pool.query("SELECT key, value FROM kv_store WHERE key LIKE 'pod:%'");
      const result: Record<string, any> = {};
      for (const row of r.rows) {
        const orderId = row.key.replace('pod:', '');
        try { result[orderId] = JSON.parse(row.value); } catch {}
      }
      return result;
    } catch(e) { console.error('readPodData DB error, falling back to file:', e); }
  }
  // Fallback to file
  try { return JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8')); } catch { return {}; }
}

async function readPodOrder(orderId: string): Promise<any> {
  if (pool) {
    try {
      const r = await pool.query('SELECT value FROM kv_store WHERE key=$1', [`pod:${orderId}`]);
      return r.rows[0] ? JSON.parse(r.rows[0].value) : {};
    } catch { return {}; }
  }
  try {
    const all = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    return all[orderId] || {};
  } catch { return {}; }
}

async function writePodOrder(orderId: string, data: any): Promise<void> {
  // Always write to DB
  if (pool) {
    try {
      await pool.query(
        'INSERT INTO kv_store(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()',
        [`pod:${orderId}`, JSON.stringify(data)]
      );
    } catch(e) { console.error('writePodOrder DB error:', e); }
  }
  // Also write to file as fallback
  try {
    const all = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    all[orderId] = data;
    fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(all, null, 2));
  } catch {}
}

// --- Init DB tables ---
async function initDB() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('DB ready');

  // Seed default users if not present
  const existing = await dbGet('users');
  if (!existing) {
    await dbSet('users', [
      { id: "super_admin", name: "Mikey", pin: "1979", role: "SUPER_ADMIN", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() },
      { id: "manager_1", name: "Katie", pin: "4070", role: "MANAGER", phone: "3059944070", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() }
    ]);
    console.log('Default users seeded');
  } else {
    // Always ensure core accounts are unlocked and have correct PINs
    const users = existing;
    let changed = false;
    const mikey = users.find((u: any) => u.id === 'super_admin');
    const katie = users.find((u: any) => u.id === 'manager_1');
    if (mikey && (mikey.lockedUntil || mikey.failedAttempts > 0)) {
      mikey.lockedUntil = undefined; mikey.failedAttempts = 0; changed = true;
    }
    if (katie && (katie.lockedUntil || katie.failedAttempts > 0)) {
      katie.lockedUntil = undefined; katie.failedAttempts = 0; changed = true;
    }
    // If Katie's PIN got corrupted, reset to default
    if (katie && katie.pin !== '4070' && katie.pin !== '3333') {
      katie.pin = '4070'; changed = true;
      console.log('Katie PIN reset to default 4070');
    }
    if (changed) await dbSet('users', users);
  }

  // Seed Katie as default driver if not already set
  try {
    const defaultDriver = await getKV('default_driver');
    const parsed = defaultDriver ? JSON.parse(defaultDriver) : null;
    if (!parsed || !parsed.driverId) {
      await setKV('default_driver', JSON.stringify({ driverId: 'manager_1', driverName: 'Katie' }));
      console.log('Default driver set to Katie');
    }
  } catch {
    await setKV('default_driver', JSON.stringify({ driverId: 'manager_1', driverName: 'Katie' }));
  }

  // Seed Berkowitz 2026 — FORCE write if fewer than 100 orders found
  try {
    const existingOrders = await dbGet('bulk_orders_proj_berkowitz_2026');
    const count = Array.isArray(existingOrders) ? existingOrders.length : 0;
    console.log(`Berkowitz check: found ${count} orders in DB`);
    if (count < 100) {
      console.log('Seeding 162 Berkowitz/Provenance orders NOW...');
      // Write project
      await dbSet('bulk_projects', [{
        id: 'proj_berkowitz_2026',
        name: 'Berkowitz 2026',
        clientName: 'Berkowitz',
        createdAt: new Date().toISOString(),
        status: 'ACTIVE',
        totalOrders: BERKOWITZ_SEED_ORDERS.length,
        completedOrders: 0,
      }]);
      // Write all orders
      await dbSet('bulk_orders_proj_berkowitz_2026', BERKOWITZ_SEED_ORDERS);
      console.log(`DONE — seeded ${BERKOWITZ_SEED_ORDERS.length} orders`);
    } else {
      console.log(`Berkowitz already has ${count} orders — good`);
    }
  } catch (e) {
    console.error('Berkowitz seed FAILED:', e);
  }
}

if (!fs.existsSync(USERS_PATH)) {
  fs.writeFileSync(USERS_PATH, JSON.stringify([
    { id: "super_admin", name: "Mikey", pin: "1979", role: "SUPER_ADMIN", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() },
    { id: "manager_1", name: "Katie", pin: "4070", role: "MANAGER", phone: "3059944070", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() }
  ], null, 2));
}

if (!fs.existsSync(TEMPLATES_PATH)) {
  fs.writeFileSync(TEMPLATES_PATH, JSON.stringify([
    {
      id: "SUCCESS",
      label: "Delivery Successful",
      body: "Hi {{customer_name}}! 🍫 Great news — your Sweet Tooth order #{{order_number}} was just delivered to {{address}}. We hope whoever receives it loves it! Thank you for choosing The Sweet Tooth."
    },
    {
      id: "FAILURE",
      label: "Delivery Attempted – Please Reschedule",
      body: "Hi {{customer_name}}, this is {{driver_name}} with your Sweet Tooth delivery. We attempted to deliver your order to {{address}}, but were unsuccessful because: {{failure_reason}}.\n\nDriver Note: {{driver_notes}}\n\nPlease text our manager Katie at {{katie_phone}} to reschedule. Thanks!"
    }
  ], null, 2));
}

// --- Helpers ---
function readUsers(): any[] {
  // Sync fallback — DB reads are async so callers that need sync use file
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8')); } catch { return []; }
}
async function writeUsers(u: any[]) {
  try { fs.writeFileSync(USERS_PATH, JSON.stringify(u, null, 2)); } catch {}
  await dbSet('users', u); // persist to DB — awaited so it never gets lost
}
async function readUsersDB(): Promise<any[]> {
  const db = await dbGet('users');
  if (db) return db;
  // fallback to file
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8')); } catch { return []; }
}
function readTemplates() { return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf-8')); }
function readRescheduleQueue() { return JSON.parse(fs.readFileSync(RESCHEDULE_PATH, 'utf-8')); }
function writeRescheduleQueue(q: any[]) { fs.writeFileSync(RESCHEDULE_PATH, JSON.stringify(q, null, 2)); }
function readMessageLog() { return JSON.parse(fs.readFileSync(MESSAGE_LOG_PATH, 'utf-8')); }
function appendMessageLog(entry: any) { const log = readMessageLog(); log.unshift(entry); fs.writeFileSync(MESSAGE_LOG_PATH, JSON.stringify(log.slice(0, 500), null, 2)); }

function isWithinSendingHours(): boolean {
  const h = new Date().getHours();
  return h >= 9 && h < 20;
}

function interpolate(body: string, vars: Record<string, string>): string {
  return body.replace(/{{(\w+)}}/g, (_, key) => vars[key] || '');
}

function nextBusinessDay(from: Date): string {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (!SENDGRID_API_KEY) return false;
  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: SENDGRID_FROM_EMAIL, name: 'The Sweet Tooth' },
        subject,
        content: [{ type: 'text/plain', value: body }]
      })
    });
    return resp.status === 202;
  } catch { return false; }
}

async function startServer() {
  await initDB();
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  app.use(express.json({ limit: '50mb' }));

  // ── AUTH ────────────────────────────────────────────────────────────────────

  app.post("/api/auth/login", async (req, res) => {
    const { pin } = req.body;
    if (!pin || pin.length !== 4) return res.status(400).json({ error: "Enter a 4-digit PIN" });
    const users = await readUsersDB();
    const user = users.find((u: any) => u.pin === pin);
    if (!user) return res.status(401).json({ error: "Incorrect PIN. Try again." });
    if (!user.isActive) return res.status(403).json({ error: "Account is inactive. Contact Katie." });
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return res.status(403).json({ error: "Account locked — try again in 15 minutes." });
    }
    user.failedAttempts = 0;
    user.lockedUntil = undefined;
    await writeUsers(users);
    const { pin: _, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  // ── USERS ───────────────────────────────────────────────────────────────────

  app.get("/api/users", async (_req, res) => {
    const users = await readUsersDB();
    res.json({ users: users.map(({ pin: _, ...u }: any) => u) });
  });

  app.post("/api/users", async (req, res) => {
    const { name, pin, role, phone, email, vehicle } = req.body;
    if (!name || !pin || !role) return res.status(400).json({ error: "name, pin, role required" });
    if (!phone) return res.status(400).json({ error: "Phone number is required" });
    const users = await readUsersDB();
    if (users.find((u: any) => u.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: "A user with that name already exists" });
    }
    if (users.find((u: any) => u.pin === pin)) {
      return res.status(409).json({ error: "That PIN is already taken. Choose a different 4-digit PIN." });
    }
    const newUser = { id: `user_${Date.now()}`, name, pin, role, phone: phone || '', email: email || '', vehicle: vehicle || '', isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() };
    users.push(newUser);
    await writeUsers(users);
    const { pin: _, ...safeUser } = newUser;
    res.json({ user: safeUser });
  });

  app.patch("/api/users/:id", async (req, res) => {
    const users = await readUsersDB();
    const idx = users.findIndex((u: any) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    users[idx] = { ...users[idx], ...req.body };
    await writeUsers(users);
    const { pin: _, ...safeUser } = users[idx];
    res.json({ user: safeUser });
  });

  app.post("/api/users/:id/reset-pin", async (req, res) => {
    const { newPin } = req.body;
    if (!newPin || newPin.length !== 4) return res.status(400).json({ error: "4-digit PIN required" });
    const users = await readUsersDB();
    const idx = users.findIndex((u: any) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    users[idx].pin = newPin;
    users[idx].lockedUntil = undefined;
    users[idx].failedAttempts = 0;
    await writeUsers(users);
    res.json({ success: true });
  });

  // ── ORDERS ──────────────────────────────────────────────────────────────────

  app.get("/api/orders", async (_req, res) => {
    try {
      // Only fetch orders from the last 14 days — that's all a delivery app needs
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders.json?status=any&limit=100&created_at_min=${twoWeeksAgo}`;
      const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('Shopify error:', resp.status, errText);
        throw new Error(`Shopify ${resp.status}`);
      }
      const data = await resp.json();
      const allOrders = data.orders || [];
      // Include orders with local delivery shipping OR tagged Local Delivery
      const filtered = allOrders.filter((o: any) => {
        const tags = (o.tags || '').split(',').map((t: string) => t.trim().toLowerCase());
        const hasTag = tags.includes('local delivery') || tags.includes('local-delivery');
        const hasLocalShipping = (o.shipping_lines || []).some((sl: any) =>
          sl.title?.toLowerCase().includes('local') || sl.title?.toLowerCase().includes('delivery') || sl.code?.toLowerCase().includes('local')
        );
        return hasTag || hasLocalShipping || allOrders.length < 10; // if few orders, show all
      });
      const podData = await readPodData();

      // Restore status/completedAt from Shopify tags (survives server restarts)
      const ordersWithTags = (filtered.length > 0 ? filtered : allOrders).map((o: any) => {
        const tagsList = (o.tags || '').split(',').map((t: string) => t.trim());
        const statusTag = tagsList.find((t: string) => t.startsWith('st_status:'));
        const completedTag = tagsList.find((t: string) => t.startsWith('st_completed:'));
        const driverTag = tagsList.find((t: string) => t.startsWith('st_driver:'));
        const driverNameTag = tagsList.find((t: string) => t.startsWith('st_drivername:'));
        if (statusTag) o._st_status = statusTag.replace('st_status:', '');
        if (completedTag) {
          // Convert st_completed:2026-03-13T18-30-45.123Z back to 2026-03-13T18:30:45.123Z
          // The time portion (after T) has dashes that need to become colons
          const rawTimestamp = completedTag.replace('st_completed:', '');
          const [datePart, timePart] = rawTimestamp.split('T');
          if (timePart) {
            // Replace only the first two dashes in the time part (HH-MM-SS becomes HH:MM:SS)
            const fixedTime = timePart.replace('-', ':').replace('-', ':');
            o._st_completedAt = `${datePart}T${fixedTime}`;
          } else {
            o._st_completedAt = rawTimestamp; // Malformed, use as-is (will be caught by validation)
          }
        }
        if (driverTag) o._st_driverId = driverTag.replace('st_driver:', '');
        if (driverNameTag) o._st_driverName = driverNameTag.replace('st_drivername:', '');
        const deliveryDateTag = tagsList.find((t: string) => t.startsWith('st_deliverydate:'));
        if (deliveryDateTag) o._st_deliveryDate = deliveryDateTag.replace('st_deliverydate:', '');
        return o;
      });

      console.log(`Shopify: ${allOrders.length} total, ${(filtered.length > 0 ? filtered : allOrders).length} local delivery`);

      // OPTIMIZATION: Cache fulfillment instructions in PostgreSQL
      // Only fetch from Shopify for orders we haven't cached yet
      const finalOrders = filtered.length > 0 ? filtered : allOrders;
      const ordersToProcess = ordersWithTags.length > 0 ? ordersWithTags : finalOrders;
      
      // Load cached instructions from DB
      const cachedInstructions: Record<string, string> = await getKV('fulfillment_instructions_cache') || {};
      const uncachedOrders = ordersToProcess.filter((o: any) => !cachedInstructions[o.id]);
      
      console.log(`Instructions cache: ${Object.keys(cachedInstructions).length} cached, ${uncachedOrders.length} need fetch`);
      
      // Apply cached instructions immediately
      ordersToProcess.forEach((o: any) => {
        if (cachedInstructions[o.id]) {
          o._delivery_instructions = cachedInstructions[o.id];
        }
      });
      
      // Fetch ONLY uncached orders (in batches of 10 to avoid rate limits)
      if (uncachedOrders.length > 0) {
        const BATCH_SIZE = 10;
        let newCache: Record<string, string> = {};
        
        for (let i = 0; i < uncachedOrders.length; i += BATCH_SIZE) {
          const batch = uncachedOrders.slice(i, i + BATCH_SIZE);
          try {
            const foResults = await Promise.allSettled(
              batch.map((o: any) =>
                fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${o.id}/fulfillment_orders.json`, {
                  headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' }
                }).then(r => r.json())
              )
            );
            foResults.forEach((result, j) => {
              const order = batch[j];
              if (result.status === 'fulfilled' && result.value.fulfillment_orders) {
                const fo = result.value.fulfillment_orders[0];
                const instructions = fo?.delivery_method?.additional_information?.instructions;
                if (instructions) {
                  const lower = instructions.toLowerCase();
                  const isRealInstruction = ['gate', 'call', 'buzz', 'code', 'floor', 'unit', 'leave', 'ring', 'door', 'security', 'guard', 'lobby', 'buzzer', 'bell', 'phone', 'arrival', 'gated', 'access', 'building', 'apt', 'suite', 'knock', 'back', 'front', 'side', 'enter', 'key', 'intercom'].some(kw => lower.includes(kw));
                  if (isRealInstruction) {
                    order._delivery_instructions = instructions;
                    newCache[order.id] = instructions;
                  } else {
                    // Cache empty string so we don't re-fetch
                    newCache[order.id] = '';
                  }
                } else {
                  newCache[order.id] = '';
                }
              } else {
                newCache[order.id] = '';
              }
            });
          } catch (e) {
            console.error(`Fulfillment batch ${i}-${i + BATCH_SIZE} error:`, e);
          }
        }
        
        // Merge new cache entries and save (keep cache from growing unbounded - only last 500 orders)
        const mergedCache = { ...cachedInstructions, ...newCache };
        const cacheEntries = Object.entries(mergedCache);
        const trimmedCache = cacheEntries.length > 500 
          ? Object.fromEntries(cacheEntries.slice(-500)) 
          : mergedCache;
        await setKV('fulfillment_instructions_cache', trimmedCache);
        console.log(`Instructions cache updated: ${Object.keys(newCache).length} new entries`);
      }

      res.json({ orders: ordersWithTags, podData });
    } catch (e) {
      console.error('Orders fetch error:', e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.patch("/api/orders/:id/assign", async (req, res) => {
    const { driverId, driverName } = req.body;
    const orderId = req.params.id;

    // Save to DB
    const existing = await readPodOrder(orderId);
    existing.driverId = driverId;
    existing.driverName = driverName;
    await writePodOrder(orderId, existing);

    // Persist to Shopify tags so assignment survives page refresh
    if (SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN) {
      try {
        const tagResp = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json?fields=tags`, {
          headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
        });
        const tagData = await tagResp.json();
        const currentTags = tagData.order?.tags || '';
        const tagsList = currentTags.split(',').map((t: string) => t.trim())
          .filter((t: string) => t && !t.startsWith('st_driver:') && !t.startsWith('st_drivername:'));
        if (driverId) tagsList.push(`st_driver:${driverId}`);
        if (driverName) tagsList.push(`st_drivername:${driverName.replace(/,/g, '')}`);
        await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
          body: JSON.stringify({ order: { id: orderId, tags: tagsList.join(', ') } })
        });
        console.log(`Driver assignment saved to Shopify for order ${orderId}: ${driverName}`);
      } catch (err) {
        console.error('Failed to sync driver assignment to Shopify (non-fatal):', err);
      }
    }

    res.json({ success: true });
  });

  app.patch("/api/orders/:id/status", async (req, res) => {
    const { status } = req.body;
    const existing = await readPodOrder(req.params.id);
    existing.status = status;
    if (status === 'DELIVERED' && !existing.completedAt) {
      existing.completedAt = new Date().toISOString();
    }
    await writePodOrder(req.params.id, existing);
    
    // Sync status to Shopify as a tag
    if (SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN) {
      try {
        const orderId = req.params.id;
        const existingResp = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json?fields=tags`, {
          headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
        });
        const existingData = await existingResp.json();
        const currentTags = existingData.order?.tags || '';
        const tagsList = currentTags.split(',').map((t: string) => t.trim()).filter((t: string) => t && !t.startsWith('st_status:'));
        tagsList.push(`st_status:${status}`);
        await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
          body: JSON.stringify({ order: { id: orderId, tags: tagsList.join(', ') } })
        });
        console.log(`Synced status ${status} to Shopify for order ${orderId}`);
      } catch (err) {
        console.error('Failed to sync status to Shopify:', err);
      }
    }
    
    res.json({ success: true, status });
  });

  // ── AUDIT LOG ─────────────────────────────────────────────────────────────
  // GET all audit entries (admin view)
  app.get("/api/audit-log", async (_req, res) => {
    try {
      const val = await getKV('audit_log');
      res.json(val ? JSON.parse(val) : { entries: [] });
    } catch { res.json({ entries: [] }); }
  });

  // ── SHOPIFY TAG HISTORY — pulls Events API for st_deliverydate / st_status changes ──
  app.get("/api/shopify-tag-history", async (_req, res) => {
    if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) {
      return res.json({ entries: [], error: 'Shopify not configured' });
    }
    try {
      // Pull last 250 order events of type "updated" — covers tag changes
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/events.json?verb=updated&limit=250&filter=Order`;
      const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
      const data = await resp.json();
      const events = data.events || [];

      // For each event, pull the order's current tags so we can surface st_deliverydate / st_status
      // Events don't include the diff, but the message field often contains it
      const entries = events.map((ev: any) => {
        const msg: string = ev.message || '';
        // Extract any st_deliverydate or st_status tags mentioned
        const dateMatch = msg.match(/st_deliverydate:([^\s,<"]+)/);
        const statusMatch = msg.match(/st_status:([^\s,<"]+)/);
        const driverMatch = msg.match(/st_driver:([^\s,<"]+)/);
        return {
          id: ev.id,
          timestamp: ev.created_at,
          orderId: ev.subject_id,
          orderNumber: ev.subject_id,
          author: ev.author || 'Shopify',
          message: msg.replace(/<[^>]+>/g, '').trim(),
          deliveryDate: dateMatch ? dateMatch[1] : null,
          status: statusMatch ? statusMatch[1] : null,
          driver: driverMatch ? driverMatch[1] : null,
        };
      }).filter((e: any) => e.deliveryDate || e.status || e.driver || e.message);

      res.json({ entries });
    } catch (err) {
      console.error('Shopify tag history error:', err);
      res.json({ entries: [], error: String(err) });
    }
  });

  // Also fetch events for a specific order
  app.get("/api/shopify-tag-history/:orderId", async (req, res) => {
    if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) {
      return res.json({ entries: [], error: 'Shopify not configured' });
    }
    try {
      const orderId = req.params.orderId;
      // Get all events for this specific order
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}/events.json?limit=250`;
      const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
      const data = await resp.json();
      const events = data.events || [];

      const entries = events.map((ev: any) => {
        const msg: string = ev.message || '';
        const dateMatch = msg.match(/st_deliverydate:([^\s,<"]+)/g);
        const statusMatch = msg.match(/st_status:([^\s,<"]+)/g);
        const driverMatch = msg.match(/st_driver:([^\s,<"]+)/g);
        return {
          id: ev.id,
          timestamp: ev.created_at,
          orderId: ev.subject_id,
          author: ev.author || 'Shopify',
          rawMessage: msg.replace(/<[^>]+>/g, '').trim(),
          deliveryDates: dateMatch || [],
          statuses: statusMatch || [],
          drivers: driverMatch || [],
        };
      });

      res.json({ entries });
    } catch (err) {
      res.json({ entries: [], error: String(err) });
    }
  });

  // POST a new audit entry
  app.post("/api/audit-log", async (req, res) => {
    try {
      const { orderId, orderNumber, actorId, actorName, action, field, oldValue, newValue } = req.body;
      const val = await getKV('audit_log');
      const data = val ? JSON.parse(val) : { entries: [] };
      const entry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        orderId,
        orderNumber: orderNumber || orderId,
        actorId,
        actorName,
        action,
        field,
        oldValue,
        newValue,
      };
      data.entries.unshift(entry); // newest first
      if (data.entries.length > 2000) data.entries = data.entries.slice(0, 2000);
      await setKV('audit_log', JSON.stringify(data));
      res.json({ success: true, entry });
    } catch (err) {
      console.error('Audit log error:', err);
      res.json({ success: false });
    }
  });

  app.post("/api/orders/:id/note", async (req, res) => {
    const { note } = req.body;
    const existing = await readPodOrder(req.params.id);
    const prev = existing.adminNotes || '';
    existing.adminNotes = prev
      ? `${prev}\n[${new Date().toLocaleString()}] ${note}`
      : `[${new Date().toLocaleString()}] ${note}`;
    await writePodOrder(req.params.id, existing);
    res.json({ success: true });
  });

  // Edit contact/address info (admin: all except rate; super_admin: everything)
  app.patch("/api/orders/:id/edit", async (req, res) => {
    const { customer, address, giftReceiverName, giftSenderName, giftSenderPhone, deliveryFee, deliveryDate } = req.body;
    const orderId = req.params.id;
    const existing = await readPodOrder(orderId);
    if (customer) existing.customer = customer;
    if (address) existing.address = address;
    if (giftReceiverName !== undefined) existing.giftReceiverName = giftReceiverName;
    if (giftSenderName !== undefined) existing.giftSenderName = giftSenderName;
    if (giftSenderPhone !== undefined) existing.giftSenderPhone = giftSenderPhone;
    if (deliveryFee !== undefined) existing.deliveryFee = deliveryFee;
    if (deliveryDate !== undefined) existing.deliveryDate = deliveryDate;
    await writePodOrder(orderId, existing);

    if (SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN) {
      try {
        // Fetch current tags
        const tagResp = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json?fields=tags`, {
          headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
        });
        const tagData = await tagResp.json();
        const currentTags = tagData.order?.tags || '';
        let tagsList = currentTags.split(',').map((t: string) => t.trim()).filter(Boolean);

        // Sync delivery date tag
        if (deliveryDate !== undefined) {
          tagsList = tagsList.filter((t: string) => !t.startsWith('st_deliverydate:'));
          if (deliveryDate) tagsList.push(`st_deliverydate:${deliveryDate}`);
        }

        // Sync delivery fee tag
        if (deliveryFee !== undefined) {
          tagsList = tagsList.filter((t: string) => !t.startsWith('st_fee:'));
          tagsList.push(`st_fee:${deliveryFee}`);
        }

        const shopifyUpdate: any = { order: { id: orderId, tags: tagsList.join(', ') } };

        // Sync shipping address to Shopify if address changed
        if (address) {
          const nameParts = (giftReceiverName || existing.giftReceiverName || customer?.name || '').split(' ');
          shopifyUpdate.order.shipping_address = {
            first_name: nameParts[0] || '',
            last_name: nameParts.slice(1).join(' ') || '',
            address1: address.street || '',
            address2: address.unit || '',
            city: address.city || '',
            province: 'FL',
            country: 'US',
            zip: address.zip || '',
            phone: customer?.phone || existing.customer?.phone || '',
          };
          console.log(`Syncing address to Shopify for order ${orderId}: ${address.street}, ${address.city} ${address.zip}`);
        }

        await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
          body: JSON.stringify(shopifyUpdate)
        });
      } catch (err) {
        console.error('Failed to sync order edit to Shopify (non-fatal):', err);
      }
    }

    res.json({ success: true });
  });


  // ── REVERT accidental delivery confirmation ─────────────────────────────────
  app.post("/api/orders/:id/revert", async (req, res) => {
    const id = req.params.id;
    try {
      const existing = await readPodOrder(id);
      delete existing.photo;
      delete existing.signature;
      delete existing.completedAt;
      delete existing.submittedAt;
      delete existing.successNotificationSent;
      existing.status = 'ASSIGNED';
      existing.revertedAt = new Date().toISOString();
      await writePodOrder(id, existing);

      // Sync reverted status back to Shopify tag
      if (SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN) {
        try {
          const tagResp = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${id}.json?fields=tags`, {
            headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
          });
          const tagData = await tagResp.json();
          const currentTags = tagData.order?.tags || '';
          const tagsList = currentTags.split(',').map((t: string) => t.trim())
            .filter((t: string) => t && !t.startsWith('st_status:') && !t.startsWith('st_completed:'));
          tagsList.push('st_status:ASSIGNED');
          await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${id}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
            body: JSON.stringify({ order: { id, tags: tagsList.join(', ') } })
          });
          console.log(`Reverted order ${id} — Shopify tag updated to ASSIGNED`);
        } catch (tagErr) {
          console.error('Failed to sync revert to Shopify (non-fatal):', tagErr);
        }
      }

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });


  // ── DEBUG: see raw order statuses ──────────────────────────────────────────
  app.get('/api/debug/orders', async (req, res) => {
    try {
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders.json?status=any&limit=50`;
      const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
      const data = await resp.json();
      const summary = (data.orders || []).map((o: any) => ({
        id: o.id, name: o.name,
        fulfillment_status: o.fulfillment_status,
        financial_status: o.financial_status,
        tags: o.tags,
        st_tags: (o.tags||'').split(',').filter((t:string)=>t.trim().startsWith('st_'))
      }));
      res.json({ count: summary.length, orders: summary });
    } catch(e) { res.status(500).json({ error: String(e) }); }
  });

  // ── POD ─────────────────────────────────────────────────────────────────────

  app.get("/api/pod/:orderId", async (req, res) => {
    try {
      const pod = await readPodOrder(req.params.orderId);
      if (pod && Object.keys(pod).length > 0) {
        // Normalize field names before returning
        if (pod.photo && !pod.confirmationPhoto) pod.confirmationPhoto = pod.photo;
        if (pod.signature && !pod.confirmationSignature) pod.confirmationSignature = pod.signature;
        if (pod.notes && !pod.driverNotes) pod.driverNotes = pod.notes;
        res.json({ pod });
      } else {
        res.json({ pod: null });
      }
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post("/api/pod", async (req, res) => {
    const { orderId, photo, signature, notes, completedAt, status, driverId, driverName, failureReason, isManual } = req.body;
    try {
      const existingPod = await readPodOrder(orderId);
      const updated = {
        ...existingPod,
        photo,
        signature,
        confirmationPhoto: photo || null,
        confirmationSignature: signature || null,
        notes,
        driverNotes: notes || null,
        completedAt,
        submittedAt: new Date().toISOString(),
        status,
        driverId,
        driverName,
        failureReason
      };
      await writePodOrder(orderId, updated);

      // For manual orders (stored in DB only) — update the manual_orders record directly
      const isManualOrder = isManual || String(orderId).startsWith('manual_');
      if (isManualOrder && status === 'DELIVERED') {
        try {
          const manualOrders = await dbGet('manual_orders') || [];
          const idx = manualOrders.findIndex((o: any) => o.id === orderId);
          if (idx !== -1) {
            manualOrders[idx] = {
              ...manualOrders[idx],
              status: 'DELIVERED',
              completedAt: completedAt || new Date().toISOString(),
              confirmationPhoto: photo || null,
              driverNotes: notes || null,
              driverId: driverId || manualOrders[idx].driverId,
              driverName: driverName || manualOrders[idx].driverName,
            };
            await dbSet('manual_orders', manualOrders);
          }
        } catch (manualErr) {
          console.error('Failed to update manual order status (non-fatal):', manualErr);
        }
      }

      // For Shopify orders — write status + completedAt back as order tags
      if (!isManualOrder && SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN && status === 'DELIVERED') {
        try {
          const existing = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json?fields=tags`, {
            headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
          });
          const existingData = await existing.json();
          const currentTags = existingData.order?.tags || '';
          const tagsList = currentTags.split(',').map((t: string) => t.trim()).filter((t: string) => t && !t.startsWith('st_status:') && !t.startsWith('st_completed:') && !t.startsWith('st_driver:') && !t.startsWith('st_drivername:'));
          tagsList.push(`st_status:DELIVERED`);
          tagsList.push(`st_completed:${(completedAt || new Date().toISOString()).replace(/:/g,'-')}`);
          if (driverId) tagsList.push(`st_driver:${driverId}`);
          if (driverName) tagsList.push(`st_drivername:${driverName.replace(/,/g, '')}`);
          await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json`, {
            method: 'PUT',
            headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: { id: orderId, tags: tagsList.join(', ') } })
          });
        } catch (tagErr) {
          console.error('Failed to write tags to Shopify (non-fatal):', tagErr);
        }
      }

      res.json({ success: true });
    } catch { res.status(500).json({ error: "Failed to save POD" }); }
  });

  // ── RESCHEDULE ──────────────────────────────────────────────────────────────

  // Auto-reschedule: creates a "2nd Attempt" entry for next business day, same driver
  app.post("/api/reschedule/auto", async (req, res) => {
    const { order } = req.body;
    const nextDay = nextBusinessDay(new Date());
    const rescheduledOrder = {
      ...order,
      id: `${order.id}_2nd`,
      status: 'SECOND_ATTEMPT',
      deliveryDate: nextDay,
      attemptNumber: 2,
      originalDeliveryId: order.id,
      attempts: order.attempts || [],
      submittedAt: undefined,
      completedAt: undefined,
      confirmationPhoto: undefined,
      confirmationSignature: undefined,
      successNotificationSent: false,
      failureNotificationSent: false,
    };
    // Store in POD data so it shows up in the app
    await writePodOrder(rescheduledOrder.id, {
      rescheduledOrder,
      createdAt: new Date().toISOString(),
      type: 'SECOND_ATTEMPT'
    });
    res.json({ success: true, rescheduledOrder, nextDate: nextDay });
  });

  // Manual reschedule: add to Katie's pending queue
  app.post("/api/reschedule/pending", (req, res) => {
    const { order, failureReason, driverNotes, photo } = req.body;
    const queue = readRescheduleQueue();
    const entry = {
      id: `reschedule_${Date.now()}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customer: order.customer,
      address: order.address,
      driverId: order.driverId,
      driverName: order.driverName,
      failureReason,
      driverNotes,
      photo,
      submittedAt: new Date().toISOString(),
      status: 'PENDING' // PENDING | REASSIGNED | CANCELLED
    };
    queue.push(entry);
    writeRescheduleQueue(queue);
    res.json({ success: true, entry });
  });

  app.get("/api/reschedule/pending", (_req, res) => {
    res.json({ queue: readRescheduleQueue() });
  });

  app.patch("/api/reschedule/:id", (req, res) => {
    const queue = readRescheduleQueue();
    const idx = queue.findIndex((e: any) => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    queue[idx] = { ...queue[idx], ...req.body };
    writeRescheduleQueue(queue);
    res.json({ entry: queue[idx] });
  });

  // ── TEMPLATES ───────────────────────────────────────────────────────────────

  app.get("/api/templates", (_req, res) => {
    res.json({ templates: readTemplates() });
  });

  app.patch("/api/templates/:id", (req, res) => {
    const templates = readTemplates();
    const idx = templates.findIndex((t: any) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    templates[idx] = { ...templates[idx], ...req.body };
    fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2));
    res.json({ template: templates[idx] });
  });

  // ── NOTIFY ──────────────────────────────────────────────────────────────────

  app.post("/api/notify/preview", (req, res) => {
    const { type, order, failureReason, driverNotes } = req.body;
    const templates = readTemplates();
    const template = templates.find((t: any) => t.id === type);
    if (!template) return res.status(400).json({ error: "Template not found" });
    const vars: Record<string, string> = {
      customer_name: order.customer?.name || 'Valued Customer',
      order_number: order.orderNumber || '',
      driver_name: order.driverName || 'your driver',
      address: order.address ? `${order.address.street}, ${order.address.city}` : '',
      katie_phone: KATIE_PHONE,
      failure_reason: failureReason || '',
      driver_notes: driverNotes || ''
    };
    const preview = interpolate(template.body, vars);
    const channel = 'Email';
    res.json({ preview, channel });
  });

  app.post("/api/notify", async (req, res) => {
    const { type, order, failureReason, driverNotes } = req.body;
    if (!isWithinSendingHours()) {
      return res.status(400).json({ error: "Messages can only be sent between 9 AM and 8 PM." });
    }
    const templates = readTemplates();
    const template = templates.find((t: any) => t.id === type);
    if (!template) return res.status(400).json({ error: "Template not found" });
    const vars: Record<string, string> = {
      customer_name: order.customer?.name || 'Valued Customer',
      order_number: order.orderNumber || '',
      driver_name: order.driverName || 'your driver',
      address: order.address ? `${order.address.street}, ${order.address.city}` : '',
      katie_phone: KATIE_PHONE,
      failure_reason: failureReason || '',
      driver_notes: driverNotes || ''
    };
    const message = interpolate(template.body, vars);
    const email = order.customer?.email;
    let sent = false;
    let channel = 'Email';
    if (email) {
      const subject = type === 'SUCCESS'
        ? `Your Sweet Tooth Delivery is Complete! 🍫`
        : `Sweet Tooth Delivery Update — Order #${order.orderNumber}`;
      sent = await sendEmail(email, subject, message);
    }
    if (sent) {
      const existingPodNotif = await readPodOrder(order.id);
      existingPodNotif[type === 'SUCCESS' ? 'successNotificationSent' : 'failureNotificationSent'] = true;
      await writePodOrder(order.id, existingPodNotif);
      // Log the message
      appendMessageLog({
        id: `msg_${Date.now()}`,
        sentAt: new Date().toISOString(),
        type,
        channel,
        to: email || '',
        customerName: order.customer?.name || '',
        orderNumber: order.orderNumber || '',
        driverName: order.driverName || '',
        message,
        orderId: order.id
      });
    }
    res.json({ sent, channel, message });
  });

  // ── MESSAGE LOG ─────────────────────────────────────────────────────────────

  app.get("/api/messages", (_req, res) => {
    res.json({ messages: readMessageLog() });
  });

  // ── CONFIG STATUS — shows which integrations are active ──────────────────
  app.get("/api/config/status", (_req, res) => {
    res.json({
      sendgrid: !!SENDGRID_API_KEY,
      sendgridFrom: SENDGRID_FROM_EMAIL || null,
      notificationChannel: 'Email only (SendGrid)',
    });
  });

  // ── DEFAULT DRIVER SETTING ───────────────────────────────────────────────
  app.get("/api/config/default-driver", async (_req, res) => {
    try {
      const val = await getKV('default_driver');
      res.json(val ? JSON.parse(val) : { driverId: null, driverName: null });
    } catch { res.json({ driverId: null, driverName: null }); }
  });

  app.post("/api/config/default-driver", async (req, res) => {
    const { driverId, driverName } = req.body;
    await setKV('default_driver', JSON.stringify({ driverId, driverName }));
    res.json({ ok: true, driverId, driverName });
  });

  // ── DRIVER PAY RATES ─────────────────────────────────────────────────────
  app.get("/api/config/driver-rates", async (_req, res) => {
    try {
      const val = await getKV('driver_rates');
      res.json(val ? JSON.parse(val) : { rates: {} });
    } catch { res.json({ rates: {} }); }
  });

  app.post("/api/config/driver-rates", async (req, res) => {
    const { rates } = req.body;
    await setKV('driver_rates', JSON.stringify({ rates }));
    res.json({ ok: true, rates });
  });

  // ── FEE HISTORY ──────────────────────────────────────────────────────────
  app.get("/api/config/fee-history", async (_req, res) => {
    try {
      const val = await getKV('fee_history');
      res.json(val ? JSON.parse(val) : { history: [] });
    } catch { res.json({ history: [] }); }
  });

  app.post("/api/config/fee-history", async (req, res) => {
    const { history } = req.body;
    await setKV('fee_history', JSON.stringify({ history }));
    res.json({ ok: true });
  });

  // ── TEST NOTIFICATION ────────────────────────────────────────────────────
  app.post("/api/notify/test", async (req, res) => {
    const { to } = req.body;
    const message = "Test from The Sweet Tooth Driver App — email notifications are working! 🍫";
    const sent = await sendEmail(to, "Sweet Tooth App — Test Notification", message);
    res.json({ sent, message, channel: 'Email' });
  });

  // ── GEOCODING (free via OpenStreetMap Nominatim) ────────────────────────────

  app.post("/api/geocode", async (req, res) => {
    const { addresses } = req.body; // Array of { id, street, city, zip }
    if (!Array.isArray(addresses)) return res.status(400).json({ error: "addresses array required" });
    const results: Record<string, { lat: number; lng: number }> = {};
    const GEOAPIFY_KEY = process.env.GEOAPIFY_API_KEY || 'c721dbc68297447e9fa57a0cc401b6db';
    
    for (const addr of addresses) {
      try {
        const q = encodeURIComponent(`${addr.street}, ${addr.city}, FL ${addr.zip}`);
        let lat: number | null = null;
        let lng: number | null = null;
        
        // Use Geoapify for geocoding (much better than Nominatim for US addresses)
        const geoResp = await fetch(`https://api.geoapify.com/v1/geocode/search?text=${q}&filter=countrycode:us&apiKey=${GEOAPIFY_KEY}`);
        const geoData = await geoResp.json();
        if (geoData.features && geoData.features[0]?.geometry?.coordinates) {
          // Geoapify returns [lng, lat] in GeoJSON format
          lng = geoData.features[0].geometry.coordinates[0];
          lat = geoData.features[0].geometry.coordinates[1];
        }
        
        if (lat !== null && lng !== null) {
          results[addr.id] = { lat, lng };
        }
      } catch (e) {
        console.error('Geocode failed for', addr.id, e);
      }
    }
    res.json({ results });
  });

  // ── ROUTE OPTIMIZATION (nearest-neighbor from driver location) ─────────────

  app.post("/api/route/optimize", (req, res) => {
    const { stops, startLat, startLng } = req.body;
    // stops: Array of { id, lat, lng }
    // Returns optimized order of stop IDs
    if (!Array.isArray(stops) || stops.length === 0) return res.json({ order: [] });

    const haversine = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 3959; // miles
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Nearest-neighbor greedy algorithm
    const remaining = [...stops];
    const ordered: typeof stops = [];
    let curLat = startLat || 25.946;
    let curLng = startLng || -80.155;
    let totalDistance = 0;

    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversine(curLat, curLng, remaining[i].lat, remaining[i].lng);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      ordered.push(next);
      totalDistance += bestDist;
      curLat = next.lat;
      curLng = next.lng;
    }

    res.json({ order: ordered.map(s => s.id), totalDistance: Math.round(totalDistance * 10) / 10 });
  });

  // ── BULK PROJECTS (Berkowitz / Provenance) ─────────────────────────────────

  // Get all projects
  app.get("/api/bulk/projects", async (_req, res) => {
    try {
      const projects = await dbGet('bulk_projects') || [];
      res.json({ projects });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Create a project
  app.post("/api/bulk/projects", async (req, res) => {
    try {
      const { name, clientName } = req.body;
      const projects = await dbGet('bulk_projects') || [];
      const project = {
        id: `proj_${Date.now()}`,
        name, clientName,
        createdAt: new Date().toISOString(),
        status: 'ACTIVE',
        totalOrders: 0,
        completedOrders: 0,
      };
      projects.push(project);
      await dbSet('bulk_projects', projects);
      res.json({ project });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Get all orders for a project
  app.get("/api/bulk/projects/:projectId/orders", async (req, res) => {
    try {
      const orders = await dbGet(`bulk_orders_${req.params.projectId}`) || [];
      res.json({ orders });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Upload / import orders for a project (from parsed CSV data sent by frontend)
  app.post("/api/bulk/projects/:projectId/orders/import", async (req, res) => {
    try {
      const { orders: newOrders } = req.body;
      const projectId = req.params.projectId;
      const existing = await dbGet(`bulk_orders_${projectId}`) || [];
      const merged = [...existing, ...newOrders];
      await dbSet(`bulk_orders_${projectId}`, merged);
      // Update project totals
      const projects = await dbGet('bulk_projects') || [];
      const pIdx = projects.findIndex((p: any) => p.id === projectId);
      if (pIdx !== -1) {
        projects[pIdx].totalOrders = merged.length;
        projects[pIdx].completedOrders = merged.filter((o: any) => o.status === 'DELIVERED' || o.status === 'CLOSED').length;
        await dbSet('bulk_projects', projects);
      }
      res.json({ success: true, totalImported: newOrders.length, totalOrders: merged.length });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Update a single bulk order (assign driver, change status, add notes, POD, etc.)
  app.patch("/api/bulk/orders/:projectId/:orderId", async (req, res) => {
    try {
      const { projectId, orderId } = req.params;
      const updates = req.body;
      const orders = await dbGet(`bulk_orders_${projectId}`) || [];
      const idx = orders.findIndex((o: any) => o.id === orderId);
      if (idx === -1) return res.status(404).json({ error: "Order not found" });
      orders[idx] = { ...orders[idx], ...updates };
      // If completing, set completedAt
      if (updates.status === 'DELIVERED' && !orders[idx].completedAt) {
        orders[idx].completedAt = new Date().toISOString();
      }
      await dbSet(`bulk_orders_${projectId}`, orders);
      // Update project counts
      const projects = await dbGet('bulk_projects') || [];
      const pIdx = projects.findIndex((p: any) => p.id === projectId);
      if (pIdx !== -1) {
        projects[pIdx].completedOrders = orders.filter((o: any) => o.status === 'DELIVERED' || o.status === 'CLOSED').length;
        await dbSet('bulk_projects', projects);
      }
      res.json({ success: true, order: orders[idx] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Bulk assign driver to multiple orders
  app.post("/api/bulk/orders/:projectId/assign", async (req, res) => {
    try {
      const { projectId } = req.params;
      const { orderIds, driverId, driverName } = req.body;
      const orders = await dbGet(`bulk_orders_${projectId}`) || [];
      let count = 0;
      for (const oid of orderIds) {
        const idx = orders.findIndex((o: any) => o.id === oid);
        if (idx !== -1) {
          orders[idx].driverId = driverId;
          orders[idx].driverName = driverName;
          if (orders[idx].status === 'PENDING') orders[idx].status = 'ASSIGNED';
          count++;
        }
      }
      await dbSet(`bulk_orders_${projectId}`, orders);
      res.json({ success: true, assigned: count });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Bulk update status for multiple orders
  app.post("/api/bulk/orders/:projectId/bulk-status", async (req, res) => {
    try {
      const { projectId } = req.params;
      const { orderIds, status } = req.body;
      const orders = await dbGet(`bulk_orders_${projectId}`) || [];
      let count = 0;
      for (const oid of orderIds) {
        const idx = orders.findIndex((o: any) => o.id === oid);
        if (idx !== -1) {
          orders[idx].status = status;
          if (status === 'DELIVERED' && !orders[idx].completedAt) {
            orders[idx].completedAt = new Date().toISOString();
          }
          count++;
        }
      }
      await dbSet(`bulk_orders_${projectId}`, orders);
      // Update project counts
      const projects = await dbGet('bulk_projects') || [];
      const pIdx = projects.findIndex((p: any) => p.id === projectId);
      if (pIdx !== -1) {
        projects[pIdx].completedOrders = orders.filter((o: any) => o.status === 'DELIVERED' || o.status === 'CLOSED').length;
        await dbSet('bulk_projects', projects);
      }
      res.json({ success: true, updated: count });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // POD for bulk order
  app.post("/api/bulk/orders/:projectId/:orderId/pod", async (req, res) => {
    try {
      const { projectId, orderId } = req.params;
      const { photo, signature, notes, status, driverId, driverName, failureReason } = req.body;
      const orders = await dbGet(`bulk_orders_${projectId}`) || [];
      const idx = orders.findIndex((o: any) => o.id === orderId);
      if (idx === -1) return res.status(404).json({ error: "Order not found" });
      orders[idx] = {
        ...orders[idx],
        confirmationPhoto: photo,
        confirmationSignature: signature,
        driverNotes: notes,
        status: status || 'DELIVERED',
        completedAt: status === 'DELIVERED' ? new Date().toISOString() : orders[idx].completedAt,
        submittedAt: new Date().toISOString(),
        driverId: driverId || orders[idx].driverId,
        driverName: driverName || orders[idx].driverName,
        failureReason: failureReason || undefined,
      };
      await dbSet(`bulk_orders_${projectId}`, orders);
      // Update project counts
      const projects = await dbGet('bulk_projects') || [];
      const pIdx = projects.findIndex((p: any) => p.id === projectId);
      if (pIdx !== -1) {
        projects[pIdx].completedOrders = orders.filter((o: any) => o.status === 'DELIVERED' || o.status === 'CLOSED').length;
        await dbSet('bulk_projects', projects);
      }
      res.json({ success: true, order: orders[idx] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Reschedule a failed bulk order for next business day (or admin override date)
  app.post("/api/bulk/orders/:projectId/:orderId/reschedule", async (req, res) => {
    try {
      const { projectId, orderId } = req.params;
      const { overrideDate } = req.body; // optional admin override
      const orders = await dbGet(`bulk_orders_${projectId}`) || [];
      const idx = orders.findIndex((o: any) => o.id === orderId);
      if (idx === -1) return res.status(404).json({ error: "Order not found" });
      const nextDate = overrideDate || nextBusinessDay(new Date());
      // Create a 2nd attempt copy
      const original = orders[idx];
      const secondAttempt = {
        ...original,
        id: `${original.id}_2nd`,
        orderNumber: `${original.orderNumber}-R`,
        status: 'SECOND_ATTEMPT',
        attemptNumber: 2,
        originalOrderId: original.id,
        deliveryDate: nextDate,
        rescheduledDate: nextDate,
        confirmationPhoto: undefined,
        confirmationSignature: undefined,
        completedAt: undefined,
        submittedAt: undefined,
        failureReason: undefined,
        failureNotes: undefined,
        failurePhoto: undefined,
        driverNotes: undefined,
        createdAt: new Date().toISOString(),
      };
      orders.push(secondAttempt);
      // Mark original as CLOSED
      orders[idx].status = 'CLOSED';
      orders[idx].adminNotes = (orders[idx].adminNotes || '') + `\n[${new Date().toLocaleString()}] Rescheduled to ${nextDate}`;
      await dbSet(`bulk_orders_${projectId}`, orders);
      // Update project totals
      const projects = await dbGet('bulk_projects') || [];
      const pIdx = projects.findIndex((p: any) => p.id === projectId);
      if (pIdx !== -1) {
        projects[pIdx].totalOrders = orders.filter((o: any) => o.status !== 'CLOSED' || o.attemptNumber === 1).length;
        projects[pIdx].completedOrders = orders.filter((o: any) => o.status === 'DELIVERED').length;
        await dbSet('bulk_projects', projects);
      }
      res.json({ success: true, rescheduledOrder: secondAttempt, nextDate });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── DEBUG: check bulk seed status ──────────────────────────────────────────
  app.get('/api/debug/bulk', async (_req, res) => {
    try {
      const projects = await dbGet('bulk_projects');
      const orders = await dbGet('bulk_orders_proj_berkowitz_2026');
      const orderCount = Array.isArray(orders) ? orders.length : 0;
      const seedCount = BERKOWITZ_SEED_ORDERS.length;
      const dbConnected = !!pool;
      res.json({ dbConnected, projects, orderCount, seedCount, sampleOrder: orders?.[0] || null });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── DEBUG: raw order attributes ──────────────────────────────────────────────
  // Raw Shopify order lookup — original date, tags, full timeline
  app.get('/api/order-raw/:orderNum', async (req, res) => {
    if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) return res.json({ error: 'Shopify not configured' });
    try {
      const num = req.params.orderNum.replace(/^#+/, '');
      const resp = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders.json?name=%23${num}&status=any&limit=5`, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
      });
      const data = await resp.json();
      const order = data.orders?.[0];
      if (!order) return res.json({ error: 'Order not found' });

      // Pull order events (timeline)
      const evResp = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${order.id}/events.json?limit=50`, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
      });
      const evData = await evResp.json();

      // Extract all line item properties (where delivery date lives)
      const allProps: any[] = [];
      for (const item of (order.line_items || [])) {
        for (const prop of (item.properties || [])) {
          allProps.push({ item: item.name, key: prop.name, value: prop.value });
        }
      }

      // Extract st_ tags
      const tags = (order.tags || '').split(',').map((t: string) => t.trim()).filter((t: string) => t.startsWith('st_'));

      res.json({
        orderNumber: order.name,
        id: order.id,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        lineItemProperties: allProps,
        stTags: tags,
        allTags: order.tags,
        timeline: (evData.events || []).map((e: any) => ({
          timestamp: e.created_at,
          author: e.author,
          message: (e.message || '').replace(/<[^>]+>/g, '').trim(),
        }))
      });
    } catch (err) {
      res.json({ error: String(err) });
    }
  });

  app.get('/api/debug/order-attrs/:orderNum', async (req, res) => {
    try {
      const num = req.params.orderNum;
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders.json?name=${encodeURIComponent(num)}&status=any&limit=5`;
      const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } });
      const data = await resp.json();
      const order = data.orders?.[0];
      if (!order) return res.json({ error: 'Order not found' });

      // Also fetch fulfillment orders which contain delivery_method.additional_information
      let fulfillmentOrders = null;
      try {
        const foUrl = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${order.id}/fulfillment_orders.json`;
        const foResp = await fetch(foUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } });
        const foData = await foResp.json();
        fulfillmentOrders = foData.fulfillment_orders;
      } catch (e) { fulfillmentOrders = { error: String(e) }; }

      res.json({
        name: order.name,
        note: order.note,
        note_attributes: order.note_attributes,
        shipping_lines: order.shipping_lines,
        fulfillment_orders: fulfillmentOrders,
        tags: order.tags,
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── MANUAL ORDERS ───────────────────────────────────────────────────────────

  app.get('/api/manual-orders', async (_req, res) => {
    try {
      const orders = await dbGet('manual_orders') || [];
      res.json({ orders });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/manual-orders', async (req, res) => {
    try {
      const orders = await dbGet('manual_orders') || [];
      const now = new Date().toISOString();
      const id = `manual_${Date.now()}`;
      const order = {
        id,
        orderNumber: req.body.orderNumber || `M-${Date.now().toString().slice(-5)}`,
        isManual: true,
        customer: {
          name: req.body.recipientName || '',
          phone: req.body.recipientPhone || '',
          email: req.body.recipientEmail || '',
        },
        address: {
          street: req.body.street || '',
          unit: req.body.unit || '',
          company: req.body.company || '',
          city: req.body.city || '',
          zip: req.body.zip || '',
          lat: 0,
          lng: 0,
        },
        items: [{
          id: 'manual_item_1',
          name: req.body.itemDescription || 'Manual Order',
          quantity: 1,
          sku: '',
          price: parseFloat(req.body.orderTotal) || 0,
        }],
        deliveryInstructions: req.body.deliveryInstructions || '',
        status: req.body.status || 'PENDING',
        deliveryDate: req.body.deliveryDate || new Date().toISOString().split('T')[0],
        priority: req.body.priority || 'Standard',
        deliveryFee: parseFloat(req.body.deliveryFee) || 0,
        driverId: req.body.driverId && req.body.driverId !== '' ? req.body.driverId : 'manager_1',
        driverName: req.body.driverName && req.body.driverName !== '' ? req.body.driverName : 'Katie',
        giftMessage: req.body.giftMessage || '',
        giftSenderName: req.body.giftSenderName || '',
        giftSenderPhone: req.body.giftSenderPhone || '',
        giftReceiverName: req.body.recipientName || '',
        orderTotal: parseFloat(req.body.orderTotal) || 0,
        attempts: [],
        internalNotes: [],
        createdAt: now,
      };
      orders.push(order);
      await dbSet('manual_orders', orders);
      res.json({ success: true, order });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.patch('/api/manual-orders/:id', async (req, res) => {
    try {
      const orders = await dbGet('manual_orders') || [];
      const idx = orders.findIndex((o: any) => o.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      orders[idx] = { ...orders[idx], ...req.body };
      await dbSet('manual_orders', orders);
      res.json({ success: true, order: orders[idx] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.delete('/api/manual-orders/:id', async (req, res) => {
    try {
      const orders = await dbGet('manual_orders') || [];
      const filtered = orders.filter((o: any) => o.id !== req.params.id);
      await dbSet('manual_orders', filtered);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── STATIC / VITE ───────────────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`🍫 Sweet Tooth Driver App on http://localhost:${PORT}`));
}

startServer();
