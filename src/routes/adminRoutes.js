const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadProduct, uploadAvatar } = require('../middleware/upload');
const { hashPassword, comparePassword } = require('../utils/auth');
const { notify, log } = require('../utils/notify');
const { saveProductVariants, syncProductVariantsOnEdit } = require('../utils/productVariants');

router.use(requireAuth, requireRole('admin'));

function slugify(str) {
  return str.toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}
function slugifyProduct(str) {
  return slugify(str) + '-' + Math.random().toString(36).slice(2, 7);
}

// DASHBOARD
router.get('/profile', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.render('admin/profile', { title: 'My Profile', user });
});

router.post('/profile', uploadAvatar.single('avatar'), (req, res) => {
  const { name, email, phone, address, city } = req.body;
  if (email && email !== req.user.email) {
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
    if (taken) {
      req.flash('error', 'That email is already used by another account.');
      return res.redirect('/admin/profile');
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
  res.redirect('/admin/profile');
});

router.post('/profile/password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!comparePassword(current_password || '', user.password_hash)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/admin/profile');
  }
  if (!new_password || new_password.length < 6) {
    req.flash('error', 'New password must be at least 6 characters.');
    return res.redirect('/admin/profile');
  }
  if (new_password !== confirm_password) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect('/admin/profile');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.id);
  req.flash('success', 'Password changed successfully.');
  res.redirect('/admin/profile');
});

router.get('/notifications', (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.render('admin/notifications', { title: 'Notifications', notifications });
});

router.get('/dashboard', (req, res) => {
  const stats = {
    totalUsers: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer'").get().c,
    totalVendors: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'vendor' AND status = 'active'").get().c,
    pendingVendors: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'vendor' AND status = 'pending'").get().c,
    totalProducts: db.prepare("SELECT COUNT(*) c FROM products WHERE status = 'approved'").get().c,
    pendingProducts: db.prepare("SELECT COUNT(*) c FROM products WHERE status = 'pending'").get().c,
    totalOrders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    totalRevenue: db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE payment_status = 'paid'").get().t,
  };
  const recentOrders = db.prepare(
    `SELECT o.*, u.name AS customer_name FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 8`
  ).all();
  const salesByDay = db.prepare(
    `SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS total FROM orders
     WHERE created_at >= date('now','-14 day') GROUP BY date(created_at) ORDER BY day ASC`
  ).all();
  const topProducts = db.prepare(
    `SELECT p.name, SUM(oi.quantity) AS sold FROM order_items oi JOIN products p ON p.id = oi.product_id
     GROUP BY p.id ORDER BY sold DESC LIMIT 5`
  ).all();

  res.render('admin/dashboard', { title: 'Admin Dashboard', stats, recentOrders, salesByDay, topProducts });
});

// USERS
router.get('/users', (req, res) => {
  const role = req.query.role || 'customer';
  const users = db.prepare('SELECT * FROM users WHERE role = ? ORDER BY created_at DESC').all(role);
  res.render('admin/users', { title: 'User Management', users, role });
});

router.post('/users/:id/toggle-status', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ ok: false });
  const newStatus = user.status === 'blocked' ? 'active' : 'blocked';
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, user.id);
  notify(user.id, newStatus === 'blocked' ? 'Account Blocked' : 'Account Reactivated',
    newStatus === 'blocked' ? 'Your account has been blocked by admin.' : 'Your account has been reactivated.', 'system');
  log(req.user.id, 'USER_STATUS_TOGGLE', `${user.email} -> ${newStatus}`, req.ip);
  res.json({ ok: true, status: newStatus });
});

router.post('/users/:id/delete', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  req.flash('success', 'User deleted.');
  res.redirect('back');
});

// VENDOR APPROVAL
router.get('/vendors', (req, res) => {
  const pending = db.prepare("SELECT * FROM users WHERE role = 'vendor' AND status = 'pending' ORDER BY created_at DESC").all();
  const active = db.prepare("SELECT * FROM users WHERE role = 'vendor' AND status = 'active' ORDER BY created_at DESC").all();
  const blocked = db.prepare("SELECT * FROM users WHERE role = 'vendor' AND status = 'blocked' ORDER BY created_at DESC").all();
  res.render('admin/vendors', { title: 'Vendor Management', pending, active, blocked });
});

