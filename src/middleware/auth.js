const { verifyToken } = require('../utils/auth');
const db = require('../models/db');

// Reads JWT from cookie, attaches req.user + res.locals.currentUser
function loadUser(req, res, next) {
  const token = req.cookies && req.cookies.podify_token;
  res.locals.currentUser = null;
  req.user = null;

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const user = db.prepare('SELECT id, name, email, role, avatar, status FROM users WHERE id = ?').get(payload.id);
      if (user && user.status !== 'blocked') {
        req.user = user;
        res.locals.currentUser = user;

        // unread notifications count for navbar badge
        const row = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id);
        res.locals.unreadNotifCount = row ? row.c : 0;

        // cart count
        const cartRow = db.prepare('SELECT COALESCE(SUM(quantity),0) AS c FROM cart_items WHERE user_id = ?').get(user.id);
        res.locals.cartCount = cartRow ? cartRow.c : 0;
      }
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    req.flash('error', 'Please login to continue.');
    return res.redirect('/auth/login');
  }
  next();
}

// same check but for /api routes: returns JSON 401 instead of redirecting to the login page
function requireAuthApi(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'Please log in to continue.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      req.flash('error', 'Please login to continue.');
      return res.redirect('/auth/login');
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('errors/403', { title: 'Access Denied' });
    }
    next();
  };
}

function guestOnly(req, res, next) {
  if (req.user) {
    if (req.user.role === 'admin') return res.redirect('/admin/dashboard');
    if (req.user.role === 'vendor') return res.redirect('/vendor/dashboard');
    return res.redirect('/');
  }
  next();
}

module.exports = { loadUser, requireAuth, requireAuthApi, requireRole, guestOnly };
