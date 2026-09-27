const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { nanoid } = require('nanoid');
const db = require('../models/db');
const { hashPassword, comparePassword, signToken } = require('../utils/auth');
const { guestOnly, requireAuth } = require('../middleware/auth');
const { notify, log } = require('../utils/notify');

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 };

// REGISTER
router.get('/register', guestOnly, (req, res) => {
  res.render('auth/register', { title: 'Create Account', role: req.query.role === 'vendor' ? 'vendor' : 'customer' });
});

router.post('/register',
  guestOnly,
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
    body('phone').optional({ checkFalsy: true }).isLength({ min: 7 }),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('confirm_password').custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Passwords do not match');
      return true;
    })
  ],
  (req, res) => {
    const errors = validationResult(req);
    const role = req.body.role === 'vendor' ? 'vendor' : 'customer';
    if (!errors.isEmpty()) {
      req.flash('error', errors.array().map(e => e.msg).join(', '));
      return res.redirect('/auth/register?role=' + role);
    }
    const { name, email, phone, password, address, city } = req.body;

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      req.flash('error', 'An account with this email already exists.');
      return res.redirect('/auth/register?role=' + role);
    }

    const password_hash = hashPassword(password);
    const verification_token = nanoid(24);
    // Vendors start as 'pending' until admin approval; customers are active immediately
    const status = role === 'vendor' ? 'pending' : 'active';

    const info = db.prepare(
      `INSERT INTO users (name, email, phone, password_hash, role, status, verification_token, address, city, email_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(name, email, phone || null, password_hash, role, status, verification_token, address || null, city || null);

    log(info.lastInsertRowid, 'REGISTER', `role=${role}`, req.ip);

    if (role === 'vendor') {
      notify(info.lastInsertRowid, 'Vendor Application Received', 'Your vendor account is pending admin approval. We will notify you once approved.', 'system');
      // notify all admins
      const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
      admins.forEach(a => notify(a.id, 'New Vendor Application', `${name} (${email}) applied to become a vendor.`, 'system', '/admin/vendors'));
      req.flash('success', 'Vendor account created! Please wait for admin approval before you can add products.');
      return res.redirect('/auth/login');
    }

    notify(info.lastInsertRowid, 'Welcome to Podify!', 'Your account has been created successfully. Start customizing your first product!', 'system');
    req.flash('success', 'Account created successfully! Please login.');
    res.redirect('/auth/login');
  }
);

// LOGIN
router.get('/login', guestOnly, (req, res) => {
  res.render('auth/login', { title: 'Login' });
});

router.post('/login', guestOnly, (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim().toLowerCase());

  if (!user || !comparePassword(password || '', user.password_hash)) {
    req.flash('error', 'Invalid email or password.');
    return res.redirect('/auth/login');
  }
  if (user.status === 'blocked') {
    req.flash('error', 'Your account has been blocked. Contact support.');
    return res.redirect('/auth/login');
  }
  if (user.status === 'pending' && user.role === 'vendor') {
    req.flash('error', 'Your vendor account is still pending admin approval.');
    return res.redirect('/auth/login');
  }

  const token = signToken(user);
  res.cookie('podify_token', token, COOKIE_OPTS);
  log(user.id, 'LOGIN', '', req.ip);

  if (user.role === 'admin') return res.redirect('/admin/dashboard');
  if (user.role === 'vendor') return res.redirect('/vendor/dashboard');
  const redirectTo = req.session.redirectAfterLogin || '/';
  delete req.session.redirectAfterLogin;
  res.redirect(redirectTo);
});

// LOGOUT
router.get('/logout', (req, res) => {
  res.clearCookie('podify_token');
  req.flash('success', 'Logged out successfully.');
  res.redirect('/auth/login');
});

// FORGOT PASSWORD (simulated email)
router.get('/forgot-password', guestOnly, (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password', resetLink: null });
});

router.post('/forgot-password', guestOnly, (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    req.flash('error', 'No account found with that email.');
    return res.redirect('/auth/forgot-password');
  }
  const token = nanoid(32);
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expires, user.id);

  // No real email service configured -> show the reset link directly (simulated inbox)
  const resetLink = `/auth/reset-password/${token}`;
  res.render('auth/forgot-password', { title: 'Forgot Password', resetLink });
});

router.get('/reset-password/:token', guestOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(req.params.token);
  if (!user || new Date(user.reset_token_expires) < new Date()) {
    req.flash('error', 'This reset link is invalid or has expired.');
    return res.redirect('/auth/forgot-password');
  }
  res.render('auth/reset-password', { title: 'Reset Password', token: req.params.token });
});

router.post('/reset-password/:token', guestOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(req.params.token);
  if (!user || new Date(user.reset_token_expires) < new Date()) {
    req.flash('error', 'This reset link is invalid or has expired.');
    return res.redirect('/auth/forgot-password');
  }
  const { password, confirm_password } = req.body;
  if (!password || password.length < 6) {
    req.flash('error', 'Password must be at least 6 characters.');
    return res.redirect('back');
  }
  if (password !== confirm_password) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect('back');
  }
  const password_hash = hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?').run(password_hash, user.id);
  notify(user.id, 'Password Changed', 'Your password was reset successfully. If this wasn\'t you, contact support immediately.', 'system');
  req.flash('success', 'Password reset successfully! Please login.');
  res.redirect('/auth/login');
});

module.exports = router;
