const express = require('express');
const router = express.Router();
const db = require('../models/db');

// HOME
router.get('/', (req, res) => {
  const categories = db.prepare("SELECT * FROM categories WHERE status = 'active' ORDER BY name").all();
  const featured = db.prepare(
    `SELECT p.*, c.name AS category_name, u.name AS vendor_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN users u ON u.id = p.vendor_id
     WHERE p.status = 'approved'
     ORDER BY p.rating_avg DESC, p.created_at DESC LIMIT 8`
  ).all();
  const newest = db.prepare(
    `SELECT p.*, c.name AS category_name FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.status = 'approved' ORDER BY p.created_at DESC LIMIT 8`
  ).all();
  res.render('user/home', { title: 'Podify — Design & Print Anything', categories, featured, newest });
});

// PRODUCT LISTING
router.get('/products', (req, res) => {
  const { category, q, sort, min_price, max_price } = req.query;
  let sql = `SELECT p.*, c.name AS category_name, c.slug AS category_slug, u.name AS vendor_name
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN users u ON u.id = p.vendor_id
             WHERE p.status = 'approved'`;
  const params = [];

  if (category) { sql += ' AND c.slug = ?'; params.push(category); }
  if (q) { sql += ' AND (p.name LIKE ? OR p.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (min_price) { sql += ' AND p.base_price >= ?'; params.push(Number(min_price)); }
  if (max_price) { sql += ' AND p.base_price <= ?'; params.push(Number(max_price)); }

  if (sort === 'price_asc') sql += ' ORDER BY p.base_price ASC';
  else if (sort === 'price_desc') sql += ' ORDER BY p.base_price DESC';
  else if (sort === 'rating') sql += ' ORDER BY p.rating_avg DESC';
  else sql += ' ORDER BY p.created_at DESC';

  const products = db.prepare(sql).all(...params);
  const categories = db.prepare("SELECT * FROM categories WHERE status = 'active' ORDER BY name").all();

  res.render('user/products', {
    title: 'Browse Products',
    products, categories,
    filters: { category: category || '', q: q || '', sort: sort || '', min_price: min_price || '', max_price: max_price || '' }
  });
});

// PRODUCT DETAIL + CUSTOMIZER
router.get('/products/:slug', (req, res) => {
  const product = db.prepare(
    `SELECT p.*, c.name AS category_name, u.name AS vendor_name FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN users u ON u.id = p.vendor_id
     WHERE p.slug = ? AND p.status = 'approved'`
  ).get(req.params.slug);

  if (!product) return res.status(404).render('errors/404', { title: 'Product Not Found' });

  const materials = db.prepare(
    `SELECT m.*, p.name AS parent_name FROM materials m
     JOIN product_materials pm ON pm.material_id = m.id
     LEFT JOIN materials p ON p.id = m.parent_id
     WHERE pm.product_id = ? AND m.status = 'active'
     ORDER BY p.name IS NULL, p.name, m.name`
  ).all(product.id);

  // Group leaf materials by their parent group name, so the customizer can
  // show a step-by-step "elimination process": pick a group first (if more
  // than one applies to this product), then pick the exact material.
  const materialGroups = {};
  materials.forEach(m => {
    const groupKey = m.parent_name || '__standalone__';
    if (!materialGroups[groupKey]) materialGroups[groupKey] = [];
    materialGroups[groupKey].push(m);
  });

  const sizes = db.prepare("SELECT * FROM print_sizes WHERE status = 'active' ORDER BY price_per_sq_inch ASC").all();
  const fonts = db.prepare("SELECT * FROM fonts WHERE status = 'active' ORDER BY is_calligraphy, name").all();
  const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order, id').all(product.id);
  const reviews = db.prepare(
    `SELECT r.*, u.name AS user_name, u.avatar FROM reviews r
     JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.created_at DESC`
  ).all(product.id);

  const related = db.prepare(
    `SELECT * FROM products WHERE category_id = ? AND id != ? AND status = 'approved' LIMIT 4`
  ).all(product.category_id, product.id);

  res.render('user/product-detail', {
    title: product.name,
    product, materials, materialGroups, sizes, fonts, reviews, related, variants,
    printableArea: safeParseJSON(product.printable_area_json)
  });
});

function safeParseJSON(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}

// STATIC PAGES
router.get('/about', (req, res) => res.render('user/about', { title: 'About Podify' }));
router.get('/contact', (req, res) => res.render('user/contact', { title: 'Contact Us' }));
router.post('/contact', (req, res) => {
  req.flash('success', 'Thanks for reaching out! Our team will get back to you within 24 hours.');
  res.redirect('/contact');
});

module.exports = router;
