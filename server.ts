import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || '';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@thesweettooth.com';
const KATIE_PHONE = '(305) 994-4070';

// --- File paths ---
const POD_STORAGE_PATH = path.join(__dirname, "pod_data.json");
const USERS_PATH = path.join(__dirname, "users.json");
const TEMPLATES_PATH = path.join(__dirname, "templates.json");

// --- Initialize storage files ---
if (!fs.existsSync(POD_STORAGE_PATH)) fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify({}));

if (!fs.existsSync(USERS_PATH)) {
  const defaultUsers = [
    {
      id: "super_admin",
      name: "Mikey",
      pin: "1979",
      role: "SUPER_ADMIN",
      isActive: true,
      failedAttempts: 0,
      createdAt: new Date().toISOString()
    },
    {
      id: "manager_1",
      name: "Katie",
      pin: "4070",
      role: "MANAGER",
      phone: "3059944070",
      isActive: true,
      failedAttempts: 0,
      createdAt: new Date().toISOString()
    }
  ];
  fs.writeFileSync(USERS_PATH, JSON.stringify(defaultUsers, null, 2));
}

if (!fs.existsSync(TEMPLATES_PATH)) {
  const defaultTemplates = [
    {
      id: "SUCCESS",
      label: "Delivery Successful",
      body: "Hi {{customer_name}}! 🍫 Your Sweet Tooth order #{{order_number}} was just delivered to {{address}}. We hope you love it! Thank you for choosing The Sweet Tooth."
    },
    {
      id: "FAILURE",
      label: "Delivery Attempted – Please Reschedule",
      body: "Hi {{customer_name}}, we attempted to deliver your Sweet Tooth order #{{order_number}} to {{address}} but were unable to complete the delivery. Please text Katie at {{katie_phone}} to reschedule. We're sorry for the inconvenience!"
    }
  ];
  fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(defaultTemplates, null, 2));
}

// --- Helpers ---
function readUsers() { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8')); }
function writeUsers(users: any[]) { fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2)); }
function readTemplates() { return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf-8')); }

function isWithinSendingHours(): boolean {
  const now = new Date();
  const hour = now.getHours(); // server local time — adjust if needed
  return hour >= 9 && hour < 20; // 9am–8pm
}

function interpolateTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/{{(\w+)}}/g, (_, key) => vars[key] || '');
}

