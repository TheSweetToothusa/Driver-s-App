import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import pkg from 'pg';
const { Pool } = pkg;
import nodemailer from 'nodemailer';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

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

// Load the email-header logo once at startup; we attach it inline (cid:brand-logo)
// on every branded HTML email so it renders even when external images are blocked.
const EMAIL_LOGO_PATH = path.join(__dirname, 'assets', 'email-logo.png');
let EMAIL_LOGO_BASE64: string | null = null;
try {
  if (fs.existsSync(EMAIL_LOGO_PATH)) {
    EMAIL_LOGO_BASE64 = fs.readFileSync(EMAIL_LOGO_PATH).toString('base64');
    console.log(`📨 Loaded email logo (${Math.round(EMAIL_LOGO_BASE64.length / 1024)}KB)`);
  } else {
    console.warn(`📨 Email logo not found at ${EMAIL_LOGO_PATH} — emails will fall back to text wordmark`);
  }
} catch (e: any) {
  console.warn(`📨 Failed to load email logo: ${e?.message || e}`);
}

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

// Check if a Cloudflare key already exists. Used to append -2, -3 etc. for retaken photos.
async function r2KeyExists(key: string): Promise<boolean> {
  if (!R2) return false;
  try {
    await R2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// --- Photo retention: delivery photos are only kept for 7 days ---
// Runs daily (and once on boot). Two jobs:
//   1. Delete Cloudflare objects older than the cutoff (the key embeds the
//      date: photos/2026-04-27/35416.jpg).
//   2. Strip photo/signature data from old pod:* rows directly in SQL — the
//      legacy base64 blobs (2-3 MB each) never enter Node memory. Those blobs
//      are what pushed the Render instance over its memory limit.
// Delivery metadata (who/when/notes) is kept forever; only images are removed.
const POD_PHOTO_RETENTION_DAYS = 7;

async function cleanupOldPodPhotos(): Promise<{ r2Deleted: number; dbRowsStripped: number; errors: string[] }> {
  const summary = { r2Deleted: 0, dbRowsStripped: 0, errors: [] as string[] };
  const cutoffMs = Date.now() - POD_PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffMs).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  const cutoffIso = new Date(cutoffMs).toISOString();

  if (R2) {
    for (const prefix of ['photos/', 'signatures/']) {
      try {
        let token: string | undefined;
        do {
          const page = await R2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token }));
          const oldKeys = (page.Contents || [])
            .map(o => o.Key || '')
            .filter(k => {
              const m = k.match(/^[a-z]+\/(\d{4}-\d{2}-\d{2})\//);
              return !!m && m[1] < cutoffDate;
            });
          if (oldKeys.length > 0) {
            await R2.send(new DeleteObjectsCommand({
              Bucket: R2_BUCKET,
              Delete: { Objects: oldKeys.map(Key => ({ Key })), Quiet: true },
            }));
            summary.r2Deleted += oldKeys.length;
          }
          token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
      } catch (e: any) {
        summary.errors.push(`Cloudflare ${prefix}: ${e?.message || e}`);
      }
    }
  }

  if (pool) {
    try {
      const r = await pool.query(
        `UPDATE kv_store
         SET value = (value::jsonb - 'photo' - 'confirmationPhoto' - 'signature' - 'confirmationSignature' - 'photoR2Key' - 'signatureR2Key')::text,
             updated_at = NOW()
         WHERE key LIKE 'pod:%'
           AND (value::jsonb ->> 'completedAt') ~ '^\\d{4}-\\d{2}-\\d{2}'
           AND (value::jsonb ->> 'completedAt') < $1
           AND value::jsonb ?| array['photo','confirmationPhoto','signature','confirmationSignature','photoR2Key','signatureR2Key']`,
        [cutoffIso]
      );
      summary.dbRowsStripped = r.rowCount || 0;
    } catch (e: any) {
      summary.errors.push(`DB: ${e?.message || e}`);
    }
  }

  console.log(`🧹 Photo retention (${POD_PHOTO_RETENTION_DAYS}d): ${summary.r2Deleted} Cloudflare files deleted, ${summary.dbRowsStripped} DB rows stripped${summary.errors.length ? ' — errors: ' + summary.errors.join('; ') : ''}`);
  return summary;
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
      // DB is configured but unreachable after retries. Return a sentinel so callers
      // that care about atomicity (e.g. /api/pod) can bail with 503 instead of
      // proceeding with a blank existingPod and corrupting idempotency checks.
      // Field-access callers (existing.photo, existing.notes, …) see the sentinel
      // as effectively {} — same behavior as before.
      console.error('readPodOrder DB error (after retries):', (e as any)?.message);
      return { __dbError: true };
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
      { id: "mike_b", name: "Mike", pin: "1979", role: "SUPER_ADMIN", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() },
      { id: "manager_1", name: "Katie", pin: "4070", role: "MANAGER", phone: "3059944070", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() }
    ]);
    console.log('Default users seeded');
  } else {
    // Always ensure core accounts are unlocked and have correct PINs
    const users = existing;
    let changed = false;
    // One-shot rename: SUPER_ADMIN's id "super_admin" collided with the role string,
    // which polluted st_driver: tags during reassignment. Migrate to "mike_b".
    const legacySuper = users.find((u: any) => u.id === 'super_admin');
    if (legacySuper && !users.find((u: any) => u.id === 'mike_b')) {
      legacySuper.id = 'mike_b';
      changed = true;
      console.log('Renamed user id super_admin → mike_b');
    }
    // One-shot cleanup: remove demo seed drivers. "driver_mike" collided by name
    // with the real owner (mike_b) and made the "Viewing: Mike" filter resolve to
    // the wrong account, so Mike's deliveries appeared empty.
    for (const demoId of ['driver_mike', 'driver_smith']) {
      const i = users.findIndex((u: any) => u.id === demoId);
      if (i !== -1) { users.splice(i, 1); changed = true; console.log(`Removed demo driver ${demoId}`); }
    }
    const mikey = users.find((u: any) => u.id === 'mike_b');
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
    { id: "mike_b", name: "Mike", pin: "1979", role: "SUPER_ADMIN", isActive: true, failedAttempts: 0, createdAt: new Date().toISOString() },
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

// Fetch Shopify Local Delivery instructions + phone for a batch of orders.
// Local Delivery stores instructions on FulfillmentOrder.deliveryMethod.additionalInformation,
// which requires the `read_assigned_fulfillment_orders` and
// `read_merchant_managed_fulfillment_orders` scopes on the custom app token.
// Falls back to order metafields under the `shopify_local_delivery` namespace.
// Returns Map<numericOrderId, { instructions, phone }>.
async function fetchLocalDeliveryInfo(
  orderIds: string[]
): Promise<Map<string, { instructions: string; phone: string }>> {
  const result = new Map<string, { instructions: string; phone: string }>();
  if (!orderIds.length || !SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) return result;

  const ids = orderIds.map((id) => `gid://shopify/Order/${id}`);
  const query = `
    query($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          legacyResourceId
          fulfillmentOrders(first: 5) {
            edges { node {
              deliveryMethod {
                methodType
                additionalInformation { instructions phone }
              }
            }}
          }
          metafields(first: 20, namespace: "shopify_local_delivery") {
            edges { node { key value } }
          }
        }
      }
    }`;

  try {
    const resp = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables: { ids } }),
    });
    if (!resp.ok) {
      console.error('Shopify GraphQL FO fetch failed:', resp.status, await resp.text());
      return result;
    }
    const json: any = await resp.json();
    if (json.errors) {
      console.error('Shopify GraphQL FO errors:', JSON.stringify(json.errors));
      return result;
    }
    for (const node of json.data?.nodes || []) {
      if (!node?.legacyResourceId) continue;
      let instructions = '';
      let phone = '';
      for (const edge of node.fulfillmentOrders?.edges || []) {
        const ai = edge?.node?.deliveryMethod?.additionalInformation;
        if (ai?.instructions || ai?.phone) {
          instructions = ai.instructions || instructions;
          phone = ai.phone || phone;
          if (instructions && phone) break;
        }
      }
      // Metafield fallback (only if FO didn't yield instructions/phone)
      for (const edge of node.metafields?.edges || []) {
        const k = (edge?.node?.key || '').toLowerCase();
        const v = edge?.node?.value || '';
        if (!instructions && (k === 'instructions' || k === 'delivery_instructions' || k === 'note')) {
          instructions = v;
        }
        if (!phone && (k === 'phone' || k === 'delivery_phone' || k === 'recipient_phone')) {
          phone = v;
        }
      }
      if (instructions || phone) {
        result.set(String(node.legacyResourceId), { instructions, phone });
      }
    }
  } catch (e) {
    console.error('Shopify GraphQL FO fetch error:', e);
  }
  return result;
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  attachmentBase64?: string,
  attachmentFilename?: string,
  htmlBody?: string,
  inlineCid?: string
): Promise<boolean> {
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
      bcc: ['sandiassist272@gmail.com'],
      subject: subject,
      text: body
    };

    if (htmlBody) {
      mailOptions.html = htmlBody;
    }

    const attachments: any[] = [];

    // Attach POD photo if provided
    if (attachmentBase64 && attachmentFilename) {
      // Strip data URL prefix if present
      const base64Data = attachmentBase64.replace(/^data:image\/\w+;base64,/, '');
      const attachment: any = {
        filename: attachmentFilename,
        content: base64Data,
        encoding: 'base64'
      };
      // When inlineCid is set, the attachment is referenced from the HTML body
      // via <img src="cid:<inlineCid>">. We also mark Content-Disposition: inline
      // explicitly — without this, Gmail in particular will sometimes show the
      // image in the bottom "One attachment" tray instead of where the HTML
      // places it.
      if (inlineCid) {
        attachment.cid = inlineCid;
        attachment.contentDisposition = 'inline';
      }
      attachments.push(attachment);
      console.log(`📎 Attaching photo: ${attachmentFilename}${inlineCid ? ` (inline cid:${inlineCid})` : ''}`);
    }

    // Auto-attach the brand logo inline whenever we're sending HTML. The HTML
    // template references it as <img src="cid:brand-logo">.
    if (htmlBody && EMAIL_LOGO_BASE64) {
      attachments.push({
        filename: 'sweet-tooth-logo.png',
        content: EMAIL_LOGO_BASE64,
        encoding: 'base64',
        cid: 'brand-logo',
        contentDisposition: 'inline'
      });
    }

    if (attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}`);
    return true;
  } catch (err: any) {
    console.log(`❌ SMTP error: ${err.message || err}`);
    return false;
  }
}

// Public base URL of this app — used in outbound email links (review stars, etc.).
// Prefers APP_BASE_URL, then Render's RENDER_EXTERNAL_URL, then the request's host.
function getAppBaseUrl(req?: { protocol?: string; get?: (h: string) => string | undefined }): string {
  const envUrl = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  if (envUrl) return envUrl.replace(/\/$/, '');
  if (req && req.protocol && typeof req.get === 'function') {
    const host = req.get('host');
    if (host) return `${req.protocol}://${host}`;
  }
  return '';
}

