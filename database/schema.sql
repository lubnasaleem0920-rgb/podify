-- Podify Database Schema (SQLite)
-- Auto-generated from live schema

CREATE TRIGGER trg_users_updated AFTER UPDATE ON users
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER trg_products_updated AFTER UPDATE ON products
BEGIN
  UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER trg_orders_updated AFTER UPDATE ON orders
BEGIN
  UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER trg_review_insert AFTER INSERT ON reviews
BEGIN
  UPDATE products SET
    rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = NEW.product_id),
    rating_avg = (SELECT ROUND(AVG(rating),2) FROM reviews WHERE product_id = NEW.product_id)
  WHERE id = NEW.product_id;
END;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('customer','vendor','admin')) DEFAULT 'customer',
  avatar TEXT DEFAULT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','blocked','pending')) DEFAULT 'active',
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  reset_token TEXT,
  reset_token_expires DATETIME,
  address TEXT,
  city TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sqlite_sequence(name,seq);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','inactive')) DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,          -- e.g. Plastic, Aluminium, Metal, Woolen Cover, Rexine/Leather, Cotton Cloth, Ceramic, Ceramic-Coated
  parent_id INTEGER REFERENCES materials(id) ON DELETE CASCADE, -- NULL = top-level group (e.g. "Bare / Painted Surface"); set = a selectable leaf material under that group
  price_per_unit REAL NOT NULL DEFAULT 0, -- Rs per sq.inch (or per unit area) surcharge for this material. Only meaningful on leaf materials.
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','inactive')) DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE print_sizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,          -- e.g. Small (2x2 in), Medium (4x4 in), Large (6x6 in), Full Wrap
  width_in REAL NOT NULL,
  height_in REAL NOT NULL,
  price_per_sq_inch REAL NOT NULL DEFAULT 5,
  status TEXT NOT NULL CHECK(status IN ('active','inactive')) DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fonts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  css_family TEXT NOT NULL,
  is_calligraphy INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('active','inactive')) DEFAULT 'active'
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  base_price REAL NOT NULL DEFAULT 0,
  front_image TEXT NOT NULL,
  back_image TEXT,
  mockup_frame TEXT,                    -- overlay/frame image over printable area (optional)
  printable_area_json TEXT,             -- {front:{x,y,w,h}, back:{x,y,w,h}} percentages for canvas mapping
  supports_back_print INTEGER NOT NULL DEFAULT 1,
  supports_text INTEGER NOT NULL DEFAULT 1,
  supports_image INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','inactive')) DEFAULT 'pending',
  rejection_reason TEXT,
  stock INTEGER NOT NULL DEFAULT 100,
  rating_avg REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  UNIQUE(product_id, material_id)
);

CREATE TABLE product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color_name TEXT NOT NULL,
  color_hex TEXT NOT NULL DEFAULT '#CCCCCC',
  front_image TEXT NOT NULL,
  back_image TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES materials(id),
  print_size_id INTEGER REFERENCES print_sizes(id),
  variant_id INTEGER REFERENCES product_variants(id), -- which product COLOR was chosen (separate from print color)
  quantity INTEGER NOT NULL DEFAULT 1,
  customization_json TEXT,      -- full customization state (text, fonts, colors, image positions for front/back)
  front_preview TEXT,           -- rendered preview image (data saved to uploads)
  back_preview TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subtotal REAL NOT NULL DEFAULT 0,
  shipping_fee REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cod' CHECK(payment_method IN ('cod','card','wallet')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','refunded')),
  status TEXT NOT NULL DEFAULT 'placed' CHECK(status IN ('placed','confirmed','in_production','shipped','delivered','cancelled')),
  shipping_name TEXT,
  shipping_phone TEXT,
  shipping_address TEXT,
  shipping_city TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  vendor_id INTEGER NOT NULL REFERENCES users(id),
  material_id INTEGER REFERENCES materials(id),
  print_size_id INTEGER REFERENCES print_sizes(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  customization_json TEXT,
  front_preview TEXT,
  back_preview TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  item_status TEXT NOT NULL DEFAULT 'placed' CHECK(item_status IN ('placed','confirmed','in_production','shipped','delivered','cancelled')),
  design_downloaded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_item_id INTEGER REFERENCES order_items(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, user_id, order_item_id)
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK(type IN ('info','order','system','promo')),
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, product_id)
);

CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_products_vendor ON products(vendor_id);

CREATE INDEX idx_products_category ON products(category_id);

CREATE INDEX idx_products_status ON products(status);

CREATE INDEX idx_orders_user ON orders(user_id);

CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE INDEX idx_order_items_vendor ON order_items(vendor_id);

CREATE INDEX idx_cart_user ON cart_items(user_id);

CREATE INDEX idx_notifications_user ON notifications(user_id);

CREATE INDEX idx_reviews_product ON reviews(product_id);

CREATE INDEX idx_variants_product ON product_variants(product_id);