async function sendSMS(to: string, body: string): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) return false;
  const cleanPhone = to.replace(/\D/g, '');
  const e164 = cleanPhone.startsWith('1') ? `+${cleanPhone}` : `+1${cleanPhone}`;
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const encoded = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: e164, From: TWILIO_FROM_NUMBER, Body: body }).toString()
    });
    return resp.ok;
  } catch { return false; }
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
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  app.use(express.json({ limit: '50mb' }));

  // ─── AUTH ───────────────────────────────────────────────────────────────────

  app.post("/api/auth/login", (req, res) => {
    const { pin, name } = req.body;
    const users = readUsers();
    const user = users.find((u: any) => u.name.toLowerCase() === (name || '').toLowerCase());

    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.isActive) return res.status(403).json({ error: "Account is inactive" });

    // Check lockout
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return res.status(403).json({ error: "Account temporarily locked. Try again later." });
    }

    if (user.pin !== pin) {
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      if (user.failedAttempts >= 3) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min
        user.lockedUntil = lockUntil.toISOString();
        user.failedAttempts = 0;
      }
      writeUsers(users);
      return res.status(401).json({ error: "Incorrect PIN", failedAttempts: user.failedAttempts });
    }

    // Success — reset attempts
    user.failedAttempts = 0;
    user.lockedUntil = undefined;
    writeUsers(users);

    const { pin: _, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  // ─── USERS (Admin/Manager only) ─────────────────────────────────────────────

  app.get("/api/users", (_req, res) => {
    const users = readUsers().map(({ pin: _, ...u }: any) => u);
    res.json({ users });
  });

  app.post("/api/users", (req, res) => {
    const { name, pin, role, phone, email, vehicle } = req.body;
    if (!name || !pin || !role) return res.status(400).json({ error: "name, pin, role required" });
    const users = readUsers();
    if (users.find((u: any) => u.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: "A user with that name already exists" });
    }
    const newUser = {
      id: `driver_${Date.now()}`,
      name, pin, role,
      phone: phone || '', email: email || '', vehicle: vehicle || '',
      isActive: true, failedAttempts: 0,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeUsers(users);
    const { pin: _, ...safeUser } = newUser;
    res.json({ user: safeUser });
  });

  app.patch("/api/users/:id", (req, res) => {
    const users = readUsers();
    const idx = users.findIndex((u: any) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "User not found" });
    users[idx] = { ...users[idx], ...req.body };
    writeUsers(users);
    const { pin: _, ...safeUser } = users[idx];
    res.json({ user: safeUser });
  });

  app.delete("/api/users/:id", (req, res) => {
    const users = readUsers();
    const filtered = users.filter((u: any) => u.id !== req.params.id);
    writeUsers(filtered);
    res.json({ success: true });
  });

  app.post("/api/users/:id/reset-pin", (req, res) => {
    const { newPin } = req.body;
    if (!newPin || newPin.length !== 4) return res.status(400).json({ error: "4-digit PIN required" });
    const users = readUsers();
    const idx = users.findIndex((u: any) => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "User not found" });
    users[idx].pin = newPin;
    users[idx].lockedUntil = undefined;
    users[idx].failedAttempts = 0;
    writeUsers(users);
    res.json({ success: true });
  });

  // ─── ORDERS (Shopify) ────────────────────────────────────────────────────────

  app.get("/api/orders", async (req, res) => {
    try {
      const shopifyUrl = `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders.json?status=open&limit=50`;
      const response = await fetch(shopifyUrl, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error("Shopify API failed");
      const data = await response.json();
      const filteredOrders = data.orders.filter((order: any) => {
        const tags = order.tags ? order.tags.split(',').map((t: string) => t.trim()) : [];
        return tags.includes('Local Delivery');
      });
      const podData = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
      res.json({ orders: filteredOrders, podData });
    } catch (error) {
      console.error("Shopify Fetch Error:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Reassign a delivery to a different driver
  app.patch("/api/orders/:id/assign", (req, res) => {
    const { driverId, driverName } = req.body;
    const podData = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    if (!podData[req.params.id]) podData[req.params.id] = {};
    podData[req.params.id].driverId = driverId;
    podData[req.params.id].driverName = driverName;
    fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(podData, null, 2));
    res.json({ success: true });
  });

  // Admin add note to order
  app.post("/api/orders/:id/note", (req, res) => {
    const { note } = req.body;
    const podData = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
    if (!podData[req.params.id]) podData[req.params.id] = {};
    podData[req.params.id].adminNotes = podData[req.params.id].adminNotes
      ? `${podData[req.params.id].adminNotes}\n[${new Date().toLocaleString()}] ${note}`
      : `[${new Date().toLocaleString()}] ${note}`;
    fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(podData, null, 2));
    res.json({ success: true });
  });

  // ─── POD ────────────────────────────────────────────────────────────────────

  app.post("/api/pod", (req, res) => {
    const { orderId, photo, signature, notes, completedAt, status, driverId, driverName } = req.body;
    try {
      const podData = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
      podData[orderId] = {
        ...podData[orderId],
        photo, signature, notes, completedAt,
        submittedAt: new Date().toISOString(), // always stamp when submitted
        status, driverId, driverName
      };
      fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(podData, null, 2));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save POD" });
    }
  });

  // ─── MESSAGE TEMPLATES ───────────────────────────────────────────────────────

  app.get("/api/templates", (_req, res) => {
    res.json({ templates: readTemplates() });
  });

  app.patch("/api/templates/:id", (req, res) => {
    const templates = readTemplates();
    const idx = templates.findIndex((t: any) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Template not found" });
    templates[idx] = { ...templates[idx], ...req.body };
    fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2));
    res.json({ template: templates[idx] });
  });

  // ─── SEND NOTIFICATION ──────────────────────────────────────────────────────

  app.post("/api/notify", async (req, res) => {
    const { type, order } = req.body; // type: 'SUCCESS' | 'FAILURE'
    
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
      katie_phone: KATIE_PHONE
    };

    const message = interpolateTemplate(template.body, vars);
    const phone = order.customer?.phone;
    const email = order.customer?.email;

    let sent = false;
    let channel = '';

    if (phone && phone.replace(/\D/g, '').length >= 10) {
      sent = await sendSMS(phone, message);
      channel = 'SMS';
    } else if (email) {
      const subject = type === 'SUCCESS'
        ? `Your Sweet Tooth Delivery is Complete! 🍫`
        : `Sweet Tooth Delivery Update – Order #${order.orderNumber}`;
      sent = await sendEmail(email, subject, message);
      channel = 'Email';
    }

    if (sent) {
      // Mark notification as sent in POD data
      const podData = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
      if (!podData[order.id]) podData[order.id] = {};
      podData[order.id][type === 'SUCCESS' ? 'successNotificationSent' : 'failureNotificationSent'] = true;
      fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(podData, null, 2));
    }

    res.json({ sent, channel, message, preview: message });
  });

  // Preview what a message will look like before sending
  app.post("/api/notify/preview", (req, res) => {
    const { type, order } = req.body;
    const templates = readTemplates();
    const template = templates.find((t: any) => t.id === type);
    if (!template) return res.status(400).json({ error: "Template not found" });
    const vars: Record<string, string> = {
      customer_name: order.customer?.name || 'Valued Customer',
      order_number: order.orderNumber || '',
      driver_name: order.driverName || 'your driver',
      address: order.address ? `${order.address.street}, ${order.address.city}` : '',
      katie_phone: KATIE_PHONE
    };
    res.json({ preview: interpolateTemplate(template.body, vars), channel: (order.customer?.phone ? 'SMS' : 'Email') });
  });

  // ─── VITE / STATIC ──────────────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🍫 Sweet Tooth Driver App running on http://localhost:${PORT}`);
  });
}

startServer();
