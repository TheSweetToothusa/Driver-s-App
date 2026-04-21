import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import pkg from 'pg';
const { Pool } = pkg;
import nodemailer from 'nodemailer';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

config({ path: '.env.local' });

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

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
  ssl: { rejectUnauthorized: false },
  max: 5, // Limit connections to reduce memory
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true, // TCP keepalive — prevents network from silently killing idle connections
}) : null;

// Handle pool errors on idle clients — without this, an error on an idle
// connection can crash the process or leave the pool in a bad state.
if (pool) {
  pool.on('error', (err) => {
    console.error('pg pool idle client error (will recover):', err.message);
  });
}

// Retry wrapper for transient Postgres connection errors.
// Render's shared Postgres shows sustained outages lasting several seconds,
// so we retry up to 5 times with exponential backoff across ~9 seconds total.
// That catches the vast majority of outages we observe in production.
async function withDbRetry<T>(op: () => Promise<T>, label: string, retries = 5): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await op();
    } catch (e: any) {
      lastErr = e;
      const code = e?.code || '';
      const msg = e?.message || '';
      const retryable =
        ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH',
         '57P01', '57P02', '57P03', '08000', '08003', '08006'].includes(code) ||
        /terminat|closed|timeout|connection/i.test(msg);
      if (!retryable || i === retries) throw e;
      // Backoff schedule: 250, 600, 1200, 2500, 4500 ms (total ~9 sec)
      const delays = [250, 600, 1200, 2500, 4500];
      const delay = delays[i] ?? 4500;
      console.warn(`[${label}] DB transient error (${code || 'unknown'}), retry ${i + 1}/${retries} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// --- Cloudflare R2 (S3-compatible object storage for POD photos/signatures) ---
// Photos are uploaded to R2 as binary objects; only the key is stored in Postgres.
// This moves 2-3 MB photo writes off the database entirely.
const R2 = (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;
const R2_BUCKET = process.env.R2_BUCKET || 'sweet-tooth-pod-photos';
if (R2) console.log(`R2 configured: bucket=${R2_BUCKET}`);
else console.log('R2 not configured — photos will remain in DB (legacy mode)');

// Upload a base64 data URL ("data:image/jpeg;base64,...") to R2. Returns the R2 key
// on success, or null on failure. Does NOT throw — caller decides how to handle failure.
async function uploadToR2(dataUrl: string, key: string): Promise<string | null> {
  if (!R2 || !dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  try {
    await R2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    console.log(`R2 upload OK: ${key} (${buffer.length} bytes, ${contentType})`);
    return key;
  } catch (e: any) {
    console.error(`R2 upload error for key ${key}:`, e?.message || e);
    return null;
  }
}

// --- File paths (fallback if no DB) ---
const POD_STORAGE_PATH = path.join(__dirname, "pod_data.json");
const USERS_PATH = path.join(__dirname, "users.json");
const RESCHEDULE_PATH = path.join(__dirname, "reschedule_queue.json");

// --- Initialize file storage fallbacks ---
if (!fs.existsSync(POD_STORAGE_PATH)) fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify({}));
if (!fs.existsSync(RESCHEDULE_PATH)) fs.writeFileSync(RESCHEDULE_PATH, JSON.stringify([]));

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

// Lightweight version - strips photo/signature data to prevent memory issues
async function readPodDataLight(): Promise<Record<string, any>> {
  if (pool) {
    try {
      // Memory optimization: Use PostgreSQL to extract only the fields we need
      // This avoids loading large base64 photo/signature data into Node memory
      const r = await pool.query(`
        SELECT 
          REPLACE(key, 'pod:', '') as order_id,
          value::jsonb->>'status' as status,
          value::jsonb->>'completedAt' as completed_at,
          value::jsonb->>'submittedAt' as submitted_at,
          value::jsonb->>'driverId' as driver_id,
          value::jsonb->>'driverName' as driver_name,
          COALESCE(value::jsonb->>'driverNotes', value::jsonb->>'notes') as driver_notes,
          value::jsonb->>'failureReason' as failure_reason,
          value::jsonb->>'successNotificationSent' as success_sent,
          value::jsonb->>'failureNotificationSent' as failure_sent,
          (value::jsonb->>'photo' IS NOT NULL OR value::jsonb->>'confirmationPhoto' IS NOT NULL OR value::jsonb->>'photoR2Key' IS NOT NULL) as has_photo,
          (value::jsonb->>'signature' IS NOT NULL OR value::jsonb->>'confirmationSignature' IS NOT NULL OR value::jsonb->>'signatureR2Key' IS NOT NULL) as has_signature,
          value::jsonb->>'photoR2Key' as photo_r2_key,
          value::jsonb->>'signatureR2Key' as signature_r2_key,
          value::jsonb->>'adminNotes' as admin_notes
        FROM kv_store 
        WHERE key LIKE 'pod:%'
      `);
      const result: Record<string, any> = {};
      for (const row of r.rows) {
        // If photo/signature lives in R2, expose the proxy URL so the list view
        // can render thumbnails without needing to open each order individually.
        // Only include these keys when R2 keys exist — if we set them to undefined,
        // the spread merge in shopifyService would overwrite real base64 values.
        const entry: any = {
          status: row.status,
          completedAt: row.completed_at,
          submittedAt: row.submitted_at,
          driverId: row.driver_id,
          driverName: row.driver_name,
          driverNotes: row.driver_notes,
          failureReason: row.failure_reason,
          successNotificationSent: row.success_sent === 'true',
          failureNotificationSent: row.failure_sent === 'true',
          hasPhoto: row.has_photo,
          hasSignature: row.has_signature,
          adminNotes: row.admin_notes || undefined,
        };
        if (row.photo_r2_key) entry.confirmationPhoto = `/api/pod/${row.order_id}/photo`;
        if (row.signature_r2_key) entry.confirmationSignature = `/api/pod/${row.order_id}/signature`;
        result[row.order_id] = entry;
      }
      return result;
    } catch(e) { console.error('readPodDataLight DB error:', e); }
  }
  return {};
}

async function readPodOrder(orderId: string): Promise<any> {
  if (pool) {
    try {
      const r = await withDbRetry(
        () => pool.query('SELECT value FROM kv_store WHERE key=$1', [`pod:${orderId}`]),
        `readPodOrder:${orderId}`
      );
      return r.rows[0] ? JSON.parse(r.rows[0].value) : {};
    } catch (e) {
      console.error('readPodOrder DB error (after retries):', (e as any)?.message);
      return {};
    }
  }
  try {
    const all = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    return all[orderId] || {};
  } catch { return {}; }
}

async function writePodOrder(orderId: string, data: any): Promise<boolean> {
  let dbSuccess = false;
  // Always write to DB (with retry on transient connection errors)
  if (pool) {
    try {
      await withDbRetry(() => pool.query(
        'INSERT INTO kv_store(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()',
        [`pod:${orderId}`, JSON.stringify(data)]
      ), `writePodOrder:${orderId}`);
      dbSuccess = true;
    } catch(e) { console.error('writePodOrder DB error (after retries):', e); }
  }
  // Also write to file as fallback
  try {
    const all = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    all[orderId] = data;
    fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(all, null, 2));
  } catch {}
  return dbSuccess;
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
      { id: "super_admin", name: "Mike", pin: "1979", role: "SUPER_ADMIN", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() },
      { id: "manager_1", name: "Katie", pin: "4070", role: "MANAGER", phone: "3059944070", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() }
    ]);
    console.log('Default users seeded');
  } else {
    // Always ensure core accounts are unlocked and have correct PINs
    const users = existing;
    let changed = false;
    const mikey = users.find((u: any) => u.id === 'super_admin');
    const katie = users.find((u: any) => u.id === 'manager_1');
    if (mikey && mikey.name !== 'Mike') {
      mikey.name = 'Mike'; changed = true;
    }
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
}

if (!fs.existsSync(USERS_PATH)) {
  fs.writeFileSync(USERS_PATH, JSON.stringify([
    { id: "super_admin", name: "Mike", pin: "1979", role: "SUPER_ADMIN", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() },
    { id: "manager_1", name: "Katie", pin: "4070", role: "MANAGER", phone: "3059944070", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() }
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
function readRescheduleQueue() { return JSON.parse(fs.readFileSync(RESCHEDULE_PATH, 'utf-8')); }
function writeRescheduleQueue(q: any[]) { fs.writeFileSync(RESCHEDULE_PATH, JSON.stringify(q, null, 2)); }

// --- PostgreSQL-backed message log (persists across deploys) ---
async function getMessageLog(): Promise<any[]> {
  const val = await getKV('message_log');
  if (val) { try { return JSON.parse(val); } catch { return []; } }
  return [];
}
async function appendMessageLogDB(entry: any): Promise<void> {
  const log = await getMessageLog();
  log.unshift(entry);
  await setKV('message_log', JSON.stringify(log.slice(0, 500)));
}

// --- PostgreSQL-backed templates (persists across deploys) ---
const DEFAULT_TEMPLATES = [
  { id: 'SUCCESS', label: 'Delivery Successful', body: 'Hi {{customer_name}}! 🍫 Great news — your Sweet Tooth order #{{order_number}} was just delivered to {{address}}. We hope whoever receives it loves it! Thank you for choosing The Sweet Tooth.' },
  { id: 'FAILURE', label: 'Delivery Attempted – Please Reschedule', body: 'Hi {{customer_name}}, this is {{driver_name}} with your Sweet Tooth delivery. We attempted to deliver your order to {{address}}, but were unsuccessful because: {{failure_reason}}.\n\nDriver Note: {{driver_notes}}\n\nPlease text our manager Katie at {{katie_phone}} to reschedule. Thanks!' }
];
async function getTemplates(): Promise<any[]> {
  const val = await getKV('notification_templates');
  if (val) { try { return JSON.parse(val); } catch { return DEFAULT_TEMPLATES; } }
  return DEFAULT_TEMPLATES;
}
async function saveTemplates(templates: any[]): Promise<void> {
  await setKV('notification_templates', JSON.stringify(templates));
}

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

async function sendEmail(to: string, subject: string, body: string, attachmentBase64?: string, attachmentFilename?: string): Promise<boolean> {
  // Configurable SMTP - works with any provider
  const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
  const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
  const SMTP_USER = process.env.SMTP_USER || 'orders@thesweettooth.com';
  const SMTP_PASS = process.env.SMTP_PASS || '';
  
  if (!SMTP_PASS) {
    console.log('❌ SMTP_PASS not configured');
    return false;
  }
  
  console.log(`📧 Attempting to send email via ${SMTP_HOST}:${SMTP_PORT} as ${SMTP_USER}`);
  
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });
    
    const mailOptions: any = {
      from: `"The Sweet Tooth" <${SMTP_USER}>`,
      to: to,
      bcc: 'orders@thesweettooth.com',
      subject: subject,
      text: body
    };
    
    // Attach POD photo if provided
    if (attachmentBase64 && attachmentFilename) {
      // Strip data URL prefix if present
      const base64Data = attachmentBase64.replace(/^data:image\/\w+;base64,/, '');
      mailOptions.attachments = [{
        filename: attachmentFilename,
        content: base64Data,
        encoding: 'base64'
      }];
      console.log(`📎 Attaching photo: ${attachmentFilename}`);
    }
    
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}`);
    return true;
  } catch (err: any) {
    console.log(`❌ SMTP error: ${err.message || err}`);
    return false;
  }
}