router.post('/vendors/:id/approve', (req, res) => {
  const vendor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!vendor) return res.status(404).send('Not found');
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(vendor.id);
  notify(vendor.id, 'Vendor Account Approved! 🎉', 'Congratulations! You can now add and sell products on Podify.', 'system', '/vendor/dashboard');
  log(req.user.id, 'VENDOR_APPROVED', vendor.email, req.ip);
  req.flash('success', `Vendor "${vendor.name}" approved.`);
  res.redirect('/admin/vendors');
});

router.post('/vendors/:id/reject', (req, res) => {
  const vendor = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!vendor) return res.status(404).send('Not found');
  db.prepare("UPDATE users SET status = 'blocked' WHERE id = ?").run(vendor.id);
  notify(vendor.id, 'Vendor Application Rejected', 'Unfortunately your vendor application was not approved. Contact support for details.', 'system');
  req.flash('success', `Vendor "${vendor.name}" rejected.`);
  res.redirect('/admin/vendors');
});

// CATEGORIES
router.get('/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/categories', { title: 'Category Management', categories });
});

router.post('/categories/new', (req, res) => {
  const { name, description, icon } = req.body;
  db.prepare('INSERT INTO categories (name, slug, description, icon) VALUES (?, ?, ?, ?)').run(name, slugify(name), description || '', icon || 'bi-box');
  req.flash('success', 'Category added.');
  res.redirect('/admin/categories');
});

router.post('/categories/:id/edit', (req, res) => {
  const { name, description, icon, status } = req.body;
  db.prepare('UPDATE categories SET name=?, slug=?, description=?, icon=?, status=? WHERE id=?')
    .run(name, slugify(name), description || '', icon || 'bi-box', status || 'active', req.params.id);
  req.flash('success', 'Category updated.');
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  req.flash('success', 'Category deleted.');
  res.redirect('/admin/categories');
});

// MATERIALS (pricing engine)
router.get('/materials', (req, res) => {
  const materials = db.prepare('SELECT * FROM materials ORDER BY (parent_id IS NOT NULL), name').all();
  const groups = materials.filter(m => !m.parent_id);
  // A "true group" is a parent-less row that actually has children (Step 1 category).
  // A parent-less row with NO children is a standalone, directly-priced material (e.g. Ceramic).
  const groupIdsWithChildren = new Set(materials.filter(m => m.parent_id).map(m => m.parent_id));
  materials.forEach(m => { m.isGroup = !m.parent_id && groupIdsWithChildren.has(m.id); });
  res.render('admin/materials', { title: 'Material Management', materials, groups });
});

router.post('/materials/new', (req, res) => {
  const { name, parent_id, price_per_unit, description } = req.body;
  db.prepare('INSERT INTO materials (name, parent_id, price_per_unit, description) VALUES (?, ?, ?, ?)')
    .run(name, parent_id ? Number(parent_id) : null, Number(price_per_unit) || 0, description || '');
  req.flash('success', 'Material added.');
  res.redirect('/admin/materials');
});

router.post('/materials/:id/edit', (req, res) => {
  const { name, parent_id, price_per_unit, description, status } = req.body;
  if (parent_id && Number(parent_id) === Number(req.params.id)) {
    req.flash('error', 'A material cannot be its own group.');
    return res.redirect('/admin/materials');
  }
  db.prepare('UPDATE materials SET name=?, parent_id=?, price_per_unit=?, description=?, status=? WHERE id=?')
    .run(name, parent_id ? Number(parent_id) : null, Number(price_per_unit) || 0, description || '', status || 'active', req.params.id);
  req.flash('success', 'Material updated.');
  res.redirect('/admin/materials');
});

router.post('/materials/:id/delete', (req, res) => {
  db.prepare('DELETE FROM materials WHERE id = ?').run(req.params.id);
  req.flash('success', 'Material deleted.');
  res.redirect('/admin/materials');
});

// PRINT SIZES (pricing engine)
router.get('/sizes', (req, res) => {
  const sizes = db.prepare('SELECT * FROM print_sizes ORDER BY price_per_sq_inch').all();
  res.render('admin/sizes', { title: 'Print Size Management', sizes });
});

router.post('/sizes/new', (req, res) => {
  const { label, width_in, height_in, price_per_sq_inch } = req.body;
  db.prepare('INSERT INTO print_sizes (label, width_in, height_in, price_per_sq_inch) VALUES (?, ?, ?, ?)')
    .run(label, Number(width_in), Number(height_in), Number(price_per_sq_inch));
  req.flash('success', 'Print size added.');
  res.redirect('/admin/sizes');
});

