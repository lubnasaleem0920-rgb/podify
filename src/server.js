require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const flash = require('connect-flash');
const helmet = require('helmet');
const morgan = require('morgan');

const { loadUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Security & core middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'none'"], // intentional: no inline onclick="" etc. anywhere in the views —
                                  // every interaction is wired up via addEventListener in public/js/*.js
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));
app.use(flash());

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// Basic rate limiter (no external dep) for auth routes
const rateBuckets = new Map();
function simpleRateLimit({ windowMs = 60000, max = 20 } = {}) {
  return (req, res, next) => {
    const key = req.ip + '|' + req.baseUrl + req.path;
    const now = Date.now();
    const bucket = rateBuckets.get(key) || [];
    const fresh = bucket.filter(ts => now - ts < windowMs);
    fresh.push(now);
    rateBuckets.set(key, fresh);
    if (fresh.length > max) {
      return res.status(429).render('errors/429', { title: 'Too Many Requests' });
    }
    next();
  };
}
app.set('simpleRateLimit', simpleRateLimit);

// Locals & user context
app.use(loadUser);
app.use((req, res, next) => {
  res.locals.appName = process.env.APP_NAME || 'Podify';
  res.locals.flashSuccess = req.flash('success');
  res.locals.flashError = req.flash('error');
  res.locals.currentPath = req.path;
  next();
});

// Routes
app.use('/', require('./routes/publicRoutes'));
app.use('/auth', require('./routes/authRoutes'));
app.use('/api', require('./routes/apiRoutes'));
app.use('/user', require('./routes/userRoutes'));
app.use('/vendor', require('./routes/vendorRoutes'));
app.use('/admin', require('./routes/adminRoutes'));

// 404
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).render('errors/500', { title: 'Something Went Wrong', message: process.env.NODE_ENV === 'development' ? err.message : null });
});

app.listen(PORT, () => {
  console.log(`\nPodify running at http://localhost:${PORT}\n`);
});

module.exports = app;