// Memory helper
function getMemoryMB() {
  const used = process.memoryUsage();
  return {
    heapUsed: Math.round(used.heapUsed / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    rss: Math.round(used.rss / 1024 / 1024),
  };
}

async function startServer() {
  try {
    await initDB();
  } catch (e) {
    console.error('⚠️ initDB failed — server starting without DB init. DB writes/reads will retry on each request.', e);
  }
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  app.use(express.json({ limit: '10mb' })); // Reduced from 50mb to prevent memory spikes
  
  // Log memory usage every 5 minutes
  setInterval(() => {
    const mem = getMemoryMB();
    console.log(`[MEM] heap=${mem.heapUsed}/${mem.heapTotal}MB rss=${mem.rss}MB`);
  }, 300000);

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

  // ── HEALTH CHECK (keeps server warm) ───────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    const mem = getMemoryMB();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), memory: mem });
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
      // Use lightweight POD loader - never loads photos into memory
      const podData = await readPodDataLight();

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

      const ordersToProcess = ordersWithTags.length > 0 ? ordersWithTags : (filtered.length > 0 ? filtered : allOrders);

      // podData is already lightweight (no photos) from readPodDataLight()
      res.json({ orders: ordersToProcess, podData });
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
        // If photo/signature is in R2, expose a proxy URL the frontend can use as <img src>.
        // Keep legacy base64 data URLs working too.
        if (pod.photoR2Key && !pod.confirmationPhoto) {
          pod.confirmationPhoto = `/api/pod/${req.params.orderId}/photo`;
          pod.photo = pod.confirmationPhoto;
        }
        if (pod.signatureR2Key && !pod.confirmationSignature) {
          pod.confirmationSignature = `/api/pod/${req.params.orderId}/signature`;
          pod.signature = pod.confirmationSignature;
        }
        res.json({ pod });
      } else {
        res.json({ pod: null });
      }
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Proxy endpoints: stream photo/signature from R2. Keeps bucket private.
  async function streamR2Object(res: express.Response, key: string) {
    if (!R2) { res.status(404).end(); return; }
    try {
      const obj = await R2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      res.setHeader('Content-Type', obj.ContentType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      (obj.Body as any).pipe(res);
    } catch (e: any) {
      console.error(`R2 fetch error for ${key}:`, e?.message || e);
      res.status(404).end();
    }
  }
  app.get("/api/pod/:orderId/photo", async (req, res) => {
    const pod = await readPodOrder(req.params.orderId);
    if (!pod?.photoR2Key) { res.status(404).end(); return; }
    await streamR2Object(res, pod.photoR2Key);
  });
  app.get("/api/pod/:orderId/signature", async (req, res) => {
    const pod = await readPodOrder(req.params.orderId);
    if (!pod?.signatureR2Key) { res.status(404).end(); return; }
    await streamR2Object(res, pod.signatureR2Key);
  });

  app.post("/api/pod", async (req, res) => {
    const { orderId, photo, signature, notes, completedAt, status, driverId, driverName, failureReason, isManual, customerEmail, giftReceiverName, giftSenderName, address, orderNumber } = req.body;

    // DEBUG: Log what photo data is received
    console.log(`📷 POD POST for ${orderId}: photo=${photo ? `YES (${photo.length} chars, starts: ${photo.substring(0,30)}...)` : 'NO'}, status=${status}`);

    try {
      const existingPod = await readPodOrder(orderId);

      // Upload new photo/signature to R2 if configured and we got base64 data.
      // If R2 upload fails, we fall back to storing base64 in the DB (legacy path).
      let photoR2Key: string | null = existingPod.photoR2Key || null;
      let signatureR2Key: string | null = existingPod.signatureR2Key || null;
      let newPhotoBase64: string | null = null;
      let newSignatureBase64: string | null = null;

      if (photo && typeof photo === 'string' && photo.startsWith('data:')) {
        if (R2) {
          const key = `photos/${orderId}/${Date.now()}.jpg`;
          const uploaded = await uploadToR2(photo, key);
          if (uploaded) {
            photoR2Key = uploaded;
          } else {
            // R2 upload failed — fall back to base64 in DB so we don't lose it
            console.warn(`R2 photo upload failed for ${orderId}, falling back to DB base64`);
            newPhotoBase64 = photo;
          }
        } else {
          newPhotoBase64 = photo;
        }
      }

      if (signature && typeof signature === 'string' && signature.startsWith('data:')) {
        if (R2) {
          const key = `signatures/${orderId}/${Date.now()}.png`;
          const uploaded = await uploadToR2(signature, key);
          if (uploaded) {
            signatureR2Key = uploaded;
          } else {
            console.warn(`R2 signature upload failed for ${orderId}, falling back to DB base64`);
            newSignatureBase64 = signature;
          }
        } else {
          newSignatureBase64 = signature;
        }
      }

      // Resolve final photo/signature fields — prefer R2 keys, then new base64, then existing
      // When using R2, clear the base64 fields so we don't double-store.
      const finalPhoto = photoR2Key ? null : (newPhotoBase64 || existingPod.photo || existingPod.confirmationPhoto || null);
      const finalSignature = signatureR2Key ? null : (newSignatureBase64 || existingPod.signature || existingPod.confirmationSignature || null);

      const updated = {
        ...existingPod,
        photo: finalPhoto,
        signature: finalSignature,
        confirmationPhoto: finalPhoto,
        confirmationSignature: finalSignature,
        photoR2Key,
        signatureR2Key,
        notes,
        driverNotes: notes || null,
        completedAt,
        submittedAt: new Date().toISOString(),
        status,
        driverId,
        driverName,
        failureReason
      };
      const podSaved = await writePodOrder(orderId, updated);
      if (!podSaved) {
        // DB write failed. Do NOT abort — the driver did their job and the gift sender
        // still needs to be notified. The file fallback in writePodOrder captured the
        // record on this server instance; the photo is also on the driver's phone.
        console.error(`⚠️ POD DB write failed for ${orderId} — continuing with Shopify tag + customer email anyway`);
      }

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

        // Add POD note to Shopify order (visible in order timeline)
        try {
          const deliveryTime = new Date(completedAt || Date.now()).toLocaleString('en-US', { 
            timeZone: 'America/New_York',
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true 
          });
          const noteText = `📦✅ DELIVERED — ${deliveryTime}\nDriver: ${driverName || 'Unknown'}${notes ? `\nNote: ${notes}` : ''}${photo ? '\n📷 POD photo attached (timestamped)' : ''}${signature ? '\n✍️ Signature captured' : ''}`;
          
          await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json`, {
            method: 'PUT',
            headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: { id: orderId, note: noteText } })
          });
          console.log(`POD note added to Shopify order ${orderId}`);
        } catch (noteErr) {
          console.error('Failed to add POD note to Shopify (non-fatal):', noteErr);
        }
      }

      // ── AUTO-SEND DELIVERY CONFIRMATION EMAIL WITH PHOTO ───────────────────────────────
      const SMTP_PASS = process.env.SMTP_PASS || '';
      // Log why email might not be sent
      if (status === 'DELIVERED') {
        if (!customerEmail) console.log(`📧 No email for order ${orderId} — cannot send POD confirmation`);
        else if (!SMTP_PASS) console.log(`📧 SMTP_PASS not set — cannot send POD confirmation to ${customerEmail}`);
        else console.log(`📧 Attempting to send POD email to ${customerEmail} for order ${orderId}`);
      }
      if (status === 'DELIVERED' && customerEmail && SMTP_PASS) {
        try {
          const deliveryTime = new Date(completedAt || Date.now()).toLocaleString('en-US', { 
            timeZone: 'America/New_York',
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true 
          });
          
          const receiverName = giftReceiverName || 'the recipient';
          
          const subject = `Your Sweet Tooth gift has been delivered! (Order ${orderNumber || orderId})`;
          const body = `Good news! Your gift to ${receiverName} has been delivered.

Delivered: ${deliveryTime}

${photo ? 'Please see attached proof of delivery photo.' : 'Proof of delivery photo is available upon request.'}

Thank you for choosing The Sweet Tooth!`;

          const emailSent = await sendEmail(customerEmail, subject, body, photo || undefined, photo ? `delivery-${orderId}.jpg` : undefined);
          if (emailSent) {
            console.log(`✅ Auto-sent delivery confirmation to ${customerEmail} for order ${orderId}${photo ? ' (with photo)' : ''}`);
          } else {
            console.log(`⚠️ Failed to auto-send confirmation to ${customerEmail} for order ${orderId}`);
          }
        } catch (emailErr) {
          console.error('Auto-send email error (non-fatal):', emailErr);
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

  app.get("/api/templates", async (_req, res) => {
    res.json({ templates: await getTemplates() });
  });

  app.patch("/api/templates/:id", async (req, res) => {
    const templates = await getTemplates();
    const idx = templates.findIndex((t: any) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    templates[idx] = { ...templates[idx], ...req.body };
    await saveTemplates(templates);
    res.json({ template: templates[idx] });
  });

  // ── NOTIFY ──────────────────────────────────────────────────────────────────

  app.post("/api/notify/preview", async (req, res) => {
    const { type, order, failureReason, driverNotes } = req.body;
    const templates = await getTemplates();
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
    const templates = await getTemplates();
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
      await appendMessageLogDB({
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

  app.get("/api/messages", async (_req, res) => {
    res.json({ messages: await getMessageLog() });
  });

  // ── CONFIG STATUS — shows which integrations are active ──────────────────
  app.get("/api/config/status", (_req, res) => {
    const SMTP_PASS = process.env.SMTP_PASS || '';
    const SMTP_USER = process.env.SMTP_USER || 'orders@thesweettooth.com';
    const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
    res.json({
      sendgrid: !!SENDGRID_API_KEY,
      sendgridFrom: SENDGRID_FROM_EMAIL || null,
      smtpConfigured: !!SMTP_PASS,
      smtpUser: SMTP_USER,
      smtpHost: SMTP_HOST,
      emailReady: !!SMTP_PASS,
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

  // ── BULK SEND POD EMAILS (one-time catch-up for delivered orders) ───────────
  app.post("/api/notify/bulk-pod", async (req, res) => {
    const { orders } = req.body; // Array of { email, receiverName, deliveryTime, orderId }
    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'Missing orders array' });
    }
    
    const results: { orderId: string; email: string; sent: boolean }[] = [];
    
    for (const o of orders) {
      // Fetch the POD photo for this order
      const podData = await readPodOrder(o.orderId);
      const photo = podData?.confirmationPhoto || podData?.photo || null;
      
      const subject = "Your Sweet Tooth gift has been delivered!";
      const body = `Good news! Your gift to ${o.receiverName || 'the recipient'} has been delivered.

Delivered: ${o.deliveryTime || 'today'}

${photo ? 'Please see attached proof of delivery photo.' : 'Proof of delivery photo is available upon request.'}

Thank you for choosing The Sweet Tooth!`;
      
      const sent = await sendEmail(o.email, subject, body, photo || undefined, photo ? `delivery-${o.orderId}.jpg` : undefined);
      results.push({ orderId: o.orderId, email: o.email, sent });
      console.log(sent ? `✅ Bulk POD sent to ${o.email}${photo ? ' (with photo)' : ''}` : `❌ Failed to send to ${o.email}`);
    }
    
    const sentCount = results.filter(r => r.sent).length;
    res.json({ success: true, sent: sentCount, total: orders.length, results });
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
  // One-time migration: rename "Mikey" to "Mike" in all POD records and Shopify tags
  app.post('/api/admin/migrate-mikey-to-mike', async (_req, res) => {
    try {
      // 1. Fix all pod: keys in PostgreSQL
      const podRows = await pool.query("SELECT key, value FROM kv_store WHERE key LIKE 'pod:%'");
      let podFixed = 0;
      for (const row of podRows.rows) {
        const data = JSON.parse(row.value);
        if (data.driverName === 'Mikey') {
          data.driverName = 'Mike';
          await pool.query('UPDATE kv_store SET value=$1 WHERE key=$2', [JSON.stringify(data), row.key]);
          podFixed++;
        }
      }

      // 2. Fix manual orders in PostgreSQL
      const manualRaw = await getKV('manual_orders');
      let manualFixed = 0;
      if (manualRaw) {
        const manualOrders = JSON.parse(manualRaw);
        let changed = false;
        for (const o of manualOrders) {
          if (o.driverName === 'Mikey') { o.driverName = 'Mike'; changed = true; manualFixed++; }
          if (o.driverId === 'super_admin' && o.driverName !== 'Mike') { o.driverName = 'Mike'; changed = true; manualFixed++; }
        }
        if (changed) await setKV('manual_orders', JSON.stringify(manualOrders));
      }

      // 3. Fix Shopify tags: find all orders with st_drivername:Mikey and update to Mike
      let shopifyFixed = 0;
      try {
        const shopifyRes = await fetch(
          `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/orders.json?tag=st_drivername:Mikey&status=any&limit=250`,
          { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN || '' } }
        );
        const shopifyData = await shopifyRes.json() as { orders?: any[] };
        const orders = shopifyData.orders || [];
        for (const order of orders) {
          const currentTags: string = order.tags || '';
          const newTags = currentTags
            .split(',')
            .map((t: string) => t.trim())
            .map((t: string) => t === 'st_drivername:Mikey' ? 'st_drivername:Mike' : t)
            .join(', ');
          await fetch(
            `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/orders/${order.id}.json`,
            { method: 'PUT', headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN || '', 'Content-Type': 'application/json' },
              body: JSON.stringify({ order: { id: order.id, tags: newTags } }) }
          );
          shopifyFixed++;
        }
      } catch (shopifyErr) {
        console.error('Shopify tag migration error (non-fatal):', shopifyErr);
      }

      res.json({ ok: true, podFixed, manualFixed, shopifyFixed });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`🍫 Sweet Tooth Driver App on http://localhost:${PORT}`));
}

startServer();
