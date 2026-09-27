const express = require('express');
const router = express.Router();
const { nanoid } = require('nanoid');
const db = require('../models/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');
const { hashPassword, comparePassword } = require('../utils/auth');
const { notify, log } = require('../utils/notify');

router.use(requireAuth, requireRole('customer'));

// DASHBOARD
router.get('/dashboard', (req, res) => {
  const orderCount = db.prepare('SELECT COUNT(*) c FROM orders WHERE user_id = ?').get(req.user.id).c;
  const favCount = db.prepare('SELECT COUNT(*) c FROM favorites WHERE user_id = ?').get(req.user.id).c;
  const recentOrders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(req.user.id);
  const spent = db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE user_id = ? AND payment_status = 'paid'").get(req.user.id).t;
  res.render('user/dashboard', { title: 'My Dashboard', orderCount, favCount, recentOrders, spent });
});

// PROFILE
router.get('/profile', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.render('user/profile', { title: 'My Profile', user });
});

router.post('/profile', uploadAvatar.single('avatar'), (req, res) => {
  const { name, email, phone, address, city } = req.body;

  if (email && email !== req.user.email) {
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
    if (taken) {
      req.flash('error', 'That email is already used by another account.');
      return res.redirect('/user/profile');
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
  res.redirect('/user/profile');
});

router.post('/profile/password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!comparePassword(current_password || '', user.password_hash)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/user/profile');
  }
  if (!new_password || new_password.length < 6) {
    req.flash('error', 'New password must be at least 6 characters.');
    return res.redirect('/user/profile');
  }
  if (new_password !== confirm_password) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect('/user/profile');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.id);
  req.flash('success', 'Password changed successfully.');
  res.redirect('/user/profile');
});

// CART PAGE
router.get('/cart', (req, res) => {
  const items = db.prepare(
    `SELECT ci.*, p.name AS product_name, p.slug, p.front_image, m.name AS material_name, ps.label AS size_label, pv.color_name, pv.color_hex
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN materials m ON m.id = ci.material_id
     LEFT JOIN print_sizes ps ON ps.id = ci.print_size_id
     LEFT JOIN product_variants pv ON pv.id = ci.variant_id
     WHERE ci.user_id = ? ORDER BY ci.created_at DESC`
  ).all(req.user.id);
  const subtotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  res.render('user/cart', { title: 'My Cart', items, subtotal: Math.round(subtotal * 100) / 100 });
});

// CHECKOUT
router.get('/checkout', (req, res) => {
  const items = db.prepare(
    `SELECT ci.*, p.name AS product_name, p.vendor_id, p.front_image
     FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = ?`
  ).all(req.user.id);
  if (items.length === 0) {
    req.flash('error', 'Your cart is empty.');
    return res.redirect('/user/cart');
  }
  const subtotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const shipping_fee = subtotal > 3000 ? 0 : 150;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.render('user/checkout', {
    title: 'Checkout', items, user,
    subtotal: Math.round(subtotal * 100) / 100,
    shipping_fee,
    total: Math.round((subtotal + shipping_fee) * 100) / 100
  });
});

router.post('/checkout', (req, res) => {
  const items = db.prepare(
    `SELECT ci.*, p.vendor_id FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = ?`
  ).all(req.user.id);

  if (items.length === 0) {
    req.flash('error', 'Your cart is empty.');
    return res.redirect('/user/cart');
  }

  const { shipping_name, shipping_phone, shipping_address, shipping_city, payment_method, notes } = req.body;
  if (!shipping_name || !shipping_phone || !shipping_address || !shipping_city) {
    req.flash('error', 'Please fill in all shipping details.');
    return res.redirect('/user/checkout');
  }

  const subtotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const shipping_fee = subtotal > 3000 ? 0 : 150;
  const total = Math.round((subtotal + shipping_fee) * 100) / 100;
  const order_number = 'PDF-' + Date.now().toString(36).toUpperCase() + '-' + nanoid(4).toUpperCase();

  const txn = db.transaction(() => {
    const orderInfo = db.prepare(
      `INSERT INTO orders (order_number, user_id, subtotal, shipping_fee, discount, total, payment_method, payment_status, status,
        shipping_name, shipping_phone, shipping_address, shipping_city, notes)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'placed', ?, ?, ?, ?, ?)`
    ).run(
      order_number, req.user.id, Math.round(subtotal * 100) / 100, shipping_fee, total,
      payment_method || 'cod', payment_method === 'cod' ? 'pending' : 'paid',
      shipping_name, shipping_phone, shipping_address, shipping_city, notes || null
    );
    const orderId = orderInfo.lastInsertRowid;

    for (const item of items) {
      const lineTotal = Math.round(item.unit_price * item.quantity * 100) / 100;
      db.prepare(
        `INSERT INTO order_items (order_id, product_id, vendor_id, material_id, print_size_id, variant_id, quantity, customization_json, front_preview, back_preview, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(orderId, item.product_id, item.vendor_id, item.material_id, item.print_size_id, item.variant_id, item.quantity,
        item.customization_json, item.front_preview, item.back_preview, item.unit_price, lineTotal);

      notify(item.vendor_id, 'New Order Received', `You have a new order (${order_number}) for your product.`, 'order', '/vendor/orders');
    }

    db.prepare('INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)').run(orderId, 'placed', 'Order placed by customer');
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);

    return orderId;
  });

  const orderId = txn();
  log(req.user.id, 'ORDER_PLACED', order_number, req.ip);
  notify(req.user.id, 'Order Confirmed! 🎉', `Your order ${order_number} has been placed successfully.`, 'order', `/user/orders/${orderId}`);

  req.flash('success', `Order placed successfully! Order #${order_number}`);
  res.redirect(`/user/orders/${orderId}`);
});

// ORDERS
router.get('/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.render('user/orders', { title: 'My Orders', orders });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).render('errors/404', { title: 'Order Not Found' });

  const items = db.prepare(
    `SELECT oi.*, p.name AS product_name, p.slug, p.front_image, m.name AS material_name, ps.label AS size_label, pv.color_name, pv.color_hex
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN materials m ON m.id = oi.material_id
     LEFT JOIN print_sizes ps ON ps.id = oi.print_size_id
     LEFT JOIN product_variants pv ON pv.id = oi.variant_id
     WHERE oi.order_id = ?`
  ).all(order.id);

  const history = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC').all(order.id);
  const myReviews = db.prepare('SELECT order_item_id FROM reviews WHERE user_id = ? AND order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)').all(req.user.id, order.id);
  const reviewedIds = new Set(myReviews.map(r => r.order_item_id));

  res.render('user/order-detail', { title: `Order ${order.order_number}`, order, items, history, reviewedIds });
});

router.get('/orders/:id/design/:itemId/download', (req, res) => {
  const item = db.prepare(
    `SELECT oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? AND o.id = ? AND o.user_id = ?`
  ).get(req.params.itemId, req.params.id, req.user.id);
  if (!item || !item.front_preview) return res.status(404).send('Design not found');
  const path = require('path');
  const filePath = path.join(__dirname, '..', '..', 'public', item.front_preview);
  res.download(filePath);
});

// FAVORITES PAGE
router.get('/favorites', (req, res) => {
  const favorites = db.prepare(
    `SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id WHERE f.user_id = ? ORDER BY f.created_at DESC`
  ).all(req.user.id);
  res.render('user/favorites', { title: 'My Favorites', favorites });
});

// NOTIFICATIONS PAGE
router.get('/notifications', (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.render('user/notifications', { title: 'Notifications', notifications });
});

module.exports = router;
