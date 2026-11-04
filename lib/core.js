'use strict';
/**
 * Core: configuration, game state + persistence, security helpers, permissions,
 * live event stream, rate limiting and a tiny router. Zero framework.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = process.env;

const cfg = {
  PORT: Number(E.PORT) || 3000,
  SECRET: E.SECRET || '',
  ADMIN_USERNAME: (E.ADMIN_USERNAME || 'admin').toLowerCase(),
  ADMIN_PASSWORD: E.ADMIN_PASSWORD || '',
  FORCE_ADMIN_RESET: E.FORCE_ADMIN_RESET === '1',
  BASE_URL: (E.BASE_URL || '').replace(/\/+$/, ''),
  DATA_DIR: E.DATA_DIR || path.join(__dirname, '..', 'data'),
  UPSTASH_URL: E.UPSTASH_REDIS_REST_URL || '',
  UPSTASH_TOKEN: E.UPSTASH_REDIS_REST_TOKEN || '',
  ON_RENDER: !!E.RENDER,
  ROOT: path.join(__dirname, '..'),
};
const LETTERS = ['M', 'r', '.', 'D', 'o', 'o', 'D'];
const TOTAL = 7;

function log(level, ...a) { console[level === 'error' ? 'error' : 'log'](new Date().toISOString(), level.toUpperCase(), ...a); }

// ------------------------------------------------------------------ state
function defaultSettings() {
  return {
    general: { title: 'Mr.DooD QR Hunt', brand: 'Mr.DooD', eventInfo: '', description: 'Find the 7 hidden QR codes, collect every letter and unlock the secret word.', secretAnswer: 'MrDooD' },
    game: { status: 'live', registrationOpen: true, scanningOpen: true, dupPolicy: 'notify', minScanGapSec: 10, blockFastScans: false, suspiciousThreshold: 1, prizeLimit: 0 },
    security: { sessionHours: 12, loginMax: 8, loginWindowMin: 15 },
    notifications: { ntfyServer: 'https://ntfy.sh', ntfyTopic: '', telegramToken: '', telegramChat: '' },
  };
}
function defaultState() {
  return { v: 2, settings: defaultSettings(), qr: null, retired: [], players: {}, admins: [], log: [], audit: [], counters: { invalid: 0, revoked: 0, dup: 0 }, startedAt: null, resetAt: null };
}
const core = { cfg, LETTERS, TOTAL, state: defaultState(), log };

function migrate(s) {
  const d = defaultState();
  const out = Object.assign(d, s || {});
  const ds = defaultSettings();
  out.settings = {};
  for (const k of Object.keys(ds)) out.settings[k] = Object.assign({}, ds[k], (s && s.settings && s.settings[k]) || {});
  if (s && typeof s.gameOpen === 'boolean' && !s.settings) out.settings.game.status = s.gameOpen ? 'live' : 'paused';
  out.counters = Object.assign({ invalid: 0, revoked: 0, dup: 0 }, out.counters || {});
  for (const p of Object.values(out.players || {})) {
    p.scans = p.scans || []; p.won = p.won || null; p.dq = !!p.dq; p.attempts = p.attempts || 0;
  }
  return out;
}

// ------------------------------------------------------------------ persistence
let dirty = false, saving = false, saveTimer = null;
function scheduleSave(delay = 400) {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; flush(); }, delay);
}
async function upstash(cmd) {
  const r = await fetch(cfg.UPSTASH_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.UPSTASH_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('upstash ' + r.status);
  return r.json();
}
async function flush() {
  if (saving || !dirty) return;
  saving = true; dirty = false;
  let failed = false;
  try {
    const json = JSON.stringify(core.state);
    if (cfg.UPSTASH_URL && cfg.UPSTASH_TOKEN) await upstash(['SET', 'mrdood:state:v2', json]);
    else {
      fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
      const f = path.join(cfg.DATA_DIR, 'state.json');
      fs.writeFileSync(f + '.tmp', json);
      fs.renameSync(f + '.tmp', f);
    }
  } catch (e) { failed = true; log('error', 'save failed:', e.message); }
  finally {
    saving = false;
    if (failed) dirty = true;
    if (dirty && !saveTimer) scheduleSave(failed ? 3000 : 400);
  }
}
async function load() {
  try {
    let raw = null;
    if (cfg.UPSTASH_URL && cfg.UPSTASH_TOKEN) {
      raw = (await upstash(['GET', 'mrdood:state:v2'])).result;
      if (!raw) raw = (await upstash(['GET', 'mrdood:state'])).result; // v1 data
    } else {
      const f = path.join(cfg.DATA_DIR, 'state.json');
      if (fs.existsSync(f)) raw = fs.readFileSync(f, 'utf8');
    }
    if (raw) core.state = migrate(JSON.parse(raw));
  } catch (e) { log('error', 'load failed (starting fresh):', e.message); }
}
core.scheduleSave = scheduleSave; core.flush = flush; core.load = load; core.migrate = migrate;

// ------------------------------------------------------------------ crypto / cookies
const mac = (s) => crypto.createHmac('sha256', cfg.SECRET).update('ck|' + s).digest('base64url').slice(0, 32);
const sign = (v) => v + '.' + mac(v);
function unsign(s) {
  if (!s) return null;
  const i = s.lastIndexOf('.');
  if (i < 1) return null;
  const v = s.slice(0, i), m = s.slice(i + 1), e = mac(v);
  if (m.length !== e.length) return null;
  return crypto.timingSafeEqual(Buffer.from(m), Buffer.from(e)) ? v : null;
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* bad cookie */ } }
  });
  return out;
}
const isHttps = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket.encrypted;
function setCookie(req, res, name, value, opts = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${opts.path || '/'}; HttpOnly; SameSite=Strict; Max-Age=${opts.maxAge ?? 31536000}`;
  if (isHttps(req)) c += '; Secure';
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64, { N: 16384 }).toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const [s, h] = String(stored).split(':');
    const a = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 64, { N: 16384 });
    return crypto.timingSafeEqual(a, Buffer.from(h, 'hex'));
  } catch (e) { return false; }
}
Object.assign(core, { sign, unsign, parseCookies, setCookie, isHttps, sha, hashPassword, verifyPassword });

// ------------------------------------------------------------------ permissions
const ROLE_PERMS = {
  super: ['*'],
  manager: ['stats.view', 'live.view', 'players.view', 'players.manage', 'winners.view', 'winners.manage', 'game.control'],
  qr: ['qr.view', 'qr.manage', 'qr.download'],
};
const ALL_PERMS = ['stats.view', 'live.view', 'players.view', 'players.manage', 'winners.view', 'winners.manage', 'game.control',
  'qr.view', 'qr.manage', 'qr.download', 'qr.reset', 'settings.view', 'settings.edit', 'security.manage', 'admins.manage', 'data.manage', 'audit.view'];
const GRANTABLE = ALL_PERMS.filter((p) => !['admins.manage', 'security.manage', 'qr.reset'].includes(p));
function permsOf(a) {
  if (!a) return [];
  const base = ROLE_PERMS[a.role] || [];
  if (base.includes('*')) return ALL_PERMS.slice();
  return Array.from(new Set(base.concat((a.extraPerms || []).filter((p) => GRANTABLE.includes(p)))));
}
const can = (a, perm) => permsOf(a).includes(perm);
Object.assign(core, { ROLE_PERMS, ALL_PERMS, GRANTABLE, permsOf, can });

function adminFromReq(req) {
  const v = unsign(parseCookies(req).adm);
  if (!v) return null;
  const [id, exp, sv] = v.split('|');
  if (!id || Number(exp) < Date.now()) return null;
  const a = core.state.admins.find((x) => x.id === id);
  if (!a || a.disabled || String(a.sv) !== sv) return null;
  return a;
}
function startSession(req, res, a) {
  const hours = core.state.settings.security.sessionHours;
  const maxAge = Math.round(hours * 3600);
  setCookie(req, res, 'adm', sign([a.id, Date.now() + maxAge * 1000, a.sv].join('|')), { path: '/', maxAge });
}
Object.assign(core, { adminFromReq, startSession });

// ------------------------------------------------------------------ audit + live events
const sseClients = new Set(); // { res, adminId }
function audit(admin, action, detail, ip) {
  core.state.audit.push({ at: Date.now(), admin: admin ? admin.username : 'system', action, detail: detail || '', ip: ip || '' });
  if (core.state.audit.length > 1000) core.state.audit.splice(0, core.state.audit.length - 1000);
  scheduleSave();
}
function notifyCfg() {
  const n = core.state.settings.notifications;
  return {
    ntfyServer: (n.ntfyServer || E.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, ''),
    ntfyTopic: n.ntfyTopic || E.NTFY_TOPIC || '',
    tgToken: n.telegramToken || E.TELEGRAM_BOT_TOKEN || '',
    tgChat: n.telegramChat || E.TELEGRAM_CHAT_ID || '',
  };
}
async function pushExternal(ev) {
  if (ev.quiet || !['scan', 'win', 'suspicious', 'register'].includes(ev.type)) return;
  if (ev.type === 'register' && !ev.push) return;
  const n = notifyCfg();
  const title = ev.type === 'win' ? 'Mr.DooD WINNER' : ev.type === 'suspicious' ? 'Mr.DooD suspicious scan' : 'Mr.DooD scan';
  const tags = ev.type === 'win' ? 'trophy' : ev.type === 'suspicious' ? 'warning' : 'iphone';
  try {
    if (n.ntfyTopic) await fetch(`${n.ntfyServer}/${encodeURIComponent(n.ntfyTopic)}`, { method: 'POST', headers: { Title: title, Tags: tags, Priority: ev.type === 'win' ? '5' : '3' }, body: ev.text });
    if (n.tgToken && n.tgChat) await fetch(`https://api.telegram.org/bot${n.tgToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: n.tgChat, text: ev.text }) });
  } catch (e) { log('error', 'push failed:', e.message); }
}
function emit(ev) {
  ev.at = Date.now();
  ev.id = crypto.randomBytes(4).toString('hex');
  core.state.log.push(ev);
  if (core.state.log.length > 500) core.state.log.splice(0, core.state.log.length - 500);
  scheduleSave();
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of sseClients) { try { c.res.write(data); } catch (e) { sseClients.delete(c); } }
  pushExternal(ev);
}
function closeStreamsFor(adminId) { for (const c of sseClients) if (c.adminId === adminId) { try { c.res.end(); } catch (e) { /* closed */ } sseClients.delete(c); } }
setInterval(() => { for (const c of sseClients) { try { c.res.write(': hb\n\n'); } catch (e) { sseClients.delete(c); } } }, 15000).unref();
Object.assign(core, { audit, emit, sseClients, closeStreamsFor, notifyCfg });