router.post('/sizes/:id/edit', (req, res) => {
  const { label, width_in, height_in, price_per_sq_inch, status } = req.body;
  db.prepare('UPDATE print_sizes SET label=?, width_in=?, height_in=?, price_per_sq_inch=?, status=? WHERE id=?')
    .run(label, Number(width_in), Number(height_in), Number(price_per_sq_inch), status || 'active', req.params.id);
  req.flash('success', 'Print size updated.');
  res.redirect('/admin/sizes');
});

router.post('/sizes/:id/delete', (req, res) => {
  db.prepare('DELETE FROM print_sizes WHERE id = ?').run(req.params.id);
  req.flash('success', 'Print size deleted.');
  res.redirect('/admin/sizes');
});

// FONTS
router.get('/fonts', (req, res) => {
  const fonts = db.prepare('SELECT * FROM fonts ORDER BY is_calligraphy, name').all();
  res.render('admin/fonts', { title: 'Font Management', fonts });
});

router.post('/fonts/new', (req, res) => {
  const { name, css_family, is_calligraphy } = req.body;
  db.prepare('INSERT INTO fonts (name, css_family, is_calligraphy) VALUES (?, ?, ?)').run(name, css_family, is_calligraphy ? 1 : 0);
  req.flash('success', 'Font added.');
  res.redirect('/admin/fonts');
});

router.post('/fonts/:id/delete', (req, res) => {
  db.prepare('DELETE FROM fonts WHERE id = ?').run(req.params.id);
  req.flash('success', 'Font deleted.');
  res.redirect('/admin/fonts');
});

// PRODUCTS (approval)
router.get('/products', (req, res) => {
  const statusFilter = req.query.status || 'pending';
  const products = db.prepare(
    `SELECT p.*, u.name AS vendor_name, c.name AS category_name FROM products p
     JOIN users u ON u.id = p.vendor_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.status = ? ORDER BY p.created_at DESC`
  ).all(statusFilter);
  res.render('admin/products', { title: 'Product Approval', products, statusFilter });
});

router.post('/products/:id/approve', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).send('Not found');
  db.prepare("UPDATE products SET status = 'approved', rejection_reason = NULL WHERE id = ?").run(product.id);
  notify(product.vendor_id, 'Product Approved! ✅', `Your product "${product.name}" is now live on Podify.`, 'system', '/vendor/products');
  req.flash('success', 'Product approved.');
  res.redirect('/admin/products');
});

router.post('/products/:id/reject', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).send('Not found');
  const reason = req.body.reason || 'Did not meet quality guidelines';
  db.prepare("UPDATE products SET status = 'rejected', rejection_reason = ? WHERE id = ?").run(reason, product.id);
  notify(product.vendor_id, 'Product Rejected', `Your product "${product.name}" was rejected: ${reason}`, 'system', '/vendor/products');
  req.flash('success', 'Product rejected.');
  res.redirect('/admin/products');
});

router.post('/products/:id/delete', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  req.flash('success', 'Product deleted.');
  res.redirect('back');
});

// PRODUCTS: DIRECT ADD/EDIT (Admin authority)
// admin can create/edit a product directly, no approval step needed since admin is the approver
router.get('/products/new', (req, res) => {
  const categories = db.prepare("SELECT * FROM categories WHERE status = 'active' ORDER BY name").all();
  const materials = db.prepare("SELECT * FROM materials WHERE status = 'active' ORDER BY name").all();
  res.render('admin/product-form', { title: 'Add New Product', categories, materials, product: null, selectedMaterials: [], existingVariants: [] });
});

