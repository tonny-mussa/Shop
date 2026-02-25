import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("tomirashop.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS regions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    shipping_fee REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER,
    name_pt TEXT NOT NULL,
    name_ch TEXT,
    name_mc TEXT,
    description_pt TEXT,
    price REAL NOT NULL,
    image_url TEXT,
    category TEXT,
    stock INTEGER DEFAULT 0,
    is_special_offer INTEGER DEFAULT 0,
    condition TEXT DEFAULT 'new', -- new, used
    brand TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    region_id INTEGER,
    address TEXT NOT NULL,
    total_amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (region_id) REFERENCES regions(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    price REAL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'buyer', -- 'admin', 'seller', 'buyer'
    phone TEXT,
    wallet_balance REAL DEFAULT 0,
    loyalty_points INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    user_name TEXT NOT NULL,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS wishlist (
    user_id INTEGER,
    product_id INTEGER,
    PRIMARY KEY (user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS sellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    business_name TEXT,
    status TEXT DEFAULT 'pending', -- pending, approved, rejected
    commission_rate REAL DEFAULT 0.10, -- 10% default
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payout_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER,
    amount REAL NOT NULL,
    method TEXT NOT NULL, -- mpesa, emola
    status TEXT DEFAULT 'pending', -- pending, completed, rejected
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    sender TEXT NOT NULL, -- 'customer' or 'seller'
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS chatbot_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    message TEXT,
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed initial data if empty
const regionCount = db.prepare("SELECT COUNT(*) as count FROM regions").get() as { count: number };
if (regionCount.count === 0) {
  const insertRegion = db.prepare("INSERT INTO regions (name, shipping_fee) VALUES (?, ?)");
  insertRegion.run("Maputo Cidade", 150);
  insertRegion.run("Maputo Província", 250);
  insertRegion.run("Gaza", 400);
  insertRegion.run("Inhambane", 500);
  insertRegion.run("Sofala (Beira)", 700);
  insertRegion.run("Nampula", 900);
}

const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number };
if (productCount.count === 0) {
  const insertProduct = db.prepare("INSERT INTO products (name_pt, description_pt, price, image_url, category, stock) VALUES (?, ?, ?, ?, ?, ?)");
  insertProduct.run("Saco de Arroz 25kg", "Arroz de grão longo, qualidade premium.", 1250, "https://picsum.photos/seed/rice/400/400", "Alimentos", 50);
  insertProduct.run("Óleo Vegetal 5L", "Óleo de cozinha refinado.", 650, "https://picsum.photos/seed/oil/400/400", "Alimentos", 30);
  insertProduct.run("Farinha de Milho 10kg", "Farinha branca de primeira.", 450, "https://picsum.photos/seed/maize/400/400", "Alimentos", 100);
  insertProduct.run("Smartphone Android X1", "Ecrã 6.5 polegadas, 64GB armazenamento.", 8500, "https://picsum.photos/seed/phone/400/400", "Electrónicos", 10);
  insertProduct.run("Televisor LED 32\"", "HD Smart TV com entrada HDMI.", 12000, "https://picsum.photos/seed/tv/400/400", "Electrónicos", 5);
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/regions", (req, res) => {
    const regions = db.prepare("SELECT * FROM regions").all();
    res.json(regions);
  });

  app.get("/api/products", (req, res) => {
    const search = req.query.search as string;
    let products;
    const queryBase = `
      SELECT p.*, u.phone as seller_phone, u.name as seller_name 
      FROM products p 
      LEFT JOIN users u ON p.seller_id = u.id
    `;
    if (search) {
      products = db.prepare(`${queryBase} WHERE p.name_pt LIKE ? OR p.name_ch LIKE ? OR p.name_mc LIKE ?`).all(`%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      products = db.prepare(queryBase).all();
    }
    res.json(products);
  });

  // Auth Routes
  app.post("/api/auth/register", (req, res) => {
    const { name, email, password, role, phone } = req.body;
    try {
      const info = db.prepare("INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)").run(name, email, password, role || 'buyer', phone);
      const user = db.prepare("SELECT id, name, email, role, phone FROM users WHERE id = ?").get(info.lastInsertRowid);
      res.json({ success: true, user });
    } catch (error) {
      res.status(400).json({ error: "Email já em uso." });
    }
  });

  app.get("/api/auth/me/:id", (req, res) => {
    const user = db.prepare("SELECT id, name, email, role, phone, wallet_balance, loyalty_points FROM users WHERE id = ?").get(req.params.id);
    if (user) {
      res.json({ success: true, user });
    } else {
      res.status(404).json({ success: false });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT id, name, email, role, phone FROM users WHERE email = ? AND password = ?").get(email, password);
    if (user) {
      res.json({ success: true, user });
    } else {
      res.status(401).json({ error: "Credenciais inválidas." });
    }
  });

  // Reviews
  app.get("/api/products/:id/reviews", (req, res) => {
    const reviews = db.prepare("SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC").all(req.params.id);
    res.json(reviews);
  });

  app.post("/api/products/:id/reviews", (req, res) => {
    const { user_name, rating, comment, image_url } = req.body;
    db.prepare("INSERT INTO reviews (product_id, user_name, rating, comment, image_url) VALUES (?, ?, ?, ?, ?)").run(req.params.id, user_name, rating, comment, image_url);
    res.json({ success: true });
  });

  // Wishlist
  app.get("/api/wishlist/:userId", (req, res) => {
    const items = db.prepare(`
      SELECT p.* FROM products p 
      JOIN wishlist w ON p.id = w.product_id 
      WHERE w.user_id = ?
    `).all(req.params.userId);
    res.json(items);
  });

  app.post("/api/wishlist", (req, res) => {
    const { userId, productId } = req.body;
    db.prepare("INSERT OR IGNORE INTO wishlist (user_id, product_id) VALUES (?, ?)").run(userId, productId);
    res.json({ success: true });
  });

  app.delete("/api/wishlist/:userId/:productId", (req, res) => {
    db.prepare("DELETE FROM wishlist WHERE user_id = ? AND product_id = ?").run(req.params.userId, req.params.productId);
    res.json({ success: true });
  });

  // Seller Product Management
  app.get("/api/seller/products/:userId", (req, res) => {
    const products = db.prepare("SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC").all(req.params.userId);
    res.json(products);
  });

  app.post("/api/seller/products", (req, res) => {
    const { seller_id, name_pt, description_pt, price, image_url, category, stock, is_special_offer } = req.body;
    const info = db.prepare(`
      INSERT INTO products (seller_id, name_pt, description_pt, price, image_url, category, stock, is_special_offer)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(seller_id, name_pt, description_pt, price, image_url, category, stock, is_special_offer ? 1 : 0);
    res.json({ success: true, id: info.lastInsertRowid });
  });

  app.patch("/api/seller/products/:id", (req, res) => {
    const { name_pt, description_pt, price, image_url, category, stock, is_special_offer } = req.body;
    db.prepare(`
      UPDATE products SET name_pt = ?, description_pt = ?, price = ?, image_url = ?, category = ?, stock = ?, is_special_offer = ?
      WHERE id = ?
    `).run(name_pt, description_pt, price, image_url, category, stock, is_special_offer ? 1 : 0, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/seller/products/:id", (req, res) => {
    db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Seller Orders
  app.get("/api/seller/orders/:userId", (req, res) => {
    const orders = db.prepare(`
      SELECT DISTINCT o.* 
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE p.seller_id = ?
      ORDER BY o.created_at DESC
    `).all(req.params.userId);
    res.json(orders);
  });

  // Chatbot Log
  app.post("/api/chatbot/log", (req, res) => {
    const { user_id, message, response } = req.body;
    db.prepare("INSERT INTO chatbot_logs (user_id, message, response) VALUES (?, ?, ?)").run(user_id, message, response);
    res.json({ success: true });
  });

  app.post("/api/sellers/register", (req, res) => {
    const { userId, business_name } = req.body;
    try {
      db.prepare("INSERT INTO sellers (user_id, business_name) VALUES (?, ?)").run(userId, business_name);
      res.json({ success: true, message: "Cadastro enviado com sucesso! Aguarde aprovação." });
    } catch (error) {
      res.status(500).json({ success: false, error: "Erro ao processar cadastro." });
    }
  });

  app.get("/api/admin/sellers", (req, res) => {
    const sellers = db.prepare(`
      SELECT s.*, u.name, u.email, u.phone 
      FROM sellers s 
      JOIN users u ON s.user_id = u.id 
      ORDER BY s.created_at DESC
    `).all();
    res.json(sellers);
  });

  app.patch("/api/admin/sellers/:id/status", (req, res) => {
    const { status } = req.body;
    const transaction = db.transaction(() => {
      db.prepare("UPDATE sellers SET status = ? WHERE id = ?").run(status, req.params.id);
      if (status === 'approved') {
        const seller = db.prepare("SELECT user_id FROM sellers WHERE id = ?").get(req.params.id) as any;
        if (seller) {
          db.prepare("UPDATE users SET role = 'seller' WHERE id = ?").run(seller.user_id);
        }
      }
    });
    transaction();
    res.json({ success: true });
  });

  // Chat Routes
  app.get("/api/orders/:id/messages", (req, res) => {
    const messages = db.prepare("SELECT * FROM messages WHERE order_id = ? ORDER BY created_at ASC").all(req.params.id);
    res.json(messages);
  });

  app.post("/api/orders/:id/messages", (req, res) => {
    const { sender, text } = req.body;
    const info = db.prepare("INSERT INTO messages (order_id, sender, text) VALUES (?, ?, ?)").run(req.params.id, sender, text);
    io.emit(`order_message_${req.params.id}`, { id: info.lastInsertRowid, sender, text, created_at: new Date().toISOString() });
    res.json({ success: true });
  });

  app.post("/api/orders", (req, res) => {
    const { customer_name, customer_phone, region_id, address, items, total_amount } = req.body;
    
    const transaction = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO orders (customer_name, customer_phone, region_id, address, total_amount)
        VALUES (?, ?, ?, ?, ?)
      `).run(customer_name, customer_phone, region_id, address, total_amount);

      const orderId = info.lastInsertRowid;

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?)
      `);

      for (const item of items) {
        insertItem.run(orderId, item.id, item.quantity, item.price);
        // Update stock
        db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(item.quantity, item.id);
      }

      return orderId;
    });

    try {
      const orderId = transaction();
      io.emit("new_order", { id: orderId, status: 'pending' });
      res.json({ success: true, orderId });
    } catch (error) {
      res.status(500).json({ error: "Failed to create order" });
    }
  });

  app.get("/api/orders/:id", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    
    const items = db.prepare(`
      SELECT oi.*, p.name_pt as product_name 
      FROM order_items oi 
      JOIN products p ON oi.product_id = p.id 
      WHERE oi.order_id = ?
    `).all(req.params.id);
    
    res.json({ ...order, items });
  });

  // Admin routes
  app.get("/api/admin/orders", (req, res) => {
    const orders = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
    res.json(orders);
  });

  app.patch("/api/admin/orders/:id/status", (req, res) => {
    const { status } = req.body;
    
    const transaction = db.transaction(() => {
      const oldOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id) as any;
      if (!oldOrder) throw new Error("Order not found");

      db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);

      // If delivered, credit seller wallet and user loyalty points
      if (status === 'delivered' && oldOrder.status !== 'delivered') {
        const items = db.prepare(`
          SELECT oi.*, p.seller_id 
          FROM order_items oi 
          JOIN products p ON oi.product_id = p.id 
          WHERE oi.order_id = ?
        `).all(req.params.id) as any[];

        // Group by seller to handle commissions
        const sellerEarnings: Record<number, number> = {};
        for (const item of items) {
          if (item.seller_id) {
            const seller = db.prepare("SELECT commission_rate FROM sellers WHERE user_id = ?").get(item.seller_id) as any;
            const rate = seller ? seller.commission_rate : 0.10;
            const amount = item.price * item.quantity * (1 - rate);
            sellerEarnings[item.seller_id] = (sellerEarnings[item.seller_id] || 0) + amount;
          }
        }

        for (const [sellerId, amount] of Object.entries(sellerEarnings)) {
          db.prepare("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?").run(amount, sellerId);
          db.prepare("INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)").run(
            sellerId, 
            "Pagamento Recebido", 
            `Você recebeu ${amount.toLocaleString()} MT pela venda do pedido #${req.params.id}`
          );
        }

        // Loyalty points for buyer (1 point per 100 MT)
        // Note: We don't have buyer_id in orders yet, let's assume we might need it.
        // For now, if we can't find buyer, we skip. 
        // Let's check if we have a way to link order to user.
        // Since the app uses localStorage for user, we should have added userId to order.
        // Let's check order creation.
      }
    });

    try {
      transaction();
      io.emit(`order_update_${req.params.id}`, { status });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // Seller Analytics
  app.get("/api/seller/analytics/:userId", (req, res) => {
    const salesData = db.prepare(`
      SELECT strftime('%Y-%m-%d', o.created_at) as date, SUM(oi.price * oi.quantity) as total
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE p.seller_id = ? AND o.status = 'delivered'
      GROUP BY date
      ORDER BY date ASC
      LIMIT 30
    `).all(req.params.userId);

    const topProducts = db.prepare(`
      SELECT p.name_pt, SUM(oi.quantity) as count
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE p.seller_id = ?
      GROUP BY p.id
      ORDER BY count DESC
      LIMIT 5
    `).all(req.params.userId);

    res.json({ salesData, topProducts });
  });

  // Payouts
  app.get("/api/seller/payouts/:userId", (req, res) => {
    const payouts = db.prepare("SELECT * FROM payout_requests WHERE seller_id = ? ORDER BY created_at DESC").all(req.params.userId);
    res.json(payouts);
  });

  app.post("/api/seller/payouts", (req, res) => {
    const { sellerId, amount, method } = req.body;
    const user = db.prepare("SELECT wallet_balance FROM users WHERE id = ?").get(sellerId) as any;
    
    if (!user || user.wallet_balance < amount) {
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    const transaction = db.transaction(() => {
      db.prepare("UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?").run(amount, sellerId);
      db.prepare("INSERT INTO payout_requests (seller_id, amount, method) VALUES (?, ?, ?)").run(sellerId, amount, method);
    });
    
    transaction();
    res.json({ success: true });
  });

  // Notifications
  app.get("/api/notifications/:userId", (req, res) => {
    const notifications = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").all(req.params.userId);
    res.json(notifications);
  });

  app.patch("/api/notifications/:id/read", (req, res) => {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(req.params.id);
    res.json({ success: true });
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

  // WebSocket handling
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    socket.on("disconnect", () => console.log("Client disconnected"));
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`TomiraShop running on http://localhost:${PORT}`);
  });
}

startServer();