function escapeHtmlForEmail(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstNameOf(full: string): string {
  return String(full || '').trim().split(/\s+/)[0] || '';
}

// Mark a Shopify order Fulfilled AND post the "delivered" shipment event.
//
// Fulfilling alone is not enough: with no tracking company and no fulfillment
// event, Shopify's order status page and the Shop app sit on "On its way"
// forever, so customers call us saying the basket never arrived. The delivered
// event is what flips that page to "Delivered".
//
// Idempotent — safe to call on every retry. Best-effort: never throws.
async function markShopifyDelivered(orderId: string): Promise<void> {
  if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) return;
  const api = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01`;
  const auth = { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN };

  try {
    const foResp = await fetch(`${api}/orders/${orderId}/fulfillment_orders.json`, { headers: auth });
    const foData = await foResp.json();
    const openFOs = (foData.fulfillment_orders || []).filter(
      (fo: any) => ['open', 'in_progress', 'scheduled'].includes(fo.status)
    );
    for (const fo of openFOs) {
      const fulResp = await fetch(`${api}/fulfillments.json`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fulfillment: {
            notify_customer: false,
            line_items_by_fulfillment_order: [{ fulfillment_order_id: fo.id }]
          }
        })
      });
      if (fulResp.ok) console.log(`Marked order ${orderId} Fulfilled in Shopify`);
      else console.error(`Fulfillment failed for order ${orderId} (FO ${fo.id}):`, await fulResp.text());
    }
  } catch (err) {
    console.error('Failed to fulfill order in Shopify:', err);
  }

  // Stamping the fulfillment "delivered" is what makes Shopify's order status
  // page say Delivered instead of sitting on "On its way" forever.
  //
  // This was gated off on Aug 6 2026 over a double-email worry. Checked the
  // Shopify admin notification settings on Aug 14 2026: "Order locally
  // delivered", "Order out for local delivery" and "Order missed local
  // delivery" are all switched OFF, so this event sends no Shopify email.
  // Our own POD email is the only one that goes out, and it has its own
  // duplicate guard. If any of those three are ever switched back on in
  // Shopify admin, this will double-email customers again.
  try {
    const fResp = await fetch(`${api}/orders/${orderId}/fulfillments.json`, { headers: auth });
    const fData = await fResp.json();
    for (const f of fData.fulfillments || []) {
      if (f.shipment_status === 'delivered') continue;
      const evResp = await fetch(`${api}/orders/${orderId}/fulfillments/${f.id}/events.json`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { status: 'delivered' } })
      });
      if (evResp.ok) console.log(`Order ${orderId} fulfillment ${f.id} marked Delivered in Shopify`);
      else console.error(`Delivered event failed for order ${orderId} (fulfillment ${f.id}):`, await evResp.text());
    }
  } catch (err) {
    console.error('Failed to post delivered event to Shopify:', err);
  }
}

function buildDeliveryConfirmationEmail(opts: {
  variant: 'gift' | 'self';
  receiverName: string;
  deliveryTime: string;
  orderId: string;
  orderNumber?: string;
  baseUrl: string;
  hasPhoto: boolean;
}): { subject: string; text: string; html: string } {
  const { variant, receiverName, deliveryTime, orderId, orderNumber, baseUrl, hasPhoto } = opts;
  const isGift = variant === 'gift';
  const displayId = String(orderNumber || orderId);
  const firstName = firstNameOf(receiverName) || receiverName || 'your recipient';
  const safeFirstName = escapeHtmlForEmail(firstName);
  const safeTime = escapeHtmlForEmail(deliveryTime);
  const safeDisplayId = escapeHtmlForEmail(displayId);
  const orderSlug = encodeURIComponent(String(orderId));
  // The customer-facing order number rides along on review links so the
  // thank-you page can display the friendly number, not the internal ID.
  const orderNumberQS = orderNumber ? `?n=${encodeURIComponent(String(orderNumber))}` : '';

  const subject = isGift
    ? `🎁 ${firstName} just got your gift — how was your experience?`
    : `Your Sweet Tooth order has arrived — enjoy!`;

  // Header: dark charcoal with the brand wordmark embedded as cid:brand-logo.
  // If the logo failed to load at startup, fall back to plain white text — no
  // fabricated typeface or color. The real logo is the source of truth.
  const headerInner = EMAIL_LOGO_BASE64
    ? `<img src="cid:brand-logo" alt="The Sweet Tooth" width="240" style="display:block;width:240px;max-width:80%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;">`
    : `<div style="font-size:22px;font-weight:700;color:#ffffff;">The Sweet Tooth</div>`;

  const heroHtml = isGift ? `
        <tr>
          <td style="padding:40px 32px 8px 32px;text-align:center;">
            <div style="font-size:24px;font-weight:600;color:#2a2a2a;line-height:1.3;">A sweet moment, just delivered.</div>
            <div style="font-size:16px;color:#666;margin-top:14px;line-height:1.6;">
              ${safeFirstName} just received your gift on<br>
              <strong style="color:#2a2a2a;">${safeTime}</strong>.
            </div>
          </td>
        </tr>` : `
        <tr>
          <td style="padding:40px 32px 8px 32px;text-align:center;">
            <div style="font-size:24px;font-weight:600;color:#2a2a2a;line-height:1.3;">Your order has arrived.</div>
            <div style="font-size:16px;color:#666;margin-top:14px;line-height:1.6;">
              Delivered on <strong style="color:#2a2a2a;">${safeTime}</strong>.
            </div>
            <div style="font-size:16px;color:#666;margin-top:14px;line-height:1.6;">
              Thank you for choosing us. We hope you love every bite.
            </div>
          </td>
        </tr>`;

  const photoRow = hasPhoto ? `
        <tr>
          <td style="padding:24px 32px 16px 32px;text-align:center;">
            <img src="cid:proof-photo" alt="Proof of delivery" style="max-width:100%;height:auto;border-radius:8px;border:1px solid #eee;">
            <div style="font-size:12px;color:#999;margin-top:8px;font-style:italic;">Delivered with care.</div>
          </td>
        </tr>` : '';

  const askHeading = isGift ? 'How was your experience?' : 'How did we do?';
  const subCopy = isGift
    ? `From ordering to delivery — we'd love to know how we did.`
    : `Your words help others find us.`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${isGift ? 'Your gift has been delivered' : 'Your order has been delivered'}</title>
</head>
<body style="margin:0;padding:0;background-color:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2a2a2a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf7f2;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">

        <tr>
          <td align="center" style="background-color:#2a2a2a;padding:32px 24px;">
            ${headerInner}
          </td>
        </tr>
${heroHtml}${photoRow}
        <tr>
          <td style="padding:16px 32px 8px 32px;"><div style="border-top:1px solid #eee;"></div></td>
        </tr>

        <tr>
          <td style="padding:24px 32px 0 32px;text-align:center;">
            <div style="font-size:20px;font-weight:600;color:#2a2a2a;">${askHeading}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:14px 32px 4px 32px;text-align:center;">
            <div style="font-size:13px;font-weight:700;letter-spacing:1.2px;color:#D4AF37;text-transform:uppercase;">👇 Tap a star below to rate 👇</div>
          </td>
        </tr>

        <tr>
          <td style="padding:14px 24px 8px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:6px 0;">
              <tr>
                <td width="20%" align="center" valign="middle" bgcolor="#FFF8E1" style="width:20%;background-color:#FFF8E1;border:2px solid #D4AF37;border-radius:10px;mso-padding-alt:18px 0;">
                  <a href="${baseUrl}/review/${orderSlug}/1${orderNumberQS}" style="display:block;padding:18px 0;font-size:34px;text-decoration:none;line-height:1;color:#D4AF37;">⭐</a>
                </td>
                <td width="20%" align="center" valign="middle" bgcolor="#FFF8E1" style="width:20%;background-color:#FFF8E1;border:2px solid #D4AF37;border-radius:10px;mso-padding-alt:18px 0;">
                  <a href="${baseUrl}/review/${orderSlug}/2${orderNumberQS}" style="display:block;padding:18px 0;font-size:34px;text-decoration:none;line-height:1;color:#D4AF37;">⭐</a>
                </td>
                <td width="20%" align="center" valign="middle" bgcolor="#FFF8E1" style="width:20%;background-color:#FFF8E1;border:2px solid #D4AF37;border-radius:10px;mso-padding-alt:18px 0;">
                  <a href="${baseUrl}/review/${orderSlug}/3${orderNumberQS}" style="display:block;padding:18px 0;font-size:34px;text-decoration:none;line-height:1;color:#D4AF37;">⭐</a>
                </td>
                <td width="20%" align="center" valign="middle" bgcolor="#FFF8E1" style="width:20%;background-color:#FFF8E1;border:2px solid #D4AF37;border-radius:10px;mso-padding-alt:18px 0;">
                  <a href="${baseUrl}/review/${orderSlug}/4${orderNumberQS}" style="display:block;padding:18px 0;font-size:34px;text-decoration:none;line-height:1;color:#D4AF37;">⭐</a>
                </td>
                <td width="20%" align="center" valign="middle" bgcolor="#FFF8E1" style="width:20%;background-color:#FFF8E1;border:2px solid #D4AF37;border-radius:10px;mso-padding-alt:18px 0;">
                  <a href="${baseUrl}/review/${orderSlug}/5${orderNumberQS}" style="display:block;padding:18px 0;font-size:34px;text-decoration:none;line-height:1;color:#D4AF37;">⭐</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:6px 32px 6px 32px;text-align:center;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="20%" align="center" style="width:20%;font-size:11px;color:#999;">Poor</td>
                <td width="20%" align="center" style="width:20%;font-size:11px;color:#999;">Fair</td>
                <td width="20%" align="center" style="width:20%;font-size:11px;color:#999;">OK</td>
                <td width="20%" align="center" style="width:20%;font-size:11px;color:#999;">Good</td>
                <td width="20%" align="center" style="width:20%;font-size:11px;color:#999;">Amazing</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:14px 40px 32px 40px;text-align:center;">
            <div style="font-size:14px;color:#666;line-height:1.6;">${subCopy}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px 26px 32px;text-align:center;">
            <div style="background-color:#fdf2f6;border-radius:10px;padding:18px 20px;">
              <div style="font-size:15px;color:#2a2a2a;line-height:1.6;">
                Anything at all about this delivery?<br>
                Text <strong>Katie</strong>, our delivery manager, directly at
                <a href="tel:+1${KATIE_PHONE.replace(/[^0-9]/g, '')}" style="color:#c2185b;text-decoration:none;font-weight:700;white-space:nowrap;">${KATIE_PHONE}</a>.
              </div>
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px 24px 32px;text-align:center;">
            <div style="font-size:11px;color:#bbb;">Order #${safeDisplayId}</div>
          </td>
        </tr>

        <tr>
          <td style="background-color:#2a2a2a;padding:24px 32px;text-align:center;">
            <div style="font-size:12px;color:#ffffff;line-height:1.6;">
              The Sweet Tooth<br>
              18435 NE 19th Ave, North Miami Beach, FL 33179<br>
              <a href="https://thesweettooth.com" style="color:#ffffff;text-decoration:none;">thesweettooth.com</a>
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const textGift = `A sweet moment, just delivered.

${firstName} just received your gift on ${deliveryTime}.

${hasPhoto ? 'The proof-of-delivery photo is attached.\n\n' : ''}How was your experience?
From ordering to delivery, we'd love to know how we did.

1 star:  ${baseUrl}/review/${orderSlug}/1
2 stars: ${baseUrl}/review/${orderSlug}/2
3 stars: ${baseUrl}/review/${orderSlug}/3
4 stars: ${baseUrl}/review/${orderSlug}/4
5 stars: ${baseUrl}/review/${orderSlug}/5

Anything at all about this delivery? Text Katie, our delivery manager, directly at ${KATIE_PHONE}.

Order #${displayId}

The Sweet Tooth
18435 NE 19th Ave, North Miami Beach, FL 33179
thesweettooth.com`;

  const textSelf = `Your order has arrived.

Delivered on ${deliveryTime}.

Thank you for choosing us. We hope you love every bite.

${hasPhoto ? 'The proof-of-delivery photo is attached.\n\n' : ''}How did we do?
Tap a star to share your experience. Your words help others find us.

1 star:  ${baseUrl}/review/${orderSlug}/1
2 stars: ${baseUrl}/review/${orderSlug}/2
3 stars: ${baseUrl}/review/${orderSlug}/3
4 stars: ${baseUrl}/review/${orderSlug}/4
5 stars: ${baseUrl}/review/${orderSlug}/5

Anything at all about this delivery? Text Katie, our delivery manager, directly at ${KATIE_PHONE}.

Order #${displayId}

The Sweet Tooth
18435 NE 19th Ave, North Miami Beach, FL 33179
thesweettooth.com`;

  return { subject, text: isGift ? textGift : textSelf, html };
}

