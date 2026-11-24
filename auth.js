const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginAttempts = new Map();

function getCredentials() {
  return {
    username: process.env.ADMIN_USER || '',
    password: process.env.ADMIN_PASS || '',
    sessionSecret: process.env.SESSION_SECRET || '',
  };
}

function assertAuthConfig() {
  const { username, password, sessionSecret } = getCredentials();
  const placeholder = /replace-with|change-me|example/i;
  if (!username || !password || !sessionSecret) {
    throw new Error('ADMIN_USER, ADMIN_PASS and SESSION_SECRET must be configured.');
  }
  if (placeholder.test(password) || password.length < 12) {
    throw new Error('ADMIN_PASS must be a non-placeholder value with at least 12 characters.');
  }
  if (placeholder.test(sessionSecret) || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be a non-placeholder value with at least 32 characters.');
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function loginRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter(time => now - time < LOGIN_WINDOW_MS);
  if (recent.length >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' });
  }
  recent.push(now);
  loginAttempts.set(key, recent);
  next();
}

router.post('/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body;
  const credentials = getCredentials();
  if (safeEqual(username || '', credentials.username) && safeEqual(password || '', credentials.password)) {
    loginAttempts.delete(req.ip || req.socket.remoteAddress || 'unknown');
    req.session.authenticated = true;
    req.session.username = username;
    return req.session.save(() => res.json({ ok: true }));
  }
  return res.status(401).json({ error: 'Falscher Benutzername oder Passwort' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/check', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

function authMiddleware(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { router, authMiddleware, assertAuthConfig };