// ------------------------------------------------------------------ rate limit
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const a = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (a.length >= max) { hits.set(key, a); return true; }
  a.push(now); hits.set(key, a);
  return false;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.length || now - a[a.length - 1] > 3600000) hits.delete(k); }, 600000).unref();
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
Object.assign(core, { limited, clientIp });

// ------------------------------------------------------------------ http helpers + router
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function send(res, status, body, headers = {}, req) {
  const h = { ...SEC_HEADERS, ...headers };
  if (req && isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  res.writeHead(status, h); res.end(body);
}
function json(res, status, obj) { send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); }
const fail = (res, status, error, extra) => json(res, status, Object.assign({ ok: false, error }, extra || {}));
function readJson(req, max = 8192) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/i.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { code: 415 }));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error('big'), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(j && typeof j === 'object' ? j : {}); } catch (e) { reject(Object.assign(new Error('json'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
function sendFile(res, file, extra = {}, req) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }, req);
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...extra }, req);
  });
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true; // non-browser or same-origin GET-like
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
const routes = [];
/** route(method, regex, opts, fn). opts: {admin:bool, perm, body:bool, maxBody} */
function route(method, re, opts, fn) { routes.push({ method, re, opts: opts || {}, fn }); }
async function dispatch(req, res, url) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const ctx = { url, params: m.slice(1), ip: clientIp(req), admin: null, body: {} };
    if (req.method !== 'GET' && !sameOrigin(req)) { fail(res, 403, 'bad_origin'); return true; }
    if (r.opts.admin) {
      const a = adminFromReq(req);
      if (!a) { fail(res, 401, 'auth'); return true; }
      if (r.opts.perm && !can(a, r.opts.perm)) {
        audit(a, 'denied', `${req.method} ${url.pathname} (needs ${r.opts.perm})`, ctx.ip);
        fail(res, 403, 'forbidden'); return true;
      }
      ctx.admin = a;
    }
    if (r.opts.body) ctx.body = await readJson(req, r.opts.maxBody);
    await r.fn(req, res, ctx);
    return true;
  }
  return false;
}
Object.assign(core, { send, json, fail, readJson, sendFile, route, dispatch, SEC_HEADERS, MIME });
module.exports = core;
