const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-booking-test-'));

process.env.NODE_ENV = 'test';
process.env.HOST = '127.0.0.1';
process.env.ADMIN_USER = 'portfolio-admin';
process.env.ADMIN_PASS = 'a-strong-test-password';
process.env.SESSION_SECRET = 'test-session-secret-with-more-than-32-characters';
process.env.DATABASE_PATH = path.join(testDir, 'test.db');
delete process.env.RESEND_API_KEY;

const database = require('../database');
const { startServer, stopServer } = require('../server');

let baseUrl;

before(async () => {
  database.initDatabase();
  const server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  stopServer();
  database.closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('public status is available with defensive headers and without wildcard CORS', async () => {
  const response = await fetch(`${baseUrl}/api/status`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('admin API requires authentication even from localhost', async () => {
  const response = await fetch(`${baseUrl}/api/settings`);
  assert.equal(response.status, 401);
});

test('login creates a protected session and never exposes email credentials', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /^salon\.sid=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  const settings = await fetch(`${baseUrl}/api/settings`, { headers: { cookie } });
  assert.equal(settings.status, 200);
  const body = await settings.json();
  assert.equal(body.resend_api_key, undefined);
  assert.equal(body.email_provider_configured, false);

  const secretWrite = await fetch(`${baseUrl}/api/settings/resend_api_key`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ value: 'must-not-be-stored' }),
  });
  assert.equal(secretWrite.status, 400);
});

test('invalid login is rejected', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USER, password: 'wrong-password' }),
  });
  assert.equal(response.status, 401);
});
