const db = require('../models/db');

function notify(userId, title, message, type = 'info', link = null) {
  db.prepare(
    `INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, title, message, type, link);
}

function log(userId, action, details = '', ip = '') {
  db.prepare(
    `INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)`
  ).run(userId || null, action, details, ip);
}

module.exports = { notify, log };
