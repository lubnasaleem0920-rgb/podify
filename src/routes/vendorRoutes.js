const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadProduct, uploadAvatar } = require('../middleware/upload');
const { hashPassword, comparePassword } = require('../utils/auth');
const { notify, log } = require('../utils/notify');

router.use(requireAuth, requireRole('vendor'));

const { saveProductVariants, syncProductVariantsOnEdit } = require('../utils/productVariants');

function slugify(str) {
  return str.toString().toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') + '-' + Math.random().toString(36).slice(2, 7);
}

// DASHBOARD
router.get('/profile', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.render('vendor/profile', { title: 'My Profile', user });
});

router.post('/profile', uploadAvatar.single('avatar'), (req, res) => {
  const { name, email, phone, address, city } = req.body;
  if (email && email !== req.user.email) {
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
    if (taken) {
      req.flash('error', 'That email is already used by another account.');
      return res.redirect('/vendor/profile');
    }
  }
  let avatarClause = '';
  const params = [name, email || req.user.email, phone || null, address || null, city || null];
  if (req.file) {
    avatarClause = ', avatar = ?';
    params.push(`/uploads/avatars/${req.file.filename}`);
  }
  params.push(req.user.id);
  db.prepare(`UPDATE users SET name = ?, email = ?, phone = ?, address = ?, city = ?${avatarClause} WHERE id = ?`).run(...params);
  req.flash('success', 'Profile updated successfully.');
  res.redirect('/vendor/profile');
});

router.post('/profile/password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!comparePassword(current_password || '', user.password_hash)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/vendor/profile');
  }
  if (!new_password || new_password.length < 6) {
    req.flash('error', 'New password must be at least 6 characters.');
    return res.redirect('/vendor/profile');
  }
  if (new_password !== confirm_password) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect('/vendor/profile');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.id);
  req.flash('success', 'Password changed successfully.');
  res.redirect('/vendor/profile');
});

router.get('/notifications', (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.render('vendor/notifications', { title: 'Notifications', notifications });
});

router.get('/dashboard', (req, res) => {
  const productCount = db.prepare('SELECT COUNT(*) c FROM products WHERE vendor_id = ?').get(req.user.id).c;
  const pendingCount = db.prepare("SELECT COUNT(*) c FROM products WHERE vendor_id = ? AND status = 'pending'").get(req.user.id).c;
  const orderItemCount = db.prepare('SELECT COUNT(*) c FROM order_items WHERE vendor_id = ?').get(req.user.id).c;
  const revenue = db.prepare(
    `SELECT COALESCE(SUM(oi.line_total),0) t FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.vendor_id = ? AND o.payment_status = 'paid'`
  ).get(req.user.id).t;
  const recentOrders = db.prepare(
    `SELECT oi.*, o.order_number, o.created_at AS order_date, p.name AS product_name FROM order_items oi
     JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
     WHERE oi.vendor_id = ? ORDER BY o.created_at DESC LIMIT 5`
  ).all(req.user.id);
  const topProducts = db.prepare('SELECT * FROM products WHERE vendor_id = ? ORDER BY rating_avg DESC LIMIT 5').all(req.user.id);

  res.render('vendor/dashboard', { title: 'Vendor Dashboard', productCount, pendingCount, orderItemCount, revenue, recentOrders, topProducts });
});

// PRODUCTS
router.get('/products', (req, res) => {
  const products = db.prepare(
    `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.vendor_id = ? ORDER BY p.created_at DESC`
  ).all(req.user.id);
  res.render('vendor/products', { title: 'My Products', products });
});

router.get('/products/new', (req, res) => {
  const categories = db.prepare("SELECT * FROM categories WHERE status = 'active' ORDER BY name").all();
  const materials = db.prepare("SELECT * FROM materials WHERE status = 'active' ORDER BY name").all();
  res.render('vendor/product-form', { title: 'Add New Product', categories, materials, product: null, selectedMaterials: [], existingVariants: [] });
});

