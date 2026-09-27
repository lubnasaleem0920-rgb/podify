require('dotenv').config();
const db = require('../models/db');
const { hashPassword } = require('../utils/auth');

console.log('\nSeeding Podify database...\n');

function slugify(str) {
  return str.toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

// 1. ADMIN USER
const adminEmail = 'admin@podify.com';
let admin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);
if (!admin) {
  const info = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, status, email_verified) VALUES (?, ?, ?, 'admin', 'active', 1)`
  ).run('Podify Admin', adminEmail, hashPassword('Admin@123'));
  admin = { id: info.lastInsertRowid };
  console.log('Admin created  →  email: admin@podify.com  |  password: Admin@123');
} else {
  console.log('• Admin already exists');
}

// 2. CATEGORIES
const categories = [
  { name: 'Water Bottles', icon: 'bi-cup-straw', description: 'Custom printed water bottles — plastic, aluminium & metal' },
  { name: 'Mugs', icon: 'bi-cup-hot', description: 'Ceramic mugs printed with your design' },
  { name: 'T-Shirts', icon: 'bi-person-standing', description: 'Custom printed apparel' },
  { name: 'Caps', icon: 'bi-badge-tm', description: 'Custom printed caps and hats' },
  { name: 'Tote Bags', icon: 'bi-bag', description: 'Reusable custom printed tote bags' },
  { name: 'Phone Cases', icon: 'bi-phone', description: 'Custom printed phone cases' },
];
const catIds = {};
categories.forEach(c => {
  let row = db.prepare('SELECT id FROM categories WHERE name = ?').get(c.name);
  if (!row) {
    const info = db.prepare('INSERT INTO categories (name, slug, description, icon) VALUES (?, ?, ?, ?)').run(c.name, slugify(c.name), c.description, c.icon);
    row = { id: info.lastInsertRowid };
  }
  catIds[c.name] = row.id;
});
console.log('Categories seeded (' + categories.length + ')');

// 3. MATERIALS — groups (e.g. "Bare Surface") hold leaf materials (e.g. "Plastic") that carry the actual price
const materialGroups = [
  {
    name: 'Bare / Painted Surface',
    description: 'No fabric or leather cover — the product body itself is printed on directly.',
    children: [
      { name: 'Plastic', price_per_unit: 3.5, description: 'Standard plastic surface print' },
      { name: 'Aluminium', price_per_unit: 6.0, description: 'Aluminium body — durable metallic finish' },
      { name: 'Stainless Steel', price_per_unit: 7.5, description: 'Premium metal body, scratch resistant' },
    ]
  },
  {
    name: 'Fabric / Leather Cover',
    description: 'A soft cover or fabric surface — printing goes on the covering material.',
    children: [
      { name: 'Woolen Cover', price_per_unit: 5.0, description: 'Soft woolen fabric cover print' },
      { name: 'Rexine / Leather Cover', price_per_unit: 8.0, description: 'Leather/rexine textured surface' },
      { name: 'Cotton Cloth', price_per_unit: 4.0, description: 'Cotton fabric surface, breathable print' },
      { name: 'Polyester Blend', price_per_unit: 4.5, description: 'Polyester-cotton blend fabric' },
    ]
  },
];
// Materials with no group (simple products that don't need an elimination step)
const standaloneMaterials = [
  { name: 'Ceramic', price_per_unit: 4.5, description: 'Glazed ceramic surface' },
];

const matIds = {}; // name -> id, for both groups and leaves
for (const group of materialGroups) {
  let groupRow = db.prepare('SELECT id FROM materials WHERE name = ?').get(group.name);
  if (!groupRow) {
    const info = db.prepare('INSERT INTO materials (name, parent_id, price_per_unit, description) VALUES (?, NULL, 0, ?)').run(group.name, group.description);
    groupRow = { id: info.lastInsertRowid };
  }
  matIds[group.name] = groupRow.id;
  for (const child of group.children) {
    let row = db.prepare('SELECT id FROM materials WHERE name = ?').get(child.name);
    if (!row) {
      const info = db.prepare('INSERT INTO materials (name, parent_id, price_per_unit, description) VALUES (?, ?, ?, ?)').run(child.name, groupRow.id, child.price_per_unit, child.description);
      row = { id: info.lastInsertRowid };
    } else {
      // make sure existing rows are correctly linked under their group (idempotent re-seed)
      db.prepare('UPDATE materials SET parent_id = ? WHERE id = ? AND parent_id IS NULL').run(groupRow.id, row.id);
    }
    matIds[child.name] = row.id;
  }
}
for (const m of standaloneMaterials) {
  let row = db.prepare('SELECT id FROM materials WHERE name = ?').get(m.name);
  if (!row) {
    const info = db.prepare('INSERT INTO materials (name, parent_id, price_per_unit, description) VALUES (?, NULL, ?, ?)').run(m.name, m.price_per_unit, m.description);
    row = { id: info.lastInsertRowid };
  }
  matIds[m.name] = row.id;
}
console.log('Materials seeded (2 groups, ' + (materialGroups.reduce((s, g) => s + g.children.length, 0) + standaloneMaterials.length) + ' selectable materials)');

// 4. PRINT SIZES
const sizes = [
  { label: 'Small', width_in: 2, height_in: 2, price_per_sq_inch: 4 },
  { label: 'Medium', width_in: 4, height_in: 4, price_per_sq_inch: 5 },
  { label: 'Large', width_in: 6, height_in: 6, price_per_sq_inch: 6 },
  { label: 'Full Wrap', width_in: 8, height_in: 10, price_per_sq_inch: 7 },
];
sizes.forEach(s => {
  const row = db.prepare('SELECT id FROM print_sizes WHERE label = ?').get(s.label);
  if (!row) db.prepare('INSERT INTO print_sizes (label, width_in, height_in, price_per_sq_inch) VALUES (?, ?, ?, ?)').run(s.label, s.width_in, s.height_in, s.price_per_sq_inch);
});
console.log('Print sizes seeded (' + sizes.length + ')');

// 5. FONTS (incl. calligraphy)
const fonts = [
  { name: 'Poppins', css_family: 'Poppins, sans-serif', is_calligraphy: 0 },
  { name: 'Inter', css_family: 'Inter, sans-serif', is_calligraphy: 0 },
  { name: 'Pacifico', css_family: "'Pacifico', cursive", is_calligraphy: 1 },
  { name: 'Dancing Script', css_family: "'Dancing Script', cursive", is_calligraphy: 1 },
  { name: 'Great Vibes', css_family: "'Great Vibes', cursive", is_calligraphy: 1 },
  { name: 'Sacramento', css_family: "'Sacramento', cursive", is_calligraphy: 1 },
];
fonts.forEach(f => {
  const row = db.prepare('SELECT id FROM fonts WHERE name = ?').get(f.name);
  if (!row) db.prepare('INSERT INTO fonts (name, css_family, is_calligraphy) VALUES (?, ?, ?)').run(f.name, f.css_family, f.is_calligraphy);
});
console.log('Fonts seeded (' + fonts.length + ')');

// 6. DEMO VENDOR
const vendorEmail = 'vendor@podify.com';
let vendor = db.prepare('SELECT * FROM users WHERE email = ?').get(vendorEmail);
if (!vendor) {
  const info = db.prepare(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified, city) VALUES (?, ?, ?, ?, 'vendor', 'active', 1, ?)`
  ).run('PrintCraft Studio', vendorEmail, '03001234567', hashPassword('Vendor@123'), 'Karachi');
  vendor = { id: info.lastInsertRowid };
  console.log('Demo vendor created  →  email: vendor@podify.com  |  password: Vendor@123');
} else {
  console.log('• Demo vendor already exists');
}

