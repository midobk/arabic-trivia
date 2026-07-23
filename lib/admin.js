// Admin auth + CRUD HTTP handlers for the trivia question bank.
//
// Auth: simple HMAC-signed cookie session.
//   - ADMIN_PASSWORD env var sets the password (default: 'admin' locally, random on Railway if unset)
//   - SESSION_SECRET env var signs the cookie (default: same as ADMIN_PASSWORD for simplicity)
//
// Endpoints (all under /admin/api):
//   POST   /login              body: { password }  → 200 { ok } + Set-Cookie
//   POST   /logout             → 200 { ok }
//   GET    /me                 → 200 { authed: bool }
//   GET    /questions           → 200 [question, ...]
//   GET    /questions/:id      → 200 question | 404
//   POST   /questions           body: question  → 201 question
//   POST   /questions/bulk      body: [question, ...]  → 201 { inserted, ids }  (AGENT-FRIENDLY)
//   PUT    /questions/:id      body: question  → 200 question
//   DELETE /questions/:id      → 200 { ok }
//   GET    /stats               → 200 { total, byDifficulty, byCategory }

const crypto = require('crypto');
const url = require('url');
const db = require('./db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (() => {
  if (process.env.RAILWAY_ENVIRONMENT || process.env.PORT) {
    // On Railway (or any process with PORT set), generate a random password
    // and log it once so the operator can grab it from the deploy logs.
    const pwd = crypto.randomBytes(8).toString('base64url');
    console.log('==============================================================');
    console.log('  ADMIN PASSWORD (random, no ADMIN_PASSWORD env set):');
    console.log('  ' + pwd);
    console.log('  Save this — you\'ll need it to log in to /admin');
    console.log('  Set ADMIN_PASSWORD env to pin a value across restarts.');
    console.log('==============================================================');
    return pwd;
  }
  return 'admin';
})();
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = 'admin_session';

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function makeToken() {
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('base64url');
  return `${exp}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('base64url');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}

function isAuthed(req) {
  const cookies = parseCookies(req);
  return verifyToken(cookies[COOKIE_NAME]);
}

function setSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${makeToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendAdminHtml(res) {
  const fs = require('fs');
  const path = require('path');
  fs.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8', (err, html) => {
    if (err) { res.writeHead(500); res.end('admin.html not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1024 * 1024) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function handleAdminApi(req, res) {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const method = req.method;

  // Public endpoints (no auth required)
  if (path === '/admin/api/login' && method === 'POST') {
    return readJsonBody(req).then((body) => {
      if (typeof body.password !== 'string' || body.password !== ADMIN_PASSWORD) {
        return json(res, 401, { error: 'كلمة السر خاطئة' });
      }
      setSessionCookie(res);
      json(res, 200, { ok: true });
    }).catch((e) => json(res, 400, { error: e.message }));
  }
  if (path === '/admin/api/me' && method === 'GET') {
    return json(res, 200, { authed: isAuthed(req) });
  }

  // Everything else requires auth
  if (!isAuthed(req)) return json(res, 401, { error: 'not authenticated' });

  // Authenticated endpoints
  if (path === '/admin/api/logout' && method === 'POST') {
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }
  if (path === '/admin/api/stats' && method === 'GET') {
    return json(res, 200, db.stats());
  }
  if (path === '/admin/api/questions' && method === 'GET') {
    return json(res, 200, db.listAll());
  }
  if (path === '/admin/api/questions' && method === 'POST') {
    return readJsonBody(req).then((body) => {
      const q = db.create(body);
      json(res, 201, q);
    }).catch((e) => json(res, 400, { error: e.message }));
  }
  if (path === '/admin/api/questions/bulk' && method === 'POST') {
    return readJsonBody(req).then((body) => {
      const list = body && (body.questions || body);
      if (!Array.isArray(list)) return json(res, 400, { error: 'expected an array of questions' });
      const r = db.createMany(list);
      json(res, 201, r);
    }).catch((e) => json(res, 400, { error: e.message }));
  }
  if (path.startsWith('/admin/api/questions/') && method === 'GET') {
    const id = parseInt(path.slice('/admin/api/questions/'.length), 10);
    if (Number.isNaN(id)) return json(res, 400, { error: 'bad id' });
    const q = db.getById(id);
    return q ? json(res, 200, q) : json(res, 404, { error: 'not found' });
  }
  if (path.startsWith('/admin/api/questions/') && method === 'PUT') {
    const id = parseInt(path.slice('/admin/api/questions/'.length), 10);
    if (Number.isNaN(id)) return json(res, 400, { error: 'bad id' });
    return readJsonBody(req).then((body) => {
      const q = db.update(id, body);
      json(res, 200, q);
    }).catch((e) => json(res, 400, { error: e.message }));
  }
  if (path.startsWith('/admin/api/questions/') && method === 'DELETE') {
    const id = parseInt(path.slice('/admin/api/questions/'.length), 10);
    if (Number.isNaN(id)) return json(res, 400, { error: 'bad id' });
    const ok = db.remove(id);
    return json(res, ok ? 200 : 404, { ok });
  }

  json(res, 404, { error: 'unknown admin route' });
}

module.exports = {
  handleAdminApi,
  sendAdminHtml,
  isAuthed,
  ADMIN_PASSWORD, // exposed for CLI/scripts that need to call the agent endpoint
};
