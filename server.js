'use strict';
/**
 * Mr.DooD QR Scan Hunt - server entry point.
 * Required env: SECRET (16+ chars, signs cookies), ADMIN_PASSWORD (creates the first super admin on first start).
 * See README_SETUP.txt for every option.
 */
const http = require('http');
const path = require('path');
const core = require('./lib/core');

if (core.cfg.SECRET.length < 16) {
  console.error('\nMissing SECRET: set an environment variable SECRET with at least 16 random characters.\n');
  process.exit(1);
}
const qr = require('./lib/qr');
require('./lib/player');
const { ensureAdmin } = require('./lib/admin');

const NOT_FOUND = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Mr.DooD</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0a07;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="font-size:40px;margin:0 0 8px;color:#ff6a00">Mr.DooD</h1><p style="font-size:18px;opacity:.85">This QR code or link is not part of the official hunt.</p><p><a href="/" style="color:#ff9e28;font-weight:700">Open the game</a></p></div></body>`;
const PUB = path.join(core.cfg.ROOT, 'public');

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname, m = req.method;
  if (p === '/healthz') return core.send(res, 200, 'ok', { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  if (p === '/robots.txt') return core.send(res, 200, 'User-agent: *\nDisallow: /\n', { 'Content-Type': 'text/plain' });
  if (p === '/favicon.ico') return core.send(res, 204, '');
  if (m === 'GET' && (p === '/' || /^\/s\/[A-Za-z0-9_-]{1,64}\/?$/.test(p))) return core.sendFile(res, path.join(PUB, 'index.html'), { 'Cache-Control': 'no-store' }, req);
  if (m === 'GET' && (p === '/admin' || p === '/admin/')) return core.sendFile(res, path.join(PUB, 'admin.html'), { 'Cache-Control': 'no-store' }, req);
  if (m === 'GET' && /^\/assets\/[a-z0-9._-]+$/i.test(p)) return core.sendFile(res, path.join(PUB, 'assets', path.basename(p)), { 'Cache-Control': 'no-cache' }, req);
  if (await core.dispatch(req, res, url)) return;
  core.send(res, 404, NOT_FOUND, { 'Content-Type': 'text/html; charset=utf-8' }, req);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const code = e && Number.isInteger(e.code) ? e.code : 500;
    if (code === 500) core.log('error', req.method, req.url, e && e.stack ? e.stack.split('\n')[0] : e);
    if (res.headersSent) return res.end();
    core.json(res, code, { ok: false, error: code === 500 ? 'server' : code === 413 ? 'too_large' : code === 415 ? 'bad_type' : 'bad_request' });
  });
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

core.load().then(() => {
  qr.ensureRegistry();
  ensureAdmin();
  core.recomputeRanks();
  core.scheduleSave();
  server.listen(core.cfg.PORT, () => core.log('info', `Mr.DooD hunt v2 listening on :${core.cfg.PORT} (storage: ${core.cfg.UPSTASH_URL ? 'upstash' : 'file'}${core.cfg.ON_RENDER && !core.cfg.UPSTASH_URL ? ' - WARNING: Render disk is ephemeral' : ''})`));
});
async function shutdown() { try { await core.flush(); } finally { process.exit(0); } }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => core.log('error', 'unhandledRejection', e && e.message));