router.post('/products/new', uploadProduct.fields([{ name: 'front_image', maxCount: 1 }, { name: 'back_image', maxCount: 1 }, { name: 'variant1_front', maxCount: 1 }, { name: 'variant1_back', maxCount: 1 }, { name: 'variant2_front', maxCount: 1 }, { name: 'variant2_back', maxCount: 1 }, { name: 'variant3_front', maxCount: 1 }, { name: 'variant3_back', maxCount: 1 }]), (req, res) => {
  const { name, category_id, description, base_price, supports_back_print, supports_text, supports_image, stock, materials } = req.body;

  if (!req.files || !req.files.front_image) {
    req.flash('error', 'Front image is required.');
    return res.redirect('/admin/products/new');
  }

  const front_image = `/uploads/products/${req.files.front_image[0].filename}`;
  const back_image = req.files.back_image ? `/uploads/products/${req.files.back_image[0].filename}` : null;
  const slug = slugifyProduct(name);

  const info = db.prepare(
    `INSERT INTO products (vendor_id, category_id, name, slug, description, base_price, front_image, back_image,
      supports_back_print, supports_text, supports_image, status, stock)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`
  ).run(
    req.user.id, category_id || null, name, slug, description || '', Number(base_price) || 0, front_image, back_image,
    supports_back_print ? 1 : 0, supports_text ? 1 : 0, supports_image ? 1 : 0, Number(stock) || 100
  );

  const productId = info.lastInsertRowid;
  const materialIds = Array.isArray(materials) ? materials : (materials ? [materials] : []);
  const insertMat = db.prepare('INSERT INTO product_materials (product_id, material_id) VALUES (?, ?)');
  materialIds.forEach(mid => insertMat.run(productId, Number(mid)));
  saveProductVariants(db, productId, req.body, req.files, front_image, back_image);

  log(req.user.id, 'ADMIN_PRODUCT_ADDED', name, req.ip);
  req.flash('success', 'Product created and published immediately.');
  res.redirect('/admin/products?status=approved');
});

router.get('/products/:id/edit', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).render('errors/404', { title: 'Product Not Found' });
  const categories = db.prepare("SELECT * FROM categories WHERE status = 'active' ORDER BY name").all();
  const materials = db.prepare("SELECT * FROM materials WHERE status = 'active' ORDER BY name").all();
  const selectedMaterials = db.prepare('SELECT material_id FROM product_materials WHERE product_id = ?').all(product.id).map(r => r.material_id);
  const existingVariants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order').all(product.id);
  res.render('admin/product-form', { title: 'Edit Product', categories, materials, product, selectedMaterials, existingVariants });
});

router.post('/products/:id/edit', uploadProduct.fields([{ name: 'front_image', maxCount: 1 }, { name: 'back_image', maxCount: 1 }, { name: 'variant1_front', maxCount: 1 }, { name: 'variant1_back', maxCount: 1 }, { name: 'variant2_front', maxCount: 1 }, { name: 'variant2_back', maxCount: 1 }, { name: 'variant3_front', maxCount: 1 }, { name: 'variant3_back', maxCount: 1 }]), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).render('errors/404', { title: 'Product Not Found' });

  const { name, category_id, description, base_price, supports_back_print, supports_text, supports_image, stock, materials } = req.body;
  const front_image = req.files && req.files.front_image ? `/uploads/products/${req.files.front_image[0].filename}` : product.front_image;
  const back_image = req.files && req.files.back_image ? `/uploads/products/${req.files.back_image[0].filename}` : product.back_image;

  // Admin edits are trusted immediately — no re-approval cycle needed (Admin IS the approver).
  db.prepare(
    `UPDATE products SET name=?, category_id=?, description=?, base_price=?, front_image=?, back_image=?,
     supports_back_print=?, supports_text=?, supports_image=?, stock=?, status='approved', rejection_reason=NULL
     WHERE id = ?`
  ).run(name, category_id || null, description || '', Number(base_price) || 0, front_image, back_image,
    supports_back_print ? 1 : 0, supports_text ? 1 : 0, supports_image ? 1 : 0, Number(stock) || 100, product.id);

  db.prepare('DELETE FROM product_materials WHERE product_id = ?').run(product.id);
  const materialIds = Array.isArray(materials) ? materials : (materials ? [materials] : []);
  const insertMat = db.prepare('INSERT INTO product_materials (product_id, material_id) VALUES (?, ?)');
  materialIds.forEach(mid => insertMat.run(product.id, Number(mid)));
  syncProductVariantsOnEdit(db, product.id, req.body, req.files, front_image, back_image);

  log(req.user.id, 'ADMIN_PRODUCT_EDITED', name, req.ip);
  if (product.vendor_id !== req.user.id) {
    notify(product.vendor_id, 'Product Updated By Admin', `An admin made changes to your product "${name}".`, 'system', '/vendor/products');
  }
  req.flash('success', 'Product updated and published.');
  res.redirect('/admin/products?status=approved');
});