// Decide whether an order is a gift (shipping ≠ billing address) by fetching
// the order from Shopify. Safe fallback: default to gift on any uncertainty
// (it's ~95% of orders and the gift copy reads fine when ambiguous).
async function detectGiftFromShopify(orderId: string): Promise<{ isGift: boolean; shippingRecipientName: string | null }> {
  const fallback = { isGift: true, shippingRecipientName: null as string | null };
  if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN || !orderId) return fallback;

  try {
    const resp = await fetch(
      `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json`,
      { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } }
    );
    if (!resp.ok) return fallback;
    const data: any = await resp.json();
    const order = data?.order;
    if (!order) return fallback;

    const norm = (a: any): string | null => {
      if (!a) return null;
      const street = String(a.address1 || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const city = String(a.city || '').toLowerCase().trim();
      const zip = String(a.zip || '').replace(/\D/g, '').trim();
      if (!street || !zip) return null;
      return `${street}|${city}|${zip}`;
    };

    const shipping = order.shipping_address || null;
    const billing = order.billing_address || null;
    const shippingRecipientName = shipping
      ? (shipping.first_name || shipping.name || null)
      : null;

    const shipNorm = norm(shipping);
    const billNorm = norm(billing);

    // Per spec: if billing missing → default to gift
    if (!billNorm || !shipNorm) return { isGift: true, shippingRecipientName };

    return { isGift: shipNorm !== billNorm, shippingRecipientName };
  } catch (e: any) {
    console.warn(`detectGiftFromShopify failed for ${orderId}: ${e?.message || e}`);
    return fallback;
  }
}

// Log every email send to kv_store for audit purposes. Never throws — never blocks email delivery.
async function logEmailSend(orderNumber: string, recipient: string, subject: string, success: boolean, errorMsg?: string): Promise<void> {
  try {
    const logKey = `email_log:${orderNumber}`;
    const existing = (await getKV(logKey)) || { sends: [] };
    if (!Array.isArray(existing.sends)) existing.sends = [];
    existing.sends.push({
      timestamp: new Date().toISOString(),
      recipient,
      subject,
      success,
      errorMsg: errorMsg || null
    });
    // Keep last 20 sends per order to prevent unbounded growth
    if (existing.sends.length > 20) existing.sends = existing.sends.slice(-20);
    await setKV(logKey, existing);
  } catch (e: any) {
    console.error('logEmailSend failed (non-fatal):', e?.message || e);
  }
}

// Has a delivery confirmation email already gone out for this order? Audit trail
// lives in email_log:{orderNumber}. We match on every subject pattern we've ever
// used so older sends still count as already-sent. On a lookup failure we return
// true — a false-positive skip is far better than emailing a customer twice.
async function podEmailAlreadySent(orderKey: string): Promise<boolean> {
  try {
    const existingLog: any = await getKV(`email_log:${orderKey}`);
    if (!existingLog || !Array.isArray(existingLog.sends)) return false;
    return existingLog.sends.some((s: any) => {
      if (!s || s.success !== true || typeof s.subject !== 'string') return false;
      return s.subject.includes('just got your gift')
        || s.subject.includes('has been delivered')
        || s.subject.includes('Your Sweet Tooth order has arrived');
    });
  } catch (e: any) {
    console.error('email idempotency check failed (treating as already-sent):', e?.message || e);
    return true;
  }
}

