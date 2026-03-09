import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHOPIFY_STORE_URL = 'thesweettoothfl.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = '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'; 

const POD_STORAGE_PATH = path.join(__dirname, "pod_data.json");

// Initialize POD storage if it doesn't exist
if (!fs.existsSync(POD_STORAGE_PATH)) {
  fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify({}));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API: Fetch Orders from Shopify (Server-side to avoid CORS and hide token)
  app.get("/api/orders", async (req, res) => {
    try {
      // Fetch open orders
      const shopifyUrl = `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders.json?status=open&limit=50`;
      const response = await fetch(shopifyUrl, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) throw new Error("Shopify API failed");
      const data = await response.json();
      
      // Filter for 'Local Delivery' tag
      const filteredOrders = data.orders.filter((order: any) => {
        const tags = order.tags ? order.tags.split(',').map((t: string) => t.trim()) : [];
        return tags.includes('Local Delivery');
      });

      // Load saved POD data to merge with orders
      const podData = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
      
      res.json({ orders: filteredOrders, podData });
    } catch (error) {
      console.error("Shopify Fetch Error:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // API: Save Proof of Delivery
  app.post("/api/pod", (req, res) => {
    const { orderId, photo, signature, notes, completedAt, status } = req.body;
    
    try {
      const podData = JSON.parse(fs.readFileSync(POD_STORAGE_PATH, 'utf-8'));
      podData[orderId] = { photo, signature, notes, completedAt, status };
      fs.writeFileSync(POD_STORAGE_PATH, JSON.stringify(podData, null, 2));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save POD" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
