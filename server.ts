import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import pkg from 'pg';
const { Pool } = pkg;

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
function writeUsers(u: any[]) {
  try { fs.writeFileSync(USERS_PATH, JSON.stringify(u, null, 2)); } catch {}
  dbSet('users', u); // also persist to DB
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
    writeUsers(users);
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
    writeUsers(users);
    const { pin: _, ...safeUser } = newUser;
    res.json({ user: safeUser });
  });

  app.patch("/api/users/:id", async (req, res) => {
    const users = await readUsersDB();
    const idx = users.findIndex((u: any) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    users[idx] = { ...users[idx], ...req.body };
    writeUsers(users);
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
    writeUsers(users);
    res.json({ success: true });
  });

  // ── ORDERS ──────────────────────────────────────────────────────────────────

  app.get("/api/orders", async (_req, res) => {
    try {
      // Fetch ALL open orders with local delivery shipping method
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders.json?status=any&limit=250`;
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
      const podData = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));

      // Restore status/completedAt from Shopify tags (survives server restarts)
      const ordersWithTags = (filtered.length > 0 ? filtered : allOrders).map((o: any) => {
        const tagsList = (o.tags || '').split(',').map((t: string) => t.trim());
        const statusTag = tagsList.find((t: string) => t.startsWith('st_status:'));
        const completedTag = tagsList.find((t: string) => t.startsWith('st_completed:'));
        const driverTag = tagsList.find((t: string) => t.startsWith('st_driver:'));
        const driverNameTag = tagsList.find((t: string) => t.startsWith('st_drivername:'));
        if (statusTag) o._st_status = statusTag.replace('st_status:', '');
        if (completedTag) o._st_completedAt = completedTag.replace('st_completed:', '').replace(/-(?=\d{2}-\d{2}[T ])/g, ':');
        if (driverTag) o._st_driverId = driverTag.replace('st_driver:', '');
        if (driverNameTag) o._st_driverName = driverNameTag.replace('st_drivername:', '');
        return o;
      });

      console.log(`Shopify: ${allOrders.length} total, ${(filtered.length > 0 ? filtered : allOrders).length} local delivery`);
      res.json({ orders: ordersWithTags, podData });
    } catch (e) {
      console.error('Orders fetch error:', e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.patch("/api/orders/:id/assign", (req, res) => {
    const { driverId, driverName } = req.body;
    const pod = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    if (!pod[req.params.id]) pod[req.params.id] = {};
    pod[req.params.id].driverId = driverId;
    pod[req.params.id].driverName = driverName;
    fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(pod, null, 2));
    res.json({ success: true });
  });

  app.patch("/api/orders/:id/status", (req, res) => {
    const { status } = req.body;
    const pod = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    if (!pod[req.params.id]) pod[req.params.id] = {};
    pod[req.params.id].status = status;
    if (status === 'DELIVERED' && !pod[req.params.id].completedAt) {
      pod[req.params.id].completedAt = new Date().toISOString();
    }
    fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(pod, null, 2));
    res.json({ success: true });
  });

  app.post("/api/orders/:id/note", (req, res) => {
    const { note } = req.body;
    const pod = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    if (!pod[req.params.id]) pod[req.params.id] = {};
    const existing = pod[req.params.id].adminNotes || '';
    pod[req.params.id].adminNotes = existing
      ? `${existing}\n[${new Date().toLocaleString()}] ${note}`
      : `[${new Date().toLocaleString()}] ${note}`;
    fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(pod, null, 2));
    res.json({ success: true });
  });

  // Edit contact/address info (admin: all except rate; super_admin: everything)
  app.patch("/api/orders/:id/edit", (req, res) => {
    const { customer, address, giftReceiverName, giftSenderName, giftSenderPhone, deliveryFee } = req.body;
    const pod = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    if (!pod[req.params.id]) pod[req.params.id] = {};
    if (customer) pod[req.params.id].customer = customer;
    if (address) pod[req.params.id].address = address;
    if (giftReceiverName !== undefined) pod[req.params.id].giftReceiverName = giftReceiverName;
    if (giftSenderName !== undefined) pod[req.params.id].giftSenderName = giftSenderName;
    if (giftSenderPhone !== undefined) pod[req.params.id].giftSenderPhone = giftSenderPhone;
    if (deliveryFee !== undefined) pod[req.params.id].deliveryFee = deliveryFee;
    fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(pod, null, 2));
    res.json({ success: true });
  });

  // ── DEBUG: see raw order statuses ──────────────────────────────────────────
  app.get('/api/debug/orders', async (req, res) => {
    try {
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders.json?status=any&limit=50`;
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

  app.post("/api/pod", async (req, res) => {
    const { orderId, photo, signature, notes, completedAt, status, driverId, driverName, failureReason } = req.body;
    try {
      const pod = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
      pod[orderId] = { ...pod[orderId], photo, signature, notes, completedAt, submittedAt: new Date().toISOString(), status, driverId, driverName, failureReason };
      fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(pod, null, 2));

      // Write status + completedAt back to Shopify as order tags so it survives server restarts
      if (SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN && status === 'DELIVERED') {
        try {
          // Get existing tags first
          const existing = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders/${orderId}.json?fields=tags`, {
            headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
          });
          const existingData = await existing.json();
          const currentTags = existingData.order?.tags || '';
          const tagsList = currentTags.split(',').map((t: string) => t.trim()).filter((t: string) => t && !t.startsWith('st_status:') && !t.startsWith('st_completed:') && !t.startsWith('st_driver:') && !t.startsWith('st_drivername:'));
          tagsList.push(`st_status:DELIVERED`);
          tagsList.push(`st_completed:${(completedAt || new Date().toISOString()).replace(/:/g,'-')}`);
          if (driverId) tagsList.push(`st_driver:${driverId}`);
          if (driverName) tagsList.push(`st_drivername:${driverName.replace(/,/g, '')}`);
          await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders/${orderId}.json`, {
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
  app.post("/api/reschedule/auto", (req, res) => {
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
    const pod = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    pod[rescheduledOrder.id] = {
      rescheduledOrder,
      createdAt: new Date().toISOString(),
      type: 'SECOND_ATTEMPT'
    };
    fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(pod, null, 2));
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
      const pod = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
      if (!pod[order.id]) pod[order.id] = {};
      pod[order.id][type === 'SUCCESS' ? 'successNotificationSent' : 'failureNotificationSent'] = true;
      fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(pod, null, 2));
      // Log the message
      appendMessageLog({
        id: `msg_${Date.now()}`,
        sentAt: new Date().toISOString(),
        type,
        channel,
        to: phone || email || '',
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

  // ── TEST NOTIFICATION ────────────────────────────────────────────────────
  app.post("/api/notify/test", async (req, res) => {
    const { to } = req.body;
    const message = "Test from The Sweet Tooth Driver App — email notifications are working! 🍫";
    const sent = await sendEmail(to, "Sweet Tooth App — Test Notification", message);
    res.json({ sent, message, channel: 'Email' });
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

// DEBUG endpoint — shows raw note_attributes for first 3 orders
