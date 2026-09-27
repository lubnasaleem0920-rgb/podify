const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAuthApi } = require('../middleware/auth');
const { calculatePrice } = require('../utils/pricing');
const { uploadDesign } = require('../middleware/upload');
const { notify } = require('../utils/notify');
const sanitizeHtml = require('sanitize-html');

// PRICE CALCULATOR (live, no login required)
router.post('/price/calculate', (req, res) => {
  try {
    const { productId, materialId, printSizeId, hasBackPrint, quantity } = req.body;
    const breakdown = calculatePrice({
      productId: Number(productId),
      materialId: materialId ? Number(materialId) : null,
      printSizeId: printSizeId ? Number(printSizeId) : null,
      hasBackPrint: hasBackPrint === true || hasBackPrint === 'true',
      quantity: Number(quantity) || 1
    });
    res.json({ ok: true, breakdown });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// UPLOAD CUSTOM IMAGE FOR CUSTOMIZER
router.post('/upload/custom-image', requireAuthApi, uploadDesign.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
  res.json({ ok: true, url: `/uploads/designs/${req.file.filename}` });
});

// Save rendered canvas preview (base64 PNG) to disk -> used for cart/order preview + vendor design download
router.post('/upload/save-preview', requireAuthApi, (req, res) => {
  const { dataUrl, side } = req.body;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ ok: false, error: 'Invalid image data' });
  }
  const fs = require('fs');
  const path = require('path');
  const { nanoid } = require('nanoid');
  const matches = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!matches) return res.status(400).json({ ok: false, error: 'Unsupported image format' });
  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const filename = `preview_${side || 'front'}_${Date.now()}_${nanoid(6)}.${ext}`;
  const destDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'designs');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, filename), buffer);
  res.json({ ok: true, url: `/uploads/designs/${filename}` });
});

// CART
router.post('/cart/add', requireAuthApi, (req, res) => {
  try {
    const { productId, materialId, printSizeId, variantId, hasBackPrint, quantity, customization, frontPreview, backPreview } = req.body;
    const breakdown = calculatePrice({
      productId: Number(productId),
      materialId: materialId ? Number(materialId) : null,
      printSizeId: printSizeId ? Number(printSizeId) : null,
      hasBackPrint: !!hasBackPrint,
      quantity: Number(quantity) || 1
    });

    db.prepare(
      `INSERT INTO cart_items (user_id, product_id, material_id, print_size_id, variant_id, quantity, customization_json, front_preview, back_preview, unit_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user.id, Number(productId), materialId ? Number(materialId) : null, printSizeId ? Number(printSizeId) : null,
      variantId ? Number(variantId) : null,
      Number(quantity) || 1, JSON.stringify(customization || {}), frontPreview || null, backPreview || null, breakdown.unit_price
    );

    res.json({ ok: true, message: 'Added to cart!' });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/cart/update/:id', requireAuthApi, (req, res) => {
  const item = db.prepare('SELECT * FROM cart_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Item not found' });
  const qty = Math.max(1, Number(req.body.quantity) || 1);
  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(qty, item.id);
  res.json({ ok: true, lineTotal: Math.round(item.unit_price * qty * 100) / 100 });
});

router.post('/cart/remove/:id', requireAuthApi, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// FAVORITES
router.post('/favorites/toggle/:productId', requireAuthApi, (req, res) => {
  const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND product_id = ?').get(req.user.id, req.params.productId);
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
    return res.json({ ok: true, favorited: false });
  }
  db.prepare('INSERT INTO favorites (user_id, product_id) VALUES (?, ?)').run(req.user.id, req.params.productId);
  res.json({ ok: true, favorited: true });
});

// REVIEWS
router.post('/reviews/add', requireAuthApi, (req, res) => {
  try {
    const { productId, orderItemId, rating, comment } = req.body;
    const cleanComment = sanitizeHtml(comment || '', { allowedTags: [], allowedAttributes: {} });
    db.prepare(
      `INSERT INTO reviews (product_id, user_id, order_item_id, rating, comment) VALUES (?, ?, ?, ?, ?)`
    ).run(Number(productId), req.user.id, orderItemId ? Number(orderItemId) : null, Number(rating), cleanComment);
    res.json({ ok: true, message: 'Review submitted, thank you!' });
  } catch (err) {
    res.status(400).json({ ok: false, error: 'You may have already reviewed this item.' });
  }
});

// NOTIFICATIONS
router.post('/notifications/mark-read/:id', requireAuthApi, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/notifications/mark-all-read', requireAuthApi, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