// ORDERS
router.get('/orders', (req, res) => {
  const orders = db.prepare(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC`
  ).all();
  res.render('admin/orders', { title: 'Order Management', orders });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT o.*, u.name AS customer_name, u.email AS customer_email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?').get(req.params.id);
  if (!order) return res.status(404).render('errors/404', { title: 'Order Not Found' });
  const items = db.prepare(
    `SELECT oi.*, p.name AS product_name, u.name AS vendor_name, m.name AS material_name, ps.label AS size_label, pv.color_name, pv.color_hex
     FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN users u ON u.id = oi.vendor_id
     LEFT JOIN materials m ON m.id = oi.material_id LEFT JOIN print_sizes ps ON ps.id = oi.print_size_id
     LEFT JOIN product_variants pv ON pv.id = oi.variant_id
     WHERE oi.order_id = ?`
  ).all(order.id);
  const history = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC').all(order.id);
  res.render('admin/order-detail', { title: `Order ${order.order_number}`, order, items, history });
});

router.post('/orders/:id/payment-status', (req, res) => {
  const { payment_status } = req.body;
  db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(payment_status, req.params.id);
  req.flash('success', 'Payment status updated.');
  res.redirect(`/admin/orders/${req.params.id}`);
});

// lets admin override any order item's status directly, on top of the vendor's own updates
router.post('/order-items/:itemId/status', (req, res) => {
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.itemId);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
  const { status } = req.body;
  const allowed = ['placed', 'confirmed', 'in_production', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });

  db.prepare('UPDATE order_items SET item_status = ? WHERE id = ?').run(status, item.id);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(item.order_id);
  const allItems = db.prepare('SELECT item_status FROM order_items WHERE order_id = ?').all(item.order_id);
  if (allItems.every(i => i.item_status === status)) {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
  }
  db.prepare('INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)').run(order.id, status, 'Item status updated by admin');

  const statusLabels = { placed: 'Placed', confirmed: 'Confirmed ✅', in_production: 'In Production 🖨️', shipped: 'Shipped 🚚', delivered: 'Delivered 📦', cancelled: 'Cancelled ❌' };
  notify(order.user_id, `Order Update: ${statusLabels[status] || status}`, `Your order ${order.order_number} status changed to "${status.replace('_', ' ')}".`, 'order', `/user/orders/${order.id}`);
  log(req.user.id, 'ADMIN_ORDER_STATUS_OVERRIDE', `order_item=${item.id} -> ${status}`, req.ip);

  res.json({ ok: true });
});

// REPORTS / ANALYTICS
router.get('/reports', (req, res) => {
  const revenueByMonth = db.prepare(
    `SELECT strftime('%Y-%m', created_at) AS month, COALESCE(SUM(total),0) AS total
     FROM orders WHERE payment_status = 'paid' GROUP BY month ORDER BY month DESC LIMIT 12`
  ).all();
  const topVendors = db.prepare(
    `SELECT u.name, COALESCE(SUM(oi.line_total),0) AS revenue, COUNT(oi.id) AS items_sold
     FROM order_items oi JOIN users u ON u.id = oi.vendor_id GROUP BY u.id ORDER BY revenue DESC LIMIT 10`
  ).all();
  const topCategories = db.prepare(
    `SELECT c.name, COUNT(oi.id) AS items_sold FROM order_items oi
     JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
     GROUP BY c.id ORDER BY items_sold DESC LIMIT 10`
  ).all();
  const orderStatusBreakdown = db.prepare('SELECT status, COUNT(*) AS c FROM orders GROUP BY status').all();

  res.render('admin/reports', { title: 'Reports & Analytics', revenueByMonth, topVendors, topCategories, orderStatusBreakdown });
});

// LOGS
router.get('/logs', (req, res) => {
  const logs = db.prepare(
    `SELECT l.*, u.name AS user_name FROM logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 200`
  ).all();
  res.render('admin/logs', { title: 'System Logs', logs });
});

// SETTINGS
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.render('admin/settings', { title: 'System Settings', settings });
});

router.post('/settings', (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  Object.entries(req.body).forEach(([key, value]) => upsert.run(key, String(value)));
  req.flash('success', 'Settings saved.');
  res.redirect('/admin/settings');
});

router.get('/orders/design/:itemId/download', (req, res) => {
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.itemId);
  if (!item || !item.front_preview) return res.status(404).send('Design not found');
  const path = require('path');
  const filePath = path.join(__dirname, '..', '..', 'public', item.front_preview);
  res.download(filePath);
});

module.exports = router;