// 7. DEMO CUSTOMER
const custEmail = 'customer@podify.com';
let customer = db.prepare('SELECT * FROM users WHERE email = ?').get(custEmail);
if (!customer) {
  const info = db.prepare(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified, city, address) VALUES (?, ?, ?, ?, 'customer', 'active', 1, ?, ?)`
  ).run('Ayesha Khan', custEmail, '03211234567', hashPassword('Customer@123'), 'Lahore', 'Street 12, Gulberg III');
  customer = { id: info.lastInsertRowid };
  console.log('Demo customer created  →  email: customer@podify.com  |  password: Customer@123');
} else {
  console.log('• Demo customer already exists');
}

// 8. DEMO PRODUCTS (approved, with materials attached)
const demoProducts = [
  {
    name: 'Classic Sports Water Bottle', category: 'Water Bottles', base_price: 450,
    description: 'A durable everyday water bottle — available in plastic, aluminium or stainless steel, fully customizable with your own design or text.',
    front_image: '/images/products/water-bottle.svg', back_image: null,
    materials: ['Plastic', 'Aluminium', 'Stainless Steel', 'Woolen Cover', 'Rexine / Leather Cover', 'Cotton Cloth'], supports_back_print: 0,
    variants: [
      { name: 'Silver', hex: '#B9C2D8', front: '/images/products/variants/bottle-silver.svg' },
      { name: 'Black', hex: '#242030', front: '/images/products/variants/bottle-black.svg' },
      { name: 'Navy', hex: '#233B72', front: '/images/products/variants/bottle-navy.svg' },
    ]
  },
  {
    name: 'Premium Ceramic Mug', category: 'Mugs', base_price: 350,
    description: 'A glazed ceramic mug perfect for gifting — add a photo, a name, or a heartfelt message.',
    front_image: '/images/products/mug.svg', back_image: null,
    materials: ['Ceramic'], supports_back_print: 0,
    variants: [
      { name: 'White', hex: '#E9E7F0', front: '/images/products/variants/mug-white.svg' },
      { name: 'Black', hex: '#242030', front: '/images/products/variants/mug-black.svg' },
      { name: 'Glossy Blue', hex: '#2E5CD9', front: '/images/products/variants/mug-glossyblue.svg' },
    ]
  },
  {
    name: 'Custom Print T-Shirt', category: 'T-Shirts', base_price: 650,
    description: '100% cotton t-shirt, fully customizable with your own design or text. Also available with back-side printing — just ask your vendor.',
    front_image: '/images/products/tshirt-front.svg', back_image: '/images/products/tshirt-back.svg',
    materials: ['Cotton Cloth', 'Polyester Blend'], supports_back_print: 0,
    variants: [
      { name: 'White', hex: '#E4E2EC', front: '/images/products/variants/tshirt-front-white.svg', back: '/images/products/variants/tshirt-back-white.svg' },
      { name: 'Black', hex: '#242030', front: '/images/products/variants/tshirt-front-black.svg', back: '/images/products/variants/tshirt-back-black.svg' },
      { name: 'Maroon', hex: '#C81E3A', front: '/images/products/variants/tshirt-front-maroon.svg', back: '/images/products/variants/tshirt-back-maroon.svg' },
    ]
  },
  {
    name: 'Embroidered Sports Cap', category: 'Caps', base_price: 380,
    description: 'Adjustable cap with a clean printable panel for logos, initials, or short text.',
    front_image: '/images/products/cap.svg', back_image: null,
    materials: ['Cotton Cloth', 'Rexine / Leather Cover'], supports_back_print: 0,
    variants: [
      { name: 'Black', hex: '#242030', front: '/images/products/variants/cap-black.svg' },
      { name: 'Navy', hex: '#233B72', front: '/images/products/variants/cap-navy.svg' },
    ]
  },
  {
    name: 'Canvas Tote Bag', category: 'Tote Bags', base_price: 400,
    description: 'Eco-friendly canvas tote bag — perfect canvas for bold prints and calligraphy quotes.',
    front_image: '/images/products/tote-bag.svg', back_image: null,
    materials: ['Cotton Cloth', 'Rexine / Leather Cover'], supports_back_print: 0,
    variants: [
      { name: 'Beige', hex: '#D2C29E', front: '/images/products/variants/tote-beige.svg' },
      { name: 'Black', hex: '#242030', front: '/images/products/variants/tote-black.svg' },
    ]
  },
  {
    name: 'Slim Phone Case', category: 'Phone Cases', base_price: 500,
    description: 'A protective, slim-fit phone case with a vivid printable back panel.',
    front_image: '/images/products/phone-case.svg', back_image: null,
    materials: ['Plastic'], supports_back_print: 0,
    variants: [
      { name: 'Black', hex: '#242030', front: '/images/products/variants/phonecase-black.svg' },
      { name: 'Blue', hex: '#2E5CD9', front: '/images/products/variants/phonecase-blue.svg' },
    ]
  },
];

demoProducts.forEach(p => {
  const slug = slugify(p.name);
  let row = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
  if (!row) {
    const info = db.prepare(
      `INSERT INTO products (vendor_id, category_id, name, slug, description, base_price, front_image, back_image, supports_back_print, supports_text, supports_image, status, stock, rating_avg, rating_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'approved', 150, ?, ?)`
    ).run(vendor.id, catIds[p.category], p.name, slug, p.description, p.base_price, p.front_image, p.back_image, p.supports_back_print,
      (Math.random() * 1.5 + 3.5).toFixed(2), Math.floor(Math.random() * 40 + 5));
    row = { id: info.lastInsertRowid };
    p.materials.forEach(mName => {
      db.prepare('INSERT INTO product_materials (product_id, material_id) VALUES (?, ?)').run(row.id, matIds[mName]);
    });
    (p.variants || []).forEach((v, idx) => {
      db.prepare('INSERT INTO product_variants (product_id, color_name, color_hex, front_image, back_image, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.id, v.name, v.hex, v.front, v.back || null, idx);
    });
  }
});
console.log('Demo products seeded (' + demoProducts.length + ') with color variants');

console.log('\nSeeding complete!\n');
console.log('----------------------------------------');
console.log('Login credentials:');
console.log('  Admin:    admin@podify.com    / Admin@123');
console.log('  Vendor:   vendor@podify.com   / Vendor@123');
console.log('  Customer: customer@podify.com / Customer@123');
console.log('----------------------------------------\n');