// Flag the POD record so the app knows the customer has been emailed. Without
// this the bulk catch-up button treats every auto-notified order as pending.
async function markPodNotified(orderId: string): Promise<void> {
  try {
    const existing = await readPodOrder(orderId);
    // Bail on a DB error sentinel or a missing record — writing either back would
    // overwrite the real POD (photo, completedAt, status) with an almost-empty object.
    if (!existing || existing.__dbError || Object.keys(existing).length === 0) {
      console.error(`markPodNotified skipped for ${orderId} — POD record unreadable`);
      return;
    }
    existing.successNotificationSent = true;
    await writePodOrder(orderId, existing);
  } catch (e: any) {
    console.error('markPodNotified failed (non-fatal):', e?.message || e);
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
  app.use(express.urlencoded({ extended: true, limit: '100kb' })); // form posts from the review feedback page

  // Photo retention: sweep once shortly after boot, then every 24 hours.
  setTimeout(() => { cleanupOldPodPhotos().catch(e => console.error('photo cleanup error:', e)); }, 30_000);
  setInterval(() => { cleanupOldPodPhotos().catch(e => console.error('photo cleanup error:', e)); }, 24 * 60 * 60 * 1000);

  // ───────────────────────────────────────────────────────────────────────
  // STOREFRONT CHAT (public) — powers the customer chat widget on thesweettooth.com
  //   POST /api/storefront/track  -> secure order status (reads st_ tags)
  //   POST /api/storefront/chat   -> general Q&A via Claude
  // CORS-limited to the storefront. The Shopify token never leaves the server.
  // ───────────────────────────────────────────────────────────────────────
  const SF_ORIGINS = [
    'https://thesweettooth.com',
    'https://www.thesweettooth.com',
    'https://thesweettoothfl.myshopify.com',
  ];
  app.use('/api/storefront', (req: any, res: any, next: any) => {
    const origin = req.headers.origin;
    if (SF_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const SF_API = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01`;
  const sfDigits = (s: string) => (s || '').replace(/\D/g, '');

  async function sfFetchOrder(orderNumber: string) {
    const name = String(orderNumber || '').trim().replace(/^#/, '').trim();
    if (!name) return null;
    const r = await fetch(`${SF_API}/orders.json?name=${encodeURIComponent(name)}&status=any`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
    });
    const data: any = await r.json();
    const orders = data.orders || [];
    return orders.find((o: any) => (o.name || '').replace(/^#/, '') === name) || orders[0] || null;
  }

  function sfContactMatches(order: any, contact: string) {
    if (!contact) return false;
    contact = contact.trim();
    if (contact.includes('@')) {
      const emails = [order.email, order.customer?.email].filter(Boolean).map((e: string) => e.toLowerCase());
      return emails.includes(contact.toLowerCase());
    }
    const target = sfDigits(contact);
    if (target.length < 7) return false;
    const t10 = target.slice(-10);
    const phones = [order.phone, order.customer?.phone, order.shipping_address?.phone, order.billing_address?.phone];
    return phones.some((p: string) => p && sfDigits(p).slice(-10) === t10);
  }

  // True when the text reads as an email or a full phone number rather than an order number
  // (order numbers are ~5 digits; phones are 10+ digits after stripping formatting).
  const sfLooksLikeContact = (s: string) => s.includes('@') || sfDigits(s).length >= 10;

  // Contact-only lookup: scan the last 60 days of orders for an email/phone match, newest first.
  async function sfFindByContact(contact: string) {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const r = await fetch(`${SF_API}/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(sixtyDaysAgo)}`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
    });
    const data: any = await r.json();
    const matches = (data.orders || []).filter((o: any) => sfContactMatches(o, contact));
    matches.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));
    return matches;
  }

  const sfTag = (order: any, prefix: string) => {
    const t = (order.tags || '').split(',').map((x: string) => x.trim())
      .find((x: string) => x.toLowerCase().startsWith(prefix.toLowerCase()));
    return t ? t.slice(prefix.length) : '';
  };
  const sfAttr = (order: any, name: string) => {
    const a = (order.note_attributes || []).find((x: any) => x.name === name);
    return a ? a.value : '';
  };

  function sfBuildStatus(order: any) {
    const name = order.name || '';
    const status = (sfTag(order, 'st_status:') || '').toUpperCase();
    const driver = sfTag(order, 'st_drivername:') || 'Katie';
    const ddStr = sfAttr(order, 'Delivery Date');
    const dday = sfAttr(order, 'Delivery Day');
    const method = (sfAttr(order, 'Delivery Method') || '').toLowerCase();
    const isLocal = method.includes('deliver') || (order.tags || '').toLowerCase().includes('local delivery');
    const phoneClause = `text your driver ${driver} directly at ${KATIE_PHONE}`;

    if (status === 'CANCELLED') {
      return `Our records show order ${name} was cancelled. If that doesn't look right or you have any ` +
             `questions, email orders@thesweettooth.com and we'll sort it out right away.`;
    }

    if (method.includes('pick')) {
      if (status === 'DELIVERED' || status === 'COMPLETE') {
        return `Order ${name} was picked up — enjoy! If anything's not right, email orders@thesweettooth.com.`;
      }
      return `Order ${name} is a store-pickup order — we'll have it ready for you at 18435 NE 19th Ave, ` +
             `North Miami Beach (Monday-Friday, 10 AM-5 PM). Questions? Email orders@thesweettooth.com.`;
    }

    if (status === 'DELIVERED' || status === 'COMPLETE') {
      let when = dday ? ` on ${dday}` : '';
      const comp = sfTag(order, 'st_completed:');
      if (comp) {
        try {
          const [d, tRaw] = comp.replace(/Z$/, '').split('T');
          const dt = new Date(`${d}T${tRaw.replace(/-/g, ':')}Z`);
          when = ` on ${dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' })}` +
                 ` at ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}`;
        } catch {}
      }
      return `Good news — order ${name} was delivered${when}! 📦✅ A delivery confirmation with a timestamped ` +
             `photo was emailed to you. If you don't see it, check your spam folder or let us know and we'll resend it.`;
    }

    if (['OUT', 'ROUTE', 'TRANSIT', 'WAY'].some((k) => status.includes(k))) {
      return `Your order ${name} is on the way today with ${driver}! 🚗 It will arrive before 5 PM. ` +
             `If you need anything, you can ${phoneClause}.`;
    }

    const parsed = ddStr ? new Date(ddStr) : null;
    if (isLocal && parsed && !isNaN(parsed.getTime())) {
      const ddYmd = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const pretty = parsed.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      if (ddYmd === todayYmd) {
        return `Your order ${name} is scheduled for delivery today (${pretty})! 🎉 It will arrive before 5 PM. ` +
               `If you need anything sooner or have a special request, you can ${phoneClause}.`;
      }
      if (ddYmd > todayYmd) {
        return `Your order ${name} is scheduled for delivery on ${pretty}, before 5 PM. If you need anything, you can ${phoneClause}.`;
      }
      return `Your order ${name} was scheduled for ${pretty}. If it hasn't arrived, you can ${phoneClause} and we'll check on it right away.`;
    }

    if (!isLocal) {
      for (const f of (order.fulfillments || [])) {
        if (f.tracking_number) {
          const url = (f.tracking_urls && f.tracking_urls[0]) || f.tracking_url;
          return `Your order ${name} has shipped in insulated packaging with ice packs. ` +
                 `Tracking number: ${f.tracking_number}.${url ? ' Track it here: ' + url : ''}`;
        }
      }
      return `Your order ${name} is being prepared and will ship in insulated packaging with ice packs. ` +
             `You'll get a tracking email as soon as it's on its way.`;
    }

    return `Your order ${name} is confirmed and being prepared for local delivery. ` +
           `You'll get your scheduled delivery day shortly. If you need anything, you can ${phoneClause}.`;
  }

  // Build the /track response; when the order is delivered and a POD photo exists,
  // offer to resend the confirmation email (the widget switches into resend mode).
  async function sfTrackResponse(o: any, prefix = '') {
    const reply = prefix + sfBuildStatus(o);
    const status = (sfTag(o, 'st_status:') || '').toUpperCase();
    if (status === 'DELIVERED' || status === 'COMPLETE') {
      try {
        const pod = await readPodOrder(String(o.id));
        if (pod && (pod.photoR2Key || pod.photo)) {
          return {
            status: 'ok',
            reply: reply + " Didn't get the confirmation? Type the best email address right here and I'll resend it with the photo now.",
            canResend: true,
          };
        }
      } catch {}
    }
    return { status: 'ok', reply };
  }

  app.post('/api/storefront/track', async (req: any, res: any) => {
    try {
      const order = (req.body.order || '').trim();
      const contact = (req.body.contact || '').trim();
      if (!order) return res.json({ status: 'needs_contact', reply: "Sure! What's your order number? It's the 5-digit number in your confirmation email." });
      // Customer typed their email/phone where the order number goes — look it up by contact instead.
      if (sfLooksLikeContact(order)) {
        const matches = await sfFindByContact(order);
        if (!matches.length) return res.json({ status: 'not_found', reply: `I couldn't find a recent order under that ${order.includes('@') ? 'email' : 'phone number'}. 🤔 Double-check it matches what you used at checkout — or text our delivery manager Katie at ${KATIE_PHONE} and she'll track it down for you.` });
        const prefix = matches.length > 1 ? `I found ${matches.length} recent orders under that contact — here's the latest. ` : '';
        return res.json(await sfTrackResponse(matches[0], prefix));
      }
      const o = await sfFetchOrder(order);
      if (!o) {
        // Order number didn't match, but a valid contact came with it — fall back to contact lookup.
        if (contact && sfLooksLikeContact(contact)) {
          const matches = await sfFindByContact(contact);
          if (matches.length) {
            const prefix = matches.length > 1 ? `That order number didn't match, but I found ${matches.length} recent orders under your contact — here's the latest. ` : "That order number didn't match, but I found your order by contact. ";
            return res.json(await sfTrackResponse(matches[0], prefix));
          }
        }
        return res.json({ status: 'not_found', reply: "I couldn't find an order with that number. 🤔 Double-check it against your confirmation email — or share the email or phone number you used at checkout and I'll look it up that way." });
      }
      if (!contact) return res.json({ status: 'needs_contact', reply: "Got it! To pull up your order securely, what's the email or phone number you used at checkout?" });
      if (!sfContactMatches(o, contact)) return res.json({ status: 'mismatch', reply: "Hmm, that email/phone doesn't match this order number. Please use the exact email or phone from your checkout — or send either one on its own and I'll find the order for you." });
      return res.json(await sfTrackResponse(o));
    } catch (e) {
      console.error('storefront/track error', e);
      return res.json({ status: 'error', reply: "Sorry, I hit a snag looking that up. Please try again in a moment, or reach our team and we'll help right away." });
    }
  });

  // ── Customer self-serve: resend the delivery confirmation email (with POD photo) ──
  // Memory-safe by design: one resend at a time (sfResendBusy), one photo buffered
  // transiently (~2-3 MB), max 5 sends/day per order via email_log timestamps.
  let sfResendBusy = false;
  app.post('/api/storefront/resend-pod', async (req: any, res: any) => {
    try {
      const order = (req.body.order || '').trim();
      const contact = (req.body.contact || '').trim();
      const email = (req.body.email || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.json({ status: 'bad_email', reply: "That doesn't look like a complete email address — mind re-typing it?" });

      // Resolve + verify the order exactly like /track does
      let o: any = null;
      if (order && sfLooksLikeContact(order)) o = (await sfFindByContact(order))[0] || null;
      else if (order) o = await sfFetchOrder(order);
      if (!o && contact && sfLooksLikeContact(contact)) o = (await sfFindByContact(contact))[0] || null;
      if (!o) return res.json({ status: 'not_found', reply: `I couldn't find that order. Text our delivery manager Katie at ${KATIE_PHONE} and she'll get you the confirmation.` });
      const verified = sfContactMatches(o, contact) || (sfLooksLikeContact(order) && sfContactMatches(o, order));
      if (!verified) return res.json({ status: 'mismatch', reply: 'I couldn\'t verify that order. Please start over with the email or phone number you used at checkout.' });

      const pod = await readPodOrder(String(o.id));
      if (!pod || pod.__dbError || (!pod.photoR2Key && !pod.photo)) {
        return res.json({ status: 'no_pod', reply: `I don't have a delivery photo on file for order ${o.name} — it may be older than 7 days. Text Katie at ${KATIE_PHONE} and she'll help right away.` });
      }

      const orderNum = (o.name || '').replace(/^#/, '') || String(o.id);
      try {
        const log: any = await getKV(`email_log:${orderNum}`);
        const today = new Date().toISOString().slice(0, 10);
        const sentToday = (log?.sends || []).filter((s: any) => s?.success === true && String(s?.timestamp || '').slice(0, 10) === today).length;
        if (sentToday >= 5) return res.json({ status: 'limit', reply: `That confirmation has already been resent several times today. If it's still not arriving, text Katie at ${KATIE_PHONE}.` });
      } catch {}

      if (sfResendBusy) return res.json({ status: 'busy', reply: 'One moment — please try that again in a few seconds.' });
      sfResendBusy = true;
      try {
        let photoB64: string | undefined;
        if (pod.photoR2Key && R2) {
          const obj = await R2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: pod.photoR2Key }));
          const bytes = await (obj.Body as any).transformToByteArray();
          photoB64 = Buffer.from(bytes).toString('base64');
        } else if (pod.photo) {
          photoB64 = pod.photo;
        }
        const deliveryTime = new Date(pod.completedAt || pod.submittedAt || Date.now()).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true
        });
        let isGift = true;
        let shippingRecipientName: string | null = null;
        try {
          const det = await detectGiftFromShopify(String(o.id));
          isGift = det.isGift;
          shippingRecipientName = det.shippingRecipientName;
        } catch {}
        const receiverName = pod.giftReceiverName || shippingRecipientName || 'the recipient';
        const { subject, text, html } = buildDeliveryConfirmationEmail({
          variant: isGift ? 'gift' : 'self',
          receiverName,
          deliveryTime,
          orderId: String(o.id),
          orderNumber: orderNum,
          baseUrl: getAppBaseUrl(req),
          hasPhoto: !!photoB64
        });
        const ok = await sendEmail(
          email,
          subject,
          text,
          photoB64,
          photoB64 ? `delivery-${o.id}.jpg` : undefined,
          html,
          photoB64 ? 'proof-photo' : undefined
        );
        await logEmailSend(orderNum, email, subject, ok);
        if (ok) return res.json({ status: 'ok', reply: `Done! The delivery confirmation for order ${o.name} — photo included — is on its way to ${email}. Give it a minute, and check spam if you don't see it.` });
        return res.json({ status: 'error', reply: `I couldn't send that just now. Please try again in a few minutes, or text Katie at ${KATIE_PHONE}.` });
      } finally {
        sfResendBusy = false;
      }
    } catch (e) {
      sfResendBusy = false;
      console.error('storefront/resend-pod error', e);
      return res.json({ status: 'error', reply: 'Sorry, I hit a snag. Please try again in a moment.' });
    }
  });

  const SF_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
  const SF_SYSTEM = `You are the friendly chat assistant for The Sweet Tooth, a kosher chocolate and ` +
    `dessert gift shop in North Miami Beach serving Miami locally and shipping nationwide. Be warm, ` +
    `concise, and genuinely helpful — you're here to answer questions, help people find the right gift, ` +
    `and make ordering easy.\n\n` +
    `FACTS — this is your complete knowledge. Never contradict it, never invent beyond it.\n\n` +
    `STORE\n` +
    `- 18435 NE 19th Ave, North Miami Beach, FL 33179 — 5 minutes from Aventura Mall, free parking in front.\n` +
    `- Hours: Monday-Friday 10 AM-5 PM. Closed Saturday (Shabbat). Sunday the store is closed, but local ` +
    `deliveries run.\n` +
    `- Free in-store pickup — choose Store Pickup at checkout.\n` +
    `- Email: orders@thesweettooth.com for anything order-related, info@thesweettooth.com for general ` +
    `questions. We respond within one business day.\n\n` +
    `KOSHER & DIETARY\n` +
    `- Everything is kosher, certified by Kosher Miami. Spell it "parve", never "pareve".\n` +
    `- Dairy line: milk, white, and dark chocolate. Vegan/Parve line: dark chocolate only — dairy-free and ` +
    `egg-free, made in a separate parve room with dedicated equipment.\n` +
    `- Every product is labeled Dairy or Parve, and gift baskets include a hang tag so the recipient knows.\n` +
    `- Gluten-free options: thesweettooth.com/collections/gluten-free. Say "gluten-free", NEVER "certified ` +
    `gluten-free" — our facility also processes wheat.\n` +
    `- Allergens: our facility processes milk, eggs, wheat, soy, peanuts, and tree nuts, so we are not ` +
    `certified nut-free — but we take extreme care and prepare nut-free requests separately, with the same ` +
    `discipline as our dedicated parve room. Customers can request an order without nuts in the Special ` +
    `Instructions box at checkout. For serious allergies, they should email orders@thesweettooth.com before ` +
    `ordering. When answering allergy questions: lead with the care we take, then the facility disclaimer — ` +
    `warm and factual, never dramatic.\n` +
    `- Never mention bone char.\n\n` +
    `LOCAL DELIVERY\n` +
    `- We deliver throughout Miami-Dade, Broward, and Palm Beach counties. No PO boxes.\n` +
    `- Same-day delivery on orders placed by 2 PM — Monday-Friday and Sunday. Deliveries run 10 AM-6 PM; ` +
    `the driver sets the route unless a specific time was requested at checkout.\n` +
    `- Delivery pricing is based on zip code — the exact price shows at checkout.\n` +
    `- If the recipient isn't home: our driver calls or texts the recipient directly to arrange it (that's ` +
    `why including the recipient's phone number matters). If no one can be reached, we contact the sender ` +
    `to reschedule.\n\n` +
    `SHIPPING\n` +
    `- We ship to all 50 states (US only) via UPS, with select shipments on FedEx — never USPS. Everything ` +
    `ships in insulated packaging with gel packs.\n` +
    `- During summer, only services that arrive within 2 days are offered (air or ground). We ship every ` +
    `weekday, not weekends.\n` +
    `- Shipping cost shows at checkout. No free-shipping promotions right now; promotions vary by season.\n` +
    `- Chocolate-covered strawberries ship nationwide too.\n\n` +
    `ORDERING & GIFTS\n` +
    `- Basket Builder: thesweettooth.com/pages/build-a-basket — pick an occasion, choose from 8 core sizes, ` +
    `select Dairy or Vegan/Parve, add extras. Ready-made options: ` +
    `thesweettooth.com/collections/ready-to-ship-gift-baskets.\n` +
    `- What's inside the baskets: chocolate-dipped Oreos & pretzels, our seasonal collection of handmade ` +
    `truffles (30+ rotating flavors), chocolate-dipped graham crackers, wafers & tea biscuits, our famous ` +
    `chocolate bark, and chocolate-dipped dried fruit. The three largest sizes (Jumbo Rectangle, ` +
    `Penultimate, Supreme) also include brownies, cookies, and pecan pralines. Dairy baskets mix milk, ` +
    `white & dark chocolate; Vegan/Parve baskets are dark chocolate only. Larger baskets = more variety, ` +
    `not just more quantity.\n` +
    `- Most baskets include a free chocolate occasion plaque (like "Happy Birthday"); a larger plaque is an ` +
    `optional add-on in the Basket Builder.\n` +
    `- NEVER quote basket prices — we have sizes for a wide range of budgets; exact prices are on the site.\n` +
    `- Occasion links you may share: /collections/sympathy-shiva, /collections/birthday, ` +
    `/collections/thank-you, /collections/get-well, /collections/baby, /collections/dubai-chocolate, ` +
    `/collections/shop-favorites, and the flavor menu at /pages/flavors (all on thesweettooth.com).\n` +
    `- A free gift card with a personal message comes attached to every gift — add it at checkout by ` +
    `checking "This is a gift". Every gift arrives wrapped with ribbons and bows matched to the occasion.\n` +
    `- The Special Instructions box at checkout is for allergies, substitutions, and delivery notes — we ` +
    `read it first when preparing every order.\n\n` +
    `CUSTOM & CORPORATE\n` +
    `- We print logos and photos on chocolate: custom bars (25-piece minimum), chocolate-dipped logo Oreos ` +
    `(sold as the 12-pack on the site), and candy apples (6-piece minimum). Email your logo to ` +
    `orders@thesweettooth.com for a quote. Turnaround is usually fast but varies by season — never promise ` +
    `a timeline; rush requests are often accommodated.\n` +
    `- Corporate gifting at any scale, including multi-address shipping with personalized messages: ` +
    `corporate.thesweettooth.com.\n\n` +
    `STORAGE & FRESHNESS\n` +
    `- Store chocolate in a cool, dry place (60-70°F); don't refrigerate — it causes bloom. A white coating ` +
    `is bloom: harmless and safe to eat.\n` +
    `- Freshness: bars and truffles 4-12 weeks, Dubai chocolate about 3 weeks, dipped Oreos and pretzels ` +
    `2-3 weeks, chocolate-covered strawberries 2-3 days.\n\n` +
    `PROBLEMS & CHANGES TO AN ORDER\n` +
    `- Something arrived damaged or wrong: email orders@thesweettooth.com right away with a photo and the ` +
    `order number — we stand behind everything we make and will make it right.\n` +
    `- Changing an order (address, items, date): email orders@thesweettooth.com with the order number. For ` +
    `delivery scheduling changes, they can also call or text Katie, our delivery manager, at 305-994-4070.\n` +
    `- Urgent gift-message change: call the store at 305-682-1400 and email orders@thesweettooth.com.\n` +
    `- Those are the ONLY two phone numbers you may ever give, only in those situations.\n\n` +
    `RULES\n` +
    `- If the customer asks about THEIR order's status — tracking, "where is my order", delivery time, or ` +
    `"did it arrive" — do NOT guess. Reply exactly: "TRACK_ORDER" and nothing else. But if they want to ` +
    `CHANGE or add something to an existing order, don't track it — give them the change instructions ` +
    `from PROBLEMS & CHANGES instead. Examples: "Where is my order?" -> TRACK_ORDER. "Can I still add a ` +
    `gift message to my order?" -> email orders@thesweettooth.com with the order number (call the store at ` +
    `305-682-1400 if urgent) — NOT TRACK_ORDER. "I need to change the address on my order" -> change ` +
    `instructions, NOT TRACK_ORDER.\n` +
    `- If the conversation shows the customer JUST received a tracking result and they're confused or ` +
    `dispute it, do NOT reply TRACK_ORDER again, and never say you lack access — that result came from our ` +
    `live order system and is accurate. Re-explain it in plain words (e.g. "your order #123 was delivered ` +
    `Monday at 12:26 PM — the photo confirmation went to the email on the order") and offer Katie at ` +
    `305-994-4070 for anything about an active delivery.\n` +
    `- You cannot send emails or perform actions yourself — never claim you sent, resent, or scheduled ` +
    `anything. Only the order-tracking flow can resend a delivery confirmation.\n` +
    `- Only recommend products and links from the FACTS above — never name a product or price from memory.\n` +
    `- If you don't know something, say so and point to orders@thesweettooth.com — never make anything up.\n` +
    `- FACTS lists what you KNOW we offer — if something isn't mentioned (a flavor, sugar-free, a service), ` +
    `that does NOT mean we don't have it. Never say "we don't offer X" unless FACTS explicitly says so; ` +
    `instead say you're not sure and suggest emailing info@thesweettooth.com.\n` +
    `- Never discuss company internals (staff size, ownership history). If asked how long we've been around: ` +
    `since 1979 — say it once, nothing more.\n` +
    `- Keep answers to 1-3 short sentences, then a natural next step (a link or a question) when it helps ` +
    `the customer move forward. NEVER dump multiple policy sections or bullet lists — answer only the ` +
    `specific thing asked, nothing more.\n` +
    `- Never volunteer limitations or negatives (no PO boxes, no weekend shipping, closed Saturday, ` +
    `cross-contamination, etc.) unless the customer asked about that exact thing.`;

  app.post('/api/storefront/chat', async (req: any, res: any) => {
    try {
      const message = (req.body.message || '').trim();
      const history = req.body.history || [];
      if (!message) return res.json({ reply: 'Hi! How can I help — order status, ingredients, delivery, or something else?' });
      if (!SF_ANTHROPIC_KEY) return res.json({ reply: 'Thanks for your message! Our team will jump in shortly.' });
      const msgs = history.slice(-8).map((h: any) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '') }));
      msgs.push({ role: 'user', content: message });
      const nowMiami = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
      const systemNow = SF_SYSTEM + `\n\nCURRENT TIME: It is now ${nowMiami} in Miami. Use this for the ` +
        `2 PM same-day cutoff and store-hours questions — never ask the customer what time it is. If it's ` +
        `past 2 PM, same-day delivery is no longer available today; offer the next delivery day instead.`;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': SF_ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.CHAT_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 300, system: systemNow, messages: msgs }),
      });
      const data: any = await r.json();
      const reply = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
      if (reply.includes('TRACK_ORDER')) {
        // Guard against the track loop: if a tracking result was just shown and the customer's
        // message adds no new order number/contact, they're disputing it — don't restart the flow.
        const trackResultRx = /(was delivered|scheduled for delivery|has shipped|store-pickup order|is on the way today|was cancelled)/i;
        const recentTrack = history.slice(-4).some((h: any) => h.role === 'assistant' && trackResultRx.test(String(h.content || '')));
        const hasNewLookupInfo = /\d{4,}|@/.test(message);
        if (recentTrack && !hasNewLookupInfo) {
          return res.json({ reply: 'I hear you — the status above came straight from our live order system, so it\'s current. If it doesn\'t match what you\'re expecting, text Katie, our delivery manager, at 305-994-4070 and she\'ll check on it personally.' });
        }
        return res.json({ reply: "I can help track that! What's your order number?", action: 'track' });
      }
      return res.json({ reply: reply || 'Thanks for your message! Our team will follow up shortly.' });
    } catch (e) {
      console.error('storefront/chat error', e);
      return res.json({ reply: 'Thanks for your message! Let me connect you with our team.' });
    }
  });

  // Serve the brand logo PNG so HTML pages outside of email (thank-you, feedback
  // form) can reference the real logo via /brand/logo.png instead of fabricating
  // a text wordmark. Cached aggressively since it never changes per release.
  app.get('/brand/logo.png', (_req, res) => {
    if (!fs.existsSync(EMAIL_LOGO_PATH)) {
      return res.status(404).send('logo not found');
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(EMAIL_LOGO_PATH);
  });
  
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

  app.delete("/api/users/:id", async (req, res) => {
    const users = await readUsersDB();
    const idx = users.findIndex((u: any) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    // Guard: never delete the configured default driver — auto-assign relies on it
    // ("All orders default to Katie — never show Not Assigned").
    try {
      const dd = await getKV('default_driver');
      const defaultId = dd ? JSON.parse(dd).driverId : null;
      if (defaultId && users[idx].id === defaultId) {
        return res.status(409).json({ error: "This driver is the default driver. Set a different default driver first, then delete." });
      }
    } catch { /* if config unreadable, fall through and allow delete */ }
    const removed = users.splice(idx, 1)[0];
    await writeUsers(users);
    res.json({ success: true, id: removed.id });
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

      // Enrich with Local Delivery instructions + phone from FulfillmentOrders.
      // Customer instructions live on FO.deliveryMethod.additionalInformation, not note_attributes.
      try {
        const orderIds = ordersToProcess.map((o: any) => String(o.id));
        const localInfo = await fetchLocalDeliveryInfo(orderIds);
        for (const o of ordersToProcess) {
          const info = localInfo.get(String(o.id));
          if (info) {
            if (info.instructions) o._delivery_instructions = info.instructions;
            if (info.phone) o._delivery_phone = info.phone;
          }
        }
      } catch (err) {
        console.error('Local delivery info enrichment failed (non-fatal):', err);
      }

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

        // Also mark the Shopify order Fulfilled so it stops showing "Unfulfilled"
        // (the chat tracker + Shopify reports read the real fulfillment status).
        // Best-effort: never blocks the driver's delivery update. notify_customer
        // is false so the customer doesn't get a confusing "shipped" email.
        if (status === 'DELIVERED') {
          await markShopifyDelivered(String(orderId));
        }
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

  // Checks & balances: exactly what confirmation text went out for an order (Twilio sends).
  app.get("/api/sms-log/:orderNumber", async (req, res) => {
    try {
      const log = await getKV(`sms_log:${req.params.orderNumber}`);
      res.json({ log: log || { sends: [] } });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Inbound texts to the delivery-confirmation number: no-reply auto-response.
  // (STOP/opt-out is handled by Twilio before it ever reaches us.)
  app.post("/api/sms/inbound", express.urlencoded({ extended: false }), (_req, res) => {
    const msg = "The Sweet Tooth: this number sends delivery confirmations and can't receive replies. " +
      "Need help with your delivery? Text our delivery manager Katie at 305-994-4070, or call the store at (305) 682-1400.";
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`);
  });

  app.post("/api/pod", async (req, res) => {
    const { orderId, photo, signature, notes, completedAt, status, driverId, driverName, failureReason, isManual, customerEmail, giftReceiverName, giftSenderName, address, orderNumber } = req.body;

    // DEBUG: Log what photo data is received
    console.log(`📷 POD POST for ${orderId}: photo=${photo ? `YES (${photo.length} chars, starts: ${photo.substring(0,30)}...)` : 'NO'}, status=${status}`);

    try {
      const existingPod = await readPodOrder(orderId);

      // DB is configured but unreachable — bail early with 503 so the frontend
      // retry loop can try again. Proceeding with a blank existingPod would break
      // every idempotency check below (re-uploading photos, re-sending emails).
      if (existingPod && existingPod.__dbError) {
        return res.status(503).json({ error: 'Database unavailable, retry in a moment' });
      }

      // Upload new photo/signature to R2 if configured and we got base64 data.
      // If R2 upload fails, we fall back to storing base64 in the DB (legacy path).
      let photoR2Key: string | null = existingPod.photoR2Key || null;
      let signatureR2Key: string | null = existingPod.signatureR2Key || null;
      let newPhotoBase64: string | null = null;
      let newSignatureBase64: string | null = null;

      if (photo && typeof photo === 'string' && photo.startsWith('data:')) {
        if (R2) {
          // Idempotency: if this order already has a photo uploaded and the caller
          // is retrying with what we assume is the same photo, reuse the existing
          // key. Prevents duplicate -2/-3 uploads on retry of a flaky save.
          if (photoR2Key) {
            console.log(`📷 Reusing existing photo key for ${orderId}: ${photoR2Key}`);
          } else {
            // Simple Cloudflare key: photos/2026-04-21/35363.jpg
            // If retaken: photos/2026-04-21/35363-2.jpg, then -3, etc.
            const _now = new Date(completedAt || Date.now());
            const _etDate = _now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            const _safeOrderNum = (orderNumber || orderId).toString().replace(/[^a-zA-Z0-9]/g, '');
            let key = `photos/${_etDate}/${_safeOrderNum}.jpg`;
            // If a photo already exists for this order on this date, append -2, -3, etc.
            let _suffix = 2;
            while (await r2KeyExists(key)) {
              key = `photos/${_etDate}/${_safeOrderNum}-${_suffix}.jpg`;
              _suffix++;
              if (_suffix > 50) break; // safety cap
            }
            const uploaded = await uploadToR2(photo, key);
            if (uploaded) {
              photoR2Key = uploaded;
            } else {
              // Cloudflare upload failed — fall back to base64 in DB so we don't lose it
              console.warn(`Cloudflare photo upload failed for ${orderId}, falling back to DB base64`);
              newPhotoBase64 = photo;
            }
          }
        } else {
          newPhotoBase64 = photo;
        }
      }

      if (signature && typeof signature === 'string' && signature.startsWith('data:')) {
        if (R2) {
          if (signatureR2Key) {
            console.log(`✍️ Reusing existing signature key for ${orderId}: ${signatureR2Key}`);
          } else {
            // Simple Cloudflare key: signatures/2026-04-21/35363.png
            const _now = new Date(completedAt || Date.now());
            const _etDate = _now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            const _safeOrderNum = (orderNumber || orderId).toString().replace(/[^a-zA-Z0-9]/g, '');
            let key = `signatures/${_etDate}/${_safeOrderNum}.png`;
            let _suffix = 2;
            while (await r2KeyExists(key)) {
              key = `signatures/${_etDate}/${_safeOrderNum}-${_suffix}.png`;
              _suffix++;
              if (_suffix > 50) break;
            }
            const uploaded = await uploadToR2(signature, key);
            if (uploaded) {
              signatureR2Key = uploaded;
            } else {
              console.warn(`R2 signature upload failed for ${orderId}, falling back to DB base64`);
              newSignatureBase64 = signature;
            }
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
        // The DB write failed (the file fallback doesn't survive Render deploys, so it
        // does NOT count as persisted). Return 503 so the frontend retry loop tries again
        // and ultimately shows the driver an error instead of a false green checkmark.
        // Bail before Shopify tags / email — never mark a delivery DELIVERED or notify the
        // customer for proof that wasn't actually saved.
        console.error(`⚠️ POD DB write failed for ${orderId} — returning 503 so the driver retries instead of seeing a false success`);
        return res.status(503).json({ error: 'Could not save delivery — please retry' });
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
          const allTags = currentTags.split(',').map((t: string) => t.trim()).filter(Boolean);
          // Idempotency: on retry, preserve the original st_completed timestamp so
          // the customer-facing delivery time doesn't drift later with each retry.
          const existingCompletedTag = allTags.find((t: string) => t.startsWith('st_completed:'));
          const tagsList = allTags.filter((t: string) => !t.startsWith('st_status:') && !t.startsWith('st_completed:') && !t.startsWith('st_driver:') && !t.startsWith('st_drivername:'));
          tagsList.push(`st_status:DELIVERED`);
          tagsList.push(existingCompletedTag || `st_completed:${(completedAt || new Date().toISOString()).replace(/:/g,'-')}`);
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

        // Fulfil + stamp Delivered so the customer's Shopify order page stops
        // saying "On its way". Idempotent, so it's safe that the status route
        // may have already done this.
        await markShopifyDelivered(String(orderId));
      }

      // ── AUTO-SEND DELIVERY CONFIRMATION EMAIL WITH PHOTO ───────────────────────────────
      const SMTP_PASS = process.env.SMTP_PASS || '';

      // Idempotency: if we already sent a successful delivery confirmation for
      // this order, skip — prevents duplicate emails when the frontend retries.
      let alreadySentPodEmail = false;
      if (status === 'DELIVERED' && customerEmail) {
        alreadySentPodEmail = await podEmailAlreadySent(String(orderNumber || orderId));
      }

      // Log why email might not be sent
      if (status === 'DELIVERED') {
        if (!customerEmail) console.log(`📧 No email for order ${orderId} — cannot send POD confirmation`);
        else if (!SMTP_PASS) console.log(`📧 SMTP_PASS not set — cannot send POD confirmation to ${customerEmail}`);
        else if (alreadySentPodEmail) console.log(`📧 POD email already sent for ${orderId} — skipping duplicate`);
        else console.log(`📧 Attempting to send POD email to ${customerEmail} for order ${orderId}`);
      }
      if (status === 'DELIVERED' && customerEmail && SMTP_PASS && !alreadySentPodEmail) {
        try {
          const deliveryTime = new Date(completedAt || Date.now()).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
          });

          // Detect gift vs self-purchase. Manual orders aren't in Shopify, so
          // default to gift for those. Shopify-backed orders get the real
          // address comparison via detectGiftFromShopify.
          let isGift = true;
          let shippingRecipientName: string | null = null;
          if (!isManual) {
            const detected = await detectGiftFromShopify(String(orderId));
            isGift = detected.isGift;
            shippingRecipientName = detected.shippingRecipientName;
          }

          const receiverName = giftReceiverName || shippingRecipientName || 'the recipient';
          const baseUrl = getAppBaseUrl(req);
          const hasPhoto = !!photo;

          const { subject, text, html } = buildDeliveryConfirmationEmail({
            variant: isGift ? 'gift' : 'self',
            receiverName,
            deliveryTime,
            orderId: String(orderId),
            orderNumber,
            baseUrl,
            hasPhoto
          });

          const emailSent = await sendEmail(
            customerEmail,
            subject,
            text,
            hasPhoto ? photo : undefined,
            hasPhoto ? `delivery-${orderId}.jpg` : undefined,
            html,
            hasPhoto ? 'proof-photo' : undefined
          );
          await logEmailSend(String(orderNumber || orderId), customerEmail, subject, emailSent);
          if (emailSent) {
            await markPodNotified(String(orderId));
            console.log(`✅ Auto-sent delivery confirmation to ${customerEmail} for order ${orderId}${hasPhoto ? ' (with photo)' : ''}`);
          } else {
            console.log(`⚠️ Failed to auto-send confirmation to ${customerEmail} for order ${orderId}`);
          }
        } catch (emailErr) {
          console.error('Auto-send email error (non-fatal):', emailErr);
        }
      }

      // ── AUTO-SEND DELIVERY CONFIRMATION TEXT (Twilio) ───────────────────────────────
      // Inert until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are set in env.
      // Memory-safe: the photo is never loaded here — Twilio fetches it itself from the
      // public /api/pod/:orderId/photo proxy URL. Audit trail in kv sms_log:{orderNumber}.
      const TW_SID = process.env.TWILIO_ACCOUNT_SID || '';
      const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
      const TW_FROM = process.env.TWILIO_FROM || '';
      if (status === 'DELIVERED' && TW_SID && TW_TOKEN && TW_FROM) {
        try {
          const smsKey = `sms_log:${String(orderNumber || orderId)}`;
          const smsLog: any = (await getKV(smsKey)) || { sends: [] };
          if (!Array.isArray(smsLog.sends)) smsLog.sends = [];
          const alreadyTexted = smsLog.sends.some((s: any) => s?.success === true && s?.kind === 'pod');
          if (alreadyTexted) {
            console.log(`📱 POD text already sent for ${orderId} — skipping duplicate`);
          } else {
            // Text the buyer (the person who placed the order) — same person the email goes to.
            let toPhone = '';
            if (!isManual) {
              try {
                const resp = await fetch(`https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders/${orderId}.json?fields=phone,billing_address,customer`, {
                  headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
                });
                const od: any = await resp.json();
                const ord = od.order || {};
                toPhone = ord.phone || ord.billing_address?.phone || ord.customer?.phone || '';
              } catch {}
            }
            const digits = String(toPhone || '').replace(/\D/g, '');
            if (digits.length >= 10) {
              const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
              const deliveredAt = new Date(completedAt || Date.now()).toLocaleString('en-US', {
                timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
              });
              const hasPodPhoto = !!photo;
              const bodyText = `The Sweet Tooth: your order #${orderNumber || orderId} was delivered ${deliveredAt}.` +
                (hasPodPhoto ? ' Timestamped photo confirmation attached.' : '') +
                ' Questions? (305) 682-1400';
              const params = new URLSearchParams({ To: e164, From: TW_FROM, Body: bodyText });
              const baseUrl = getAppBaseUrl(req);
              if (hasPodPhoto && baseUrl) params.append('MediaUrl', `${baseUrl}/api/pod/${orderId}/photo`);
              const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
                method: 'POST',
                headers: {
                  Authorization: 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64'),
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params.toString(),
              });
              const twData: any = await tw.json().catch(() => ({}));
              const twOk = tw.ok && !twData.error_code;
              smsLog.sends.push({
                kind: 'pod', to: e164, body: bodyText, withPhoto: hasPodPhoto,
                sid: twData.sid || null, success: twOk,
                error: twOk ? null : (twData.message || `HTTP ${tw.status}`),
                timestamp: new Date().toISOString(),
              });
              if (smsLog.sends.length > 20) smsLog.sends = smsLog.sends.slice(-20);
              await setKV(smsKey, smsLog);
              console.log(twOk
                ? `✅ Auto-texted delivery confirmation to ${e164} for order ${orderId}${hasPodPhoto ? ' (with photo)' : ''}`
                : `⚠️ Twilio send failed for ${orderId}: ${twData.message || tw.status}`);
            } else {
              console.log(`📱 No usable phone for order ${orderId} — skipping POD text`);
            }
          }
        } catch (smsErr) {
          console.error('Auto-send SMS error (non-fatal):', smsErr);
        }
      }

      res.json({ success: true });
    } catch (e: any) {
      // Surface the real error so the frontend retry loop can act on it instead
      // of silently swallowing. Status 500 → frontend retries; status 503 was
      // already returned above for DB-unreachable bail.
      console.error(`POD handler error for ${orderId}:`, e?.stack || e?.message || e);
      res.status(500).json({ error: 'Failed to save POD', detail: String(e?.message || e) });
    }
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
    
    const results: { orderId: string; email: string; sent: boolean; skipped?: boolean }[] = [];
    const baseUrl = getAppBaseUrl(req);

    for (const o of orders) {
      // Same duplicate guard the normal delivery flow uses — the catch-up button
      // must never email a customer who already got their confirmation. Keyed on
      // orderNumber first so it matches the key the auto-send writes.
      const logKey = String(o.orderNumber || o.orderId);
      if (await podEmailAlreadySent(logKey)) {
        await markPodNotified(String(o.orderId));
        results.push({ orderId: o.orderId, email: o.email, sent: false, skipped: true });
        console.log(`📧 Bulk POD skipped for ${o.orderId} — already sent`);
        continue;
      }

      // Fetch the POD photo for this order
      const podData = await readPodOrder(o.orderId);
      const photo = podData?.confirmationPhoto || podData?.photo || null;
      const hasPhoto = !!photo;

      const detected = await detectGiftFromShopify(String(o.orderId));
      const receiverName = o.receiverName || detected.shippingRecipientName || 'the recipient';

      const { subject, text, html } = buildDeliveryConfirmationEmail({
        variant: detected.isGift ? 'gift' : 'self',
        receiverName,
        deliveryTime: o.deliveryTime || 'today',
        orderId: String(o.orderId),
        orderNumber: o.orderNumber,
        baseUrl,
        hasPhoto
      });

      const sent = await sendEmail(
        o.email,
        subject,
        text,
        hasPhoto ? photo : undefined,
        hasPhoto ? `delivery-${o.orderId}.jpg` : undefined,
        html,
        hasPhoto ? 'proof-photo' : undefined
      );
      await logEmailSend(logKey, o.email, subject, sent);
      if (sent) await markPodNotified(String(o.orderId));
      results.push({ orderId: o.orderId, email: o.email, sent });
      console.log(sent ? `✅ Bulk POD sent to ${o.email}${hasPhoto ? ' (with photo)' : ''}` : `❌ Failed to send to ${o.email}`);
    }

    const sentCount = results.filter(r => r.sent).length;
    const skippedCount = results.filter(r => r.skipped).length;
    res.json({ success: true, sent: sentCount, skipped: skippedCount, total: orders.length, results });
  });

  // ── REVIEW STAR-RATING REDIRECT ─────────────────────────────────────────────
  // Star links in the POD email hit this route. 5★ → Google review. 1-4★ →
  // in-app feedback form that emails Mikey on submit. Every click is logged
  // in KV so we can see who tapped what.
  //
  // First-click-wins lockout: once a customer COMPLETES the review (5★ Google
  // redirect, or a 1-4★ form submit), any further clicks on that order's
  // links — for 30 days — show a "we already have your rating" page and do
  // nothing else (no second Google redirect, no duplicate alert email).
  const REVIEW_LOCK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  type ReviewClick = { timestamp: string; stars: number; completed?: boolean; type?: string; ip?: string | null; userAgent?: string | null };
  async function hasCompletedReviewWithinWindow(orderId: string): Promise<ReviewClick | null> {
    try {
      const logKey = `review_clicks:${orderId}`;
      const existing: any = (await getKV(logKey)) || { clicks: [] };
      const clicks: ReviewClick[] = Array.isArray(existing.clicks) ? existing.clicks : [];
      const now = Date.now();
      const completed = clicks.find((c) => c?.completed === true && (now - new Date(c.timestamp).getTime()) < REVIEW_LOCK_WINDOW_MS);
      return completed || null;
    } catch (e: any) {
      console.error('review lock check failed (non-fatal, allowing):', e?.message || e);
      return null;
    }
  }
  async function logReviewClick(orderId: string, entry: ReviewClick) {
    try {
      const logKey = `review_clicks:${orderId}`;
      const existing: any = (await getKV(logKey)) || { clicks: [] };
      if (!Array.isArray(existing.clicks)) existing.clicks = [];
      existing.clicks.push(entry);
      if (existing.clicks.length > 50) existing.clicks = existing.clicks.slice(-50);
      await setKV(logKey, existing);
    } catch (e: any) {
      console.error('review click log failed (non-fatal):', e?.message || e);
    }
  }
  function renderAlreadyRatedPage(displayOrderNumber: string): string {
    const orderLine = displayOrderNumber
      ? `<div style="font-size:13px;color:#999;margin-top:24px;">Order #${escapeHtmlForEmail(displayOrderNumber)}</div>`
      : '';
    return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thanks</title>
</head>
<body style="margin:0;padding:0;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2a2a2a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf7f2;min-height:100vh;">
  <tr><td align="center" valign="middle" style="padding:48px 16px;">
    <table role="presentation" width="500" cellpadding="0" cellspacing="0" border="0" style="max-width:500px;width:100%;background:#fff;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden;">
      <tr><td align="center" style="background:#2a2a2a;padding:28px 24px;"><img src="/brand/logo.png" alt="The Sweet Tooth" width="220" style="display:block;width:220px;max-width:80%;height:auto;margin:0 auto;border:0;"></td></tr>
      <tr><td align="center" style="padding:40px 32px 16px 32px;font-size:22px;font-weight:600;">Thanks — we already have your rating.</td></tr>
      <tr><td align="center" style="padding:0 32px 40px 32px;">${orderLine}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  }

  app.get("/review/:orderId/:stars", async (req, res) => {
    const orderId = String(req.params.orderId || '');
    const starsRaw = parseInt(String(req.params.stars || ''), 10);
    const stars = Number.isFinite(starsRaw) ? Math.max(1, Math.min(5, starsRaw)) : 0;

    if (!orderId || stars < 1) {
      return res.status(400).send('Invalid review link.');
    }

    // Customer-facing order number, if provided via ?n=… on the link.
    const queryOrderNumber = String(req.query.n || '').trim();
    const displayOrderNumber = queryOrderNumber || '';

    // First-click-wins: if this order already completed a review in the last
    // 30 days, short-circuit. Nothing fires — no Google redirect, no form,
    // no alert email — just a friendly "we already have your rating" page.
    const priorCompleted = await hasCompletedReviewWithinWindow(orderId);
    if (priorCompleted) {
      console.log(`⭐ Review already completed for order ${orderId} (${priorCompleted.stars}★ at ${priorCompleted.timestamp}) — showing lock page`);
      return res.status(200).type('html').send(renderAlreadyRatedPage(displayOrderNumber));
    }

    // Log this click. 5★ is a completion (Google redirect is the submission).
    // 1-4★ is NOT yet a completion — it just opens the form; the POST below
    // is what marks completion.
    await logReviewClick(orderId, {
      timestamp: new Date().toISOString(),
      stars,
      completed: stars >= 5,
      type: stars >= 5 ? 'google-redirect' : 'form-shown',
      ip: req.ip || (req.headers['x-forwarded-for'] as string) || null,
      userAgent: (req.headers['user-agent'] as string) || null
    });
    console.log(`⭐ Review click logged: order ${orderId}, ${stars} stars`);

    // Only 5-star taps go to Google — protects the public review average.
    // Alert Mikey first (fire-and-forget) so every 5★ is visible, then redirect.
    if (stars >= 5) {
      const displayId = displayOrderNumber || orderId;
      sendEmail(
        'raiver72@gmail.com',
        `5★ rating — Order #${displayId}`,
        [
          `Rating: Excellent (5★)`,
          `Order: #${displayId}`,
          `Internal ID: ${orderId}`,
          `Sent to Google: yes`,
          `Clicked: ${new Date().toISOString()}`,
        ].join('\n')
      ).catch((e) => {
        console.error('5-star alert email failed (non-fatal):', e?.message || e);
      });
      return res.redirect(302, 'https://g.page/r/CYK42rbwqajQEAE/review');
    }

    // 1-4 stars: render a feedback form so the customer can actually leave
    // a message. The form posts to /review/:orderId/:stars (same route, POST
    // handler below) which emails the rating + message to Mikey.
    const ratingLabel = ['', 'Poor (1★)', 'Fair (2★)', 'OK (3★)', 'Good (4★)'][stars] || `${stars}★`;
    const orderLine = displayOrderNumber
      ? `<div style="font-size:13px;color:#999;margin-top:24px;">Order #${escapeHtmlForEmail(displayOrderNumber)}</div>`
      : '';

    res.status(200).type('html').send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Share your feedback</title>
</head>
<body style="margin:0;padding:0;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2a2a2a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf7f2;min-height:100vh;">
  <tr><td align="center" valign="middle" style="padding:32px 16px;">
    <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;width:100%;background:#fff;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden;">
      <tr><td align="center" style="background:#2a2a2a;padding:28px 24px;"><img src="/brand/logo.png" alt="The Sweet Tooth" width="220" style="display:block;width:220px;max-width:80%;height:auto;margin:0 auto;border:0;"></td></tr>
      <tr><td align="center" style="padding:36px 32px 8px 32px;font-size:22px;font-weight:600;">Thanks for the ${ratingLabel} rating.</td></tr>
      <tr><td align="center" style="padding:0 32px 24px 32px;font-size:16px;color:#666;line-height:1.6;">Tell us what we could have done better.</td></tr>
      <tr><td style="padding:0 32px 32px 32px;">
        <form method="POST" action="/review/${encodeURIComponent(orderId)}/${stars}" style="margin:0;">
          ${displayOrderNumber ? `<input type="hidden" name="n" value="${escapeHtmlForEmail(displayOrderNumber)}">` : ''}
          <textarea name="message" rows="6" required placeholder="Type your message here…" style="width:100%;box-sizing:border-box;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2a2a2a;padding:14px;border:1px solid #ddd;border-radius:8px;resize:vertical;"></textarea>
          <input type="email" name="email" placeholder="Your email (optional, so we can reply)" style="width:100%;box-sizing:border-box;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2a2a2a;padding:12px 14px;border:1px solid #ddd;border-radius:8px;margin-top:10px;">
          <button type="submit" style="display:block;width:100%;background:#2a2a2a;color:#fff;font-size:16px;font-weight:700;letter-spacing:0.4px;border:0;border-radius:8px;padding:14px;margin-top:14px;cursor:pointer;">Send Feedback</button>
        </form>
        <div align="center">${orderLine}</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`);
  });

  // Receives the form submission from the 1-4 star feedback page.
  app.post("/review/:orderId/:stars", async (req, res) => {
    const orderId = String(req.params.orderId || '');
    const starsRaw = parseInt(String(req.params.stars || ''), 10);
    const stars = Number.isFinite(starsRaw) ? Math.max(1, Math.min(4, starsRaw)) : 0;
    const message = String(req.body?.message || '').trim();
    const customerEmail = String(req.body?.email || '').trim();
    const queryOrderNumber = String(req.body?.n || req.query?.n || '').trim();

    if (!orderId || stars < 1) {
      return res.status(400).send('Invalid review submission.');
    }

    // First-click-wins lock: if a prior submission already marked this order
    // completed (e.g. customer hit submit twice, or rated then refreshed),
    // just render the lock page. Mikey doesn't get a duplicate email.
    const priorCompleted = await hasCompletedReviewWithinWindow(orderId);
    if (priorCompleted) {
      console.log(`⭐ Review POST blocked — order ${orderId} already completed (${priorCompleted.stars}★ at ${priorCompleted.timestamp})`);
      return res.status(200).type('html').send(renderAlreadyRatedPage(queryOrderNumber));
    }

    // Mark this submission as the completed review for the order.
    await logReviewClick(orderId, {
      timestamp: new Date().toISOString(),
      stars,
      completed: true,
      type: 'feedback-submitted',
      ip: req.ip || (req.headers['x-forwarded-for'] as string) || null,
      userAgent: (req.headers['user-agent'] as string) || null
    });

    const ratingLabel = ['', 'Poor (1★)', 'Fair (2★)', 'OK (3★)', 'Good (4★)'][stars] || `${stars}★`;
    const displayId = queryOrderNumber || orderId;
    const alertSubject = `${ratingLabel} rating — Order #${displayId}`;
    const alertBody = [
      `Rating: ${ratingLabel}`,
      `Order: #${displayId}`,
      `Internal ID: ${orderId}`,
      customerEmail ? `Customer email: ${customerEmail}` : `Customer email: (not provided)`,
      `Submitted: ${new Date().toISOString()}`,
      '',
      'Customer message:',
      message || '(no message)'
    ].join('\n');
    sendEmail('raiver72@gmail.com', alertSubject, alertBody).catch((e) => {
      console.error('low-rating feedback email failed:', e?.message || e);
    });

    const orderLine = queryOrderNumber
      ? `<div style="font-size:13px;color:#999;margin-top:24px;">Order #${escapeHtmlForEmail(queryOrderNumber)}</div>`
      : '';

    res.status(200).type('html').send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thanks</title>
</head>
<body style="margin:0;padding:0;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2a2a2a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf7f2;min-height:100vh;">
  <tr><td align="center" valign="middle" style="padding:48px 16px;">
    <table role="presentation" width="500" cellpadding="0" cellspacing="0" border="0" style="max-width:500px;width:100%;background:#fff;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden;">
      <tr><td align="center" style="background:#2a2a2a;padding:28px 24px;"><img src="/brand/logo.png" alt="The Sweet Tooth" width="220" style="display:block;width:220px;max-width:80%;height:auto;margin:0 auto;border:0;"></td></tr>
      <tr><td align="center" style="padding:40px 32px 16px 32px;font-size:22px;font-weight:600;">Thanks — got it.</td></tr>
      <tr><td align="center" style="padding:0 32px 24px 32px;font-size:16px;color:#666;line-height:1.6;">Your message has been received.</td></tr>
      <tr><td align="center" style="padding:0 32px 40px 32px;">${orderLine}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`);
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

  // ── EMAIL LOG (audit trail for delivery-confirmation emails) ────────────────
  app.get('/api/email-log/:orderNumber', async (req, res) => {
    try {
      const key = `email_log:${req.params.orderNumber}`;
      const log = await getKV(key);
      res.json(log || { sends: [] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // List all email logs (most recent first) for admin audit view
  app.get('/api/email-log', async (_req, res) => {
    try {
      if (!pool) return res.json({ logs: [] });
      const r = await pool.query("SELECT key, value FROM kv_store WHERE key LIKE 'email_log:%' ORDER BY updated_at DESC LIMIT 200");
      const logs = r.rows.map((row: any) => {
        let parsed: any = {};
        try { parsed = JSON.parse(row.value); } catch {}
        return { orderNumber: row.key.replace('email_log:', ''), ...parsed };
      });
      res.json({ logs });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // ── POD DEBUG (read-only diagnostic for POD storage issues) ─────────────────
  app.get('/api/debug/pod-check/:orderId', async (req, res) => {
    const orderId = req.params.orderId;
    const result: any = { orderId };

    // Each query isolated — one failure doesn't break the rest
    try {
      const direct = await readPodOrder(orderId);
      result.directReadHasData = direct && Object.keys(direct).length > 0;
      result.directReadKeys = direct ? Object.keys(direct) : [];
      result.directRead = direct;
    } catch (e: any) { result.directReadError = String(e?.message || e); }

    try {
      const light = await readPodDataLight();
      result.existsInLightData = !!light[orderId];
      result.lightDataForOrder = light[orderId] || null;
      result.totalKeysInLightData = Object.keys(light).length;
      result.sampleLightKeys = Object.keys(light).slice(0, 10);
    } catch (e: any) { result.lightDataError = String(e?.message || e); }

    if (pool) {
      try {
        const c = await pool.query("SELECT COUNT(*) FROM kv_store WHERE key LIKE 'pod:%'");
        result.totalPodKeysInDb = c.rows[0].count;
      } catch (e: any) { result.countError = String(e?.message || e); }

      try {
        const s = await pool.query("SELECT key FROM kv_store WHERE key LIKE 'pod:%' ORDER BY updated_at DESC LIMIT 10");
        result.sampleRawKeys = s.rows.map((r: any) => r.key);
      } catch (e: any) { result.sampleKeysError = String(e?.message || e); }

      // Direct lookup for this specific key
      try {
        const d = await pool.query("SELECT key, updated_at, length(value) as size FROM kv_store WHERE key=$1", [`pod:${orderId}`]);
        result.directRowExists = d.rows.length > 0;
        result.directRow = d.rows[0] || null;
      } catch (e: any) { result.directRowError = String(e?.message || e); }
    } else {
      result.poolStatus = 'no-pool';
    }

    res.json(result);
  });

  // ── REVIEW LOG (read-only: see who tapped which star for an order) ───────────
  // Accepts the customer-facing order number (e.g. 35785) OR the internal
  // Shopify order ID. The review_clicks KV key uses the internal ID, so we
  // resolve the friendly number via Shopify first, then read the log.
  app.get('/api/debug/review-log/:order', async (req, res) => {
    const raw = String(req.params.order || '').replace(/^#+/, '').trim();
    const result: any = { input: raw };
    try {
      const candidateIds: string[] = [];
      if (/^\d{10,}$/.test(raw)) candidateIds.push(raw); // already looks like an internal Shopify id

      // Resolve order number -> internal Shopify order id.
      try {
        const url = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders.json?name=${encodeURIComponent(raw)}&status=any&limit=5`;
        const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' } });
        const data = await resp.json();
        const order = data.orders?.[0];
        if (order) {
          result.resolvedOrderName = order.name;
          result.resolvedOrderId = String(order.id);
          candidateIds.push(String(order.id));
        }
      } catch (e: any) { result.shopifyLookupError = String(e?.message || e); }

      result.logs = [];
      for (const id of [...new Set(candidateIds)]) {
        const log: any = await getKV(`review_clicks:${id}`);
        if (log) result.logs.push({ orderId: id, ...log });
      }

      const allClicks = result.logs.flatMap((l: any) => Array.isArray(l.clicks) ? l.clicks : []);
      const completed = allClicks.find((c: any) => c?.completed === true);
      result.summary = {
        totalClicks: allClicks.length,
        completed: completed
          ? { stars: completed.stars, type: completed.type, timestamp: completed.timestamp }
          : null,
        whereItWent: completed
          ? (completed.stars >= 5
              ? 'Redirected to Google review page — no internal record kept. Check your Google Business reviews.'
              : '1-4★ feedback was emailed to raiver72@gmail.com. Check that inbox (and spam).')
          : 'No completed review found for this order.'
      };

      res.json(result);
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  // ── MANUAL ORDERS ───────────────────────────────────────────────────────────

  app.get('/api/manual-orders', async (_req, res) => {
    try {
      const orders = await dbGet('manual_orders') || [];
      res.json({ orders });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Generate manual order number in MMDD-NN format (e.g., M-0429-01)
  // Counts existing manual orders for today and increments the sequence
  async function generateManualOrderNumber(): Promise<string> {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${mm}${dd}`;
    const existing = await dbGet('manual_orders') || [];
    const todayCount = existing.filter((o: any) =>
      typeof o.orderNumber === 'string' && o.orderNumber.startsWith(`M-${datePrefix}-`)
    ).length;
    const seq = String(todayCount + 1).padStart(2, '0');
    return `M-${datePrefix}-${seq}`;
  }

  app.post('/api/manual-orders', async (req, res) => {
    try {
      const orders = await dbGet('manual_orders') || [];
      const now = new Date().toISOString();
      const id = `manual_${Date.now()}`;
      const order = {
        id,
        orderNumber: req.body.orderNumber || await generateManualOrderNumber(),
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
        giftSenderEmail: req.body.giftSenderEmail || '',
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

  // Manual trigger for the 7-day photo retention sweep (same job that runs
  // daily). Returns counts so you can see what it removed.
  app.post('/api/admin/cleanup-old-photos', async (_req, res) => {
    try {
      res.json(await cleanupOldPodPhotos());
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // One-shot recovery: find POD records that are missing photoR2Key/signatureR2Key
  // but whose photo DID make it to Cloudflare (the DB write failed after the R2
  // upload succeeded). For each orphan, probe the expected R2 keys and patch the
  // POD record if a match is found.
  //
  // Safe to run multiple times — records that already have a key are skipped.
  // Only writes to kv_store (UPDATE on the pod:{id} row). Does NOT send emails,
  // texts, or any other notification, and does NOT touch Shopify tags.
  // Registered outside the dev-only block on purpose so it's callable in prod.
  app.post('/api/admin/heal-orphan-photos', async (_req, res) => {
    if (!pool) return res.status(500).json({ error: 'DB not configured' });
    if (!R2) return res.status(500).json({ error: 'R2 not configured' });

    const summary = {
      scanned: 0,
      orphans: 0,
      healed: 0,
      unhealable: 0,
      healedDetails: [] as any[],
      unhealedDetails: [] as any[],
    };

    try {
      // Build orderId → orderNumber map from recent Shopify orders. The R2 key
      // uses orderNumber (e.g. "35363"), but the kv_store key uses orderId
      // (Shopify numeric ID). Limit to last 30 days — enough to cover any
      // orphan caused by the recent silent-failure bug.
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const orderMap = new Map<string, string>();
      const shopUrl = `https://${SHOPIFY_STORE_URL}/admin/api/2025-01/orders.json?status=any&limit=250&created_at_min=${thirtyDaysAgo}`;
      try {
        const shopResp = await fetch(shopUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } });
        if (shopResp.ok) {
          const shopData: any = await shopResp.json();
          for (const o of (shopData.orders || [])) {
            const safeNum = String(o.name || '').replace(/[^a-zA-Z0-9]/g, '');
            if (safeNum) orderMap.set(String(o.id), safeNum);
          }
        }
      } catch (shopErr: any) {
        console.error('heal: Shopify fetch error:', shopErr?.message || shopErr);
      }

      const podRows = await pool.query("SELECT key, value FROM kv_store WHERE key LIKE 'pod:%'");
      summary.scanned = podRows.rows.length;

      for (const row of podRows.rows) {
        let data: any;
        try { data = JSON.parse(row.value); } catch { continue; }
        const orderId = String(row.key).replace('pod:', '');

        // Skip if already has a key or legacy inline base64 — not an orphan.
        if (data.photoR2Key || data.signatureR2Key) continue;
        if (data.photo || data.confirmationPhoto) continue;
        // Skip records without completedAt — not delivered, no photo expected.
        if (!data.completedAt) continue;

        summary.orphans++;

        const orderNumber = orderMap.get(orderId);
        if (!orderNumber) {
          summary.unhealable++;
          summary.unhealedDetails.push({ orderId, reason: 'orderId not in last 30 days of Shopify orders' });
          continue;
        }

        let etDate: string;
        try {
          etDate = new Date(data.completedAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        } catch {
          summary.unhealable++;
          summary.unhealedDetails.push({ orderId, orderNumber, reason: 'invalid completedAt' });
          continue;
        }

        // Probe base key + up to -5 suffix. Highest-numbered hit wins (most recent retake).
        let foundPhotoKey: string | null = null;
        const basePhoto = `photos/${etDate}/${orderNumber}.jpg`;
        if (await r2KeyExists(basePhoto)) foundPhotoKey = basePhoto;
        for (let i = 2; i <= 5; i++) {
          const k = `photos/${etDate}/${orderNumber}-${i}.jpg`;
          if (await r2KeyExists(k)) foundPhotoKey = k;
        }

        let foundSigKey: string | null = null;
        const baseSig = `signatures/${etDate}/${orderNumber}.png`;
        if (await r2KeyExists(baseSig)) foundSigKey = baseSig;
        for (let i = 2; i <= 5; i++) {
          const k = `signatures/${etDate}/${orderNumber}-${i}.png`;
          if (await r2KeyExists(k)) foundSigKey = k;
        }

        if (!foundPhotoKey && !foundSigKey) {
          summary.unhealable++;
          summary.unhealedDetails.push({ orderId, orderNumber, etDate, reason: 'no matching R2 object' });
          continue;
        }

        // Patch only the photo/signature key fields. Do NOT touch anything else —
        // no emails, no Shopify tag writes, no notifications.
        if (foundPhotoKey) data.photoR2Key = foundPhotoKey;
        if (foundSigKey) data.signatureR2Key = foundSigKey;
        await pool.query(
          'UPDATE kv_store SET value=$1, updated_at=NOW() WHERE key=$2',
          [JSON.stringify(data), row.key]
        );
        summary.healed++;
        summary.healedDetails.push({ orderId, orderNumber, photoR2Key: foundPhotoKey, signatureR2Key: foundSigKey });
      }

      res.json(summary);
    } catch (e: any) {
      console.error('heal-orphan-photos error:', e?.stack || e?.message || e);
      res.status(500).json({ error: String(e?.message || e), summary });
    }
  });

  // ── STATIC / VITE ───────────────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    // Vite is dev-only — dynamic import keeps the whole build toolchain out of
    // production memory (it was ~40+ MB of permanent baseline on Render).
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  // One-time migration: rename "Mikey" to "Mike" in all POD records and Shopify tags
  app.post('/api/admin/migrate-mikey-to-mike', async (_req, res) => {
    try {
      // 1. Fix all pod: keys in PostgreSQL — driverName Mikey→Mike AND driverId super_admin→mike_b
      const podRows = await pool.query("SELECT key, value FROM kv_store WHERE key LIKE 'pod:%'");
      let podFixed = 0;
      for (const row of podRows.rows) {
        const data = JSON.parse(row.value);
        let rowChanged = false;
        if (data.driverName === 'Mikey') { data.driverName = 'Mike'; rowChanged = true; }
        if (data.driverId === 'super_admin') { data.driverId = 'mike_b'; rowChanged = true; }
        if (rowChanged) {
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
          if (o.driverId === 'super_admin') { o.driverId = 'mike_b'; changed = true; manualFixed++; }
        }
        if (changed) await setKV('manual_orders', JSON.stringify(manualOrders));
      }

      // 3. Fix Shopify tags: drivername Mikey→Mike AND st_driver:super_admin → st_driver:mike_b
      let shopifyFixed = 0;
      try {
        const queries = [
          `tag=st_drivername:Mikey`,
          `tag=st_driver:super_admin`,
        ];
        const seen = new Set<string>();
        for (const q of queries) {
          const shopifyRes = await fetch(
            `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/orders.json?${q}&status=any&limit=250`,
            { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN || '' } }
          );
          const shopifyData = await shopifyRes.json() as { orders?: any[] };
          const orders = shopifyData.orders || [];
          for (const order of orders) {
            if (seen.has(String(order.id))) continue;
            seen.add(String(order.id));
            const currentTags: string = order.tags || '';
            const newTags = currentTags
              .split(',')
              .map((t: string) => t.trim())
              .map((t: string) => t === 'st_drivername:Mikey' ? 'st_drivername:Mike' : t)
              .map((t: string) => t === 'st_driver:super_admin' ? 'st_driver:mike_b' : t)
              .join(', ');
            await fetch(
              `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/orders/${order.id}.json`,
              { method: 'PUT', headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN || '', 'Content-Type': 'application/json' },
                body: JSON.stringify({ order: { id: order.id, tags: newTags } }) }
            );
            shopifyFixed++;
          }
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