router.post('/products/new', uploadProduct.fields([{ name: 'front_image', maxCount: 1 }, { name: 'back_image', maxCount: 1 }, { name: 'variant1_front', maxCount: 1 }, { name: 'variant1_back', maxCount: 1 }, { name: 'variant2_front', maxCount: 1 }, { name: 'variant2_back', maxCount: 1 }, { name: 'variant3_front', maxCount: 1 }, { name: 'variant3_back', maxCount: 1 }]), (req, res) => {
  const { name, category_id, description, base_price, supports_back_print, supports_text, supports_image, stock, materials } = req.body;

  if (!req.files || !req.files.front_image) {
    req.flash('error', 'Front image is required.');
    return res.redirect('/vendor/products/new');
  }

  const front_image = `/uploads/products/${req.files.front_image[0].filename}`;
  const back_image = req.files.back_image ? `/uploads/products/${req.files.back_image[0].filename}` : null;
  const slug = slugify(name);

  const info = db.prepare(
    `INSERT INTO products (vendor_id, category_id, name, slug, description, base_price, front_image, back_image,
      supports_back_print, supports_text, supports_image, status, stock)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    req.user.id, category_id || null, name, slug, description || '', Number(base_price) || 0, front_image, back_image,
    supports_back_print ? 1 : 0, supports_text ? 1 : 0, supports_image ? 1 : 0, Number(stock) || 100
  );

  const productId = info.lastInsertRowid;
  const materialIds = Array.isArray(materials) ? materials : (materials ? [materials] : []);
  const insertMat = db.prepare('INSERT INTO product_materials (product_id, material_id) VALUES (?, ?)');
  materialIds.forEach(mid => insertMat.run(productId, Number(mid)));
  saveProductVariants(db, productId, req.body, req.files, front_image, back_image);

  log(req.user.id, 'PRODUCT_ADDED', name, req.ip);
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  admins.forEach(a => notify(a.id, 'New Product Pending Approval', `${req.user.name} added "${name}" — review it now.`, 'system', '/admin/products'));

  req.flash('success', 'Product submitted! It will be visible once approved by admin.');
  res.redirect('/vendor/products');
});

router.get('/products/:id/edit', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.id);
  if (!product) return res.status(404).render('errors/404', { title: 'Product Not Found' });
  const categories = db.prepare("SELECT * FROM categories WHERE status = 'active' ORDER BY name").all();
  const materials = db.prepare("SELECT * FROM materials WHERE status = 'active' ORDER BY name").all();
  const selectedMaterials = db.prepare('SELECT material_id FROM product_materials WHERE product_id = ?').all(product.id).map(r => r.material_id);
  const existingVariants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order').all(product.id);
  res.render('vendor/product-form', { title: 'Edit Product', categories, materials, product, selectedMaterials, existingVariants });
});

router.post('/products/:id/edit', uploadProduct.fields([{ name: 'front_image', maxCount: 1 }, { name: 'back_image', maxCount: 1 }, { name: 'variant1_front', maxCount: 1 }, { name: 'variant1_back', maxCount: 1 }, { name: 'variant2_front', maxCount: 1 }, { name: 'variant2_back', maxCount: 1 }, { name: 'variant3_front', maxCount: 1 }, { name: 'variant3_back', maxCount: 1 }]), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.id);
  if (!product) return res.status(404).render('errors/404', { title: 'Product Not Found' });

  const { name, category_id, description, base_price, supports_back_print, supports_text, supports_image, stock, materials } = req.body;
  const front_image = req.files && req.files.front_image ? `/uploads/products/${req.files.front_image[0].filename}` : product.front_image;
  const back_image = req.files && req.files.back_image ? `/uploads/products/${req.files.back_image[0].filename}` : product.back_image;

  db.prepare(
    `UPDATE products SET name=?, category_id=?, description=?, base_price=?, front_image=?, back_image=?,
     supports_back_print=?, supports_text=?, supports_image=?, stock=?, status='pending'
     WHERE id = ?`
  ).run(name, category_id || null, description || '', Number(base_price) || 0, front_image, back_image,
    supports_back_print ? 1 : 0, supports_text ? 1 : 0, supports_image ? 1 : 0, Number(stock) || 100, product.id);

  db.prepare('DELETE FROM product_materials WHERE product_id = ?').run(product.id);
  const materialIds = Array.isArray(materials) ? materials : (materials ? [materials] : []);
  const insertMat = db.prepare('INSERT INTO product_materials (product_id, material_id) VALUES (?, ?)');
  materialIds.forEach(mid => insertMat.run(product.id, Number(mid)));

  // Keep the primary color variant (sort_order 0) in sync with the main images/name,
  // and append any newly-filled additional color slots.
  syncProductVariantsOnEdit(db, product.id, req.body, req.files, front_image, back_image);

  req.flash('success', 'Product updated! It will need re-approval since edits were made.');
  res.redirect('/vendor/products');
});

router.post('/products/:id/delete', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.id);
  if (!product) return res.status(404).render('errors/404', { title: 'Product Not Found' });
  db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
  req.flash('success', 'Product deleted.');
  res.redirect('/vendor/products');
});

// ORDERS (for this vendor's products)
router.get('/orders', (req, res) => {
  const items = db.prepare(
    `SELECT oi.*, o.order_number, o.shipping_name, o.shipping_city, o.created_at AS order_date, p.name AS product_name, p.front_image, pv.color_name, pv.color_hex
     FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
     LEFT JOIN product_variants pv ON pv.id = oi.variant_id
     WHERE oi.vendor_id = ? ORDER BY o.created_at DESC`
  ).all(req.user.id);
  res.render('vendor/orders', { title: 'Orders', items });
});

router.post('/orders/:itemId/status', (req, res) => {
  const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND vendor_id = ?').get(req.params.itemId, req.user.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
  const { status } = req.body;
  const allowed = ['confirmed', 'in_production', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });

  db.prepare('UPDATE order_items SET item_status = ? WHERE id = ?').run(status, item.id);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(item.order_id);
  // If all items share the same status, bump the parent order status too
  const allItems = db.prepare('SELECT item_status FROM order_items WHERE order_id = ?').all(item.order_id);
  if (allItems.every(i => i.item_status === status)) {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
  }
  db.prepare('INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)').run(order.id, status, `Item status updated by vendor`);

  const statusLabels = { confirmed: 'Confirmed ✅', in_production: 'In Production 🖨️', shipped: 'Shipped 🚚', delivered: 'Delivered 📦', cancelled: 'Cancelled ❌' };
  notify(order.user_id, `Order Update: ${statusLabels[status] || status}`, `Your order ${order.order_number} status changed to "${status.replace('_', ' ')}".`, 'order', `/user/orders/${order.id}`);

  res.json({ ok: true });
});

// DESIGN FILE DOWNLOAD
router.get('/orders/design/:itemId/download', (req, res) => {
  const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND vendor_id = ?').get(req.params.itemId, req.user.id);
  if (!item || !item.front_preview) return res.status(404).send('Design not found');
  const path = require('path');
  db.prepare('UPDATE order_items SET design_downloaded = 1 WHERE id = ?').run(item.id);
  const filePath = path.join(__dirname, '..', '..', 'public', item.front_preview);
  res.download(filePath);
});

module.exports = router;
