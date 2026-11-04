'use strict';
const crypto = require('crypto');
const path = require('path');
const core = require('./core');
const qr = require('./qr');
const { route, json, fail, send, LETTERS, TOTAL, cfg, emit, audit, can, permsOf } = core;
const S = () => core.state;
const CONFIRM_ERR = (res) => fail(res, 400, 'confirm_required');
const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022';

// ------------------------------------------------------------------ bootstrap first admin
function ensureAdmin() {
  const S0 = core.state;
  if (!S0.admins.length) {
    if (!cfg.ADMIN_PASSWORD) { core.log('error', 'No admin exists. Set ADMIN_PASSWORD to create the first administrator.'); process.exit(1); }
    S0.admins.push(newAdmin(cfg.ADMIN_USERNAME, cfg.ADMIN_PASSWORD, 'super', []));
    core.log('info', `Created first super administrator "${cfg.ADMIN_USERNAME}"`);
    core.scheduleSave();
  } else if (cfg.FORCE_ADMIN_RESET && cfg.ADMIN_PASSWORD) {
    let a = S0.admins.find((x) => x.username === cfg.ADMIN_USERNAME);
    if (!a) { a = newAdmin(cfg.ADMIN_USERNAME, cfg.ADMIN_PASSWORD, 'super', []); S0.admins.push(a); }
    else { a.passHash = core.hashPassword(cfg.ADMIN_PASSWORD); a.sv = crypto.randomBytes(4).toString('hex'); a.disabled = false; a.role = 'super'; }
    core.log('info', `FORCE_ADMIN_RESET applied to "${cfg.ADMIN_USERNAME}" - remove FORCE_ADMIN_RESET afterwards`);
    core.scheduleSave();
  }
}
function newAdmin(username, password, role, extraPerms) {
  return { id: crypto.randomBytes(8).toString('hex'), username: String(username).toLowerCase(), passHash: core.hashPassword(password), role, extraPerms: extraPerms || [], sv: crypto.randomBytes(4).toString('hex'), disabled: false, createdAt: Date.now(), lastLogin: null };
}
const adminPublic = (a) => ({ id: a.id, username: a.username, role: a.role, extraPerms: a.extraPerms || [], disabled: !!a.disabled, createdAt: a.createdAt, lastLogin: a.lastLogin, perms: permsOf(a) });
const DUMMY_HASH = core.hashPassword('dummy-password-for-timing');

// ------------------------------------------------------------------ auth
const fails = new Map();
function failCount(key, windowMs) { const now = Date.now(); const a = (fails.get(key) || []).filter((t) => now - t < windowMs); fails.set(key, a); return a.length; }

route('POST', /^\/admin\/api\/login$/, { body: true }, (req, res, c) => {
  const sec = S().settings.security;
  const win = sec.loginWindowMin * 60000;
  const ipKey = 'ip:' + c.ip, userKey = 'u:' + String(c.body.username || '').toLowerCase().slice(0, 40);
  if (failCount(ipKey, win) >= sec.loginMax || failCount(userKey, win) >= sec.loginMax * 2) return fail(res, 429, 'too_many');
  const uname = String(c.body.username || cfg.ADMIN_USERNAME).toLowerCase().trim();
  const a = S().admins.find((x) => x.username === uname);
  const ok = core.verifyPassword(c.body.password, a ? a.passHash : DUMMY_HASH) && a && !a.disabled;
  if (!ok) {
    fails.get(ipKey).push(Date.now()); (fails.get(userKey) || (fails.set(userKey, []), fails.get(userKey))).push(Date.now());
    audit(a || null, 'login.failed', `username "${uname}"`, c.ip);
    return fail(res, 401, 'bad_credentials');
  }
  a.lastLogin = Date.now(); core.scheduleSave();
  core.startSession(req, res, a);
  audit(a, 'login', 'signed in', c.ip);
  json(res, 200, { ok: true });
});
route('POST', /^\/admin\/api\/logout$/, {}, (req, res, c) => {
  const a = core.adminFromReq(req);
  if (a) audit(a, 'logout', '', c.ip);
  core.setCookie(req, res, 'adm', '', { path: '/', maxAge: 0 });
  json(res, 200, { ok: true });
});
route('GET', /^\/admin\/api\/me$/, { admin: true }, (req, res, c) => {
  json(res, 200, { ok: true, me: adminPublic(c.admin), env: { onRender: cfg.ON_RENDER, persistence: cfg.UPSTASH_URL ? 'upstash' : 'file' } });
});
route('POST', /^\/admin\/api\/me\/password$/, { admin: true, body: true }, (req, res, c) => {
  const { current, password } = c.body;
  if (!core.verifyPassword(current, c.admin.passHash)) return fail(res, 400, 'bad_current');
  if (typeof password !== 'string' || password.length < 10 || password.length > 100) return fail(res, 400, 'weak_password');
  c.admin.passHash = core.hashPassword(password); c.admin.sv = crypto.randomBytes(4).toString('hex');
  core.startSession(req, res, c.admin); core.scheduleSave();
  audit(c.admin, 'password.change', 'own password changed', c.ip);
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ overview
function playerRow(p) {
  const flags = p.scans.filter((s) => s.flag).length;
  const thr = S().settings.game.suspiciousThreshold || 1;
  return {
    id: p.id, name: p.name, createdAt: p.createdAt, count: p.scans.length, slots: p.scans.map((s) => s.n),
    last: p.scans.length ? p.scans[p.scans.length - 1].at : null, flags, suspicious: flags >= thr, dq: !!p.dq,
    won: p.won ? { rank: p.won.rank, at: p.won.at, ms: p.won.ms, code: p.won.code, prize: p.won.prize !== false, verified: !!p.won.verified } : null,
    status: p.dq ? 'dq' : p.won ? 'winner' : p.scans.length >= TOTAL ? 'finished' : p.scans.length ? 'hunting' : 'registered',
  };
}
function timeline(players) {
  const now = Date.now();
  const times = [];
  players.forEach((p) => { times.push(p.createdAt); p.scans.forEach((s) => times.push(s.at)); });
  const span = times.length ? now - Math.min(...times) : 0;
  const bucket = span <= 2 * 3600e3 ? 5 * 60e3 : span <= 12 * 3600e3 ? 30 * 60e3 : 3600e3;
  const end = Math.ceil(now / bucket) * bucket, n = 24;
  const labels = Array.from({ length: n }, (_, i) => end - (n - 1 - i) * bucket);
  const scans = new Array(n).fill(0), regs = new Array(n).fill(0);
  const idx = (t) => Math.floor((t - (end - n * bucket)) / bucket);
  players.forEach((p) => {
    const r = idx(p.createdAt); if (r >= 0 && r < n) regs[r]++;
    p.scans.forEach((s) => { const i = idx(s.at); if (i >= 0 && i < n) scans[i]++; });
  });
  return { bucketMs: bucket, labels, scans, regs };
}
route('GET', /^\/admin\/api\/overview$/, { admin: true, perm: 'stats.view' }, (req, res) => {
  const players = Object.values(S().players);
  const rows = players.map(playerRow);
  const scans = players.reduce((a, p) => a + p.scans.length, 0);
  const flagged = players.reduce((a, p) => a + p.scans.filter((s) => s.flag).length, 0);
  const g = S().settings.game;
  json(res, 200, {
    ok: true,
    stats: {
      players: players.length, scans, completed: rows.filter((r) => r.count >= TOTAL).length, winners: rows.filter((r) => r.won).length,
      active: rows.filter((r) => r.last && Date.now() - r.last < 15 * 60e3 && !r.dq && !r.won).length,
      disqualified: rows.filter((r) => r.dq).length, suspicious: flagged + S().counters.invalid,
      invalid: S().counters.invalid, duplicates: S().counters.dup, flagged,
      completion: players.length ? Math.round((scans / (players.length * TOTAL)) * 100) : 0,
    },
    perSlot: S().qr.map((q) => ({ slot: q.slot, letter: q.letter, label: q.label, active: q.active, revoked: q.revoked, scans: players.filter((p) => p.scans.some((s) => s.n === q.slot)).length })),
    timeline: timeline(players),
    game: { status: g.status, registrationOpen: g.registrationOpen, scanningOpen: g.scanningOpen },
  });
});
route('GET', /^\/admin\/api\/activity$/, { admin: true, perm: 'live.view' }, (req, res) => json(res, 200, { ok: true, log: S().log.slice(-200) }));
route('GET', /^\/admin\/api\/stream$/, { admin: true, perm: 'live.view' }, (req, res, c) => {
  res.writeHead(200, { ...core.SEC_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n: connected\n\n');
  const client = { res, adminId: c.admin.id };
  core.sseClients.add(client);
  req.on('close', () => core.sseClients.delete(client));
});

// ------------------------------------------------------------------ players
route('GET', /^\/admin\/api\/players$/, { admin: true, perm: 'players.view' }, (req, res) => {
  json(res, 200, { ok: true, total: TOTAL, players: Object.values(S().players).map(playerRow).sort((a, b) => (b.last || b.createdAt) - (a.last || a.createdAt)) });
});
route('GET', /^\/admin\/api\/players\/([a-f0-9]{24})$/, { admin: true, perm: 'players.view' }, (req, res, c) => {
  const p = S().players[c.params[0]];
  if (!p) return fail(res, 404, 'none');
  const first = p.scans[0] ? p.scans[0].at : null;
  json(res, 200, { ok: true, player: Object.assign(playerRow(p), { attempts: p.attempts || 0, finishMs: p.won ? p.won.ms : (p.scans.length >= TOTAL && first ? p.scans[p.scans.length - 1].at - first : null), scans: p.scans.map((s) => ({ slot: s.n, letter: LETTERS[s.n - 1], label: (qr.slotOf(s.n) || {}).label, at: s.at, flag: !!s.flag })) }) });
});
route('POST', /^\/admin\/api\/players\/([a-f0-9]{24})\/(disqualify|reinstate|reset|delete)$/, { admin: true, perm: 'players.manage', body: true }, (req, res, c) => {
  const p = S().players[c.params[0]];
  if (!p) return fail(res, 404, 'none');
  const act = c.params[1];
  if (act === 'delete') { delete S().players[p.id]; core.recomputeRanks(); }
  else if (act === 'reset') { p.scans = []; p.won = null; p.attempts = 0; p.lockUntil = 0; core.recomputeRanks(); }
  else p.dq = act === 'disqualify';
  core.scheduleSave();
  audit(c.admin, 'player.' + act, p.name, c.ip);
  emit({ type: 'admin', cat: 'admin', quiet: true, text: `${c.admin.username}: ${act} ${p.name}` });
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ winners
const winnerRows = () => Object.values(S().players).filter((p) => p.won).map(playerRow).sort((a, b) => a.won.rank - b.won.rank);
route('GET', /^\/admin\/api\/winners$/, { admin: true, perm: 'winners.view' }, (req, res) => json(res, 200, { ok: true, winners: winnerRows() }));
route('GET', /^\/admin\/api\/winners\/lookup$/, { admin: true, perm: 'winners.view' }, (req, res, c) => {
  const code = String(c.url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const p = Object.values(S().players).find((x) => x.won && x.won.code === code);
  if (!p) return fail(res, 404, 'not_found');
  json(res, 200, { ok: true, winner: playerRow(p) });
});
route('POST', /^\/admin\/api\/winners\/([a-f0-9]{24})\/verify$/, { admin: true, perm: 'winners.manage', body: true }, (req, res, c) => {
  const p = S().players[c.params[0]];
  if (!p || !p.won) return fail(res, 404, 'none');
  p.won.verified = c.body.value !== false; p.won.verifiedAt = Date.now(); p.won.verifiedBy = c.admin.username;
  core.scheduleSave();
  audit(c.admin, p.won.verified ? 'winner.verify' : 'winner.unverify', `${p.name} (#${p.won.rank})`, c.ip);
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ game controls
const gameView = () => Object.assign({}, S().settings.game, { startedAt: S().startedAt });
route('GET', /^\/admin\/api\/game$/, { admin: true, perm: 'game.control' }, (req, res) => json(res, 200, { ok: true, game: gameView() }));
route('POST', /^\/admin\/api\/game\/status$/, { admin: true, perm: 'game.control', body: true }, (req, res, c) => {
  const st = c.body.status;
  if (!['live', 'paused', 'not_started'].includes(st)) return fail(res, 400, 'bad_status');
  S().settings.game.status = st;
  if (st === 'live' && !S().startedAt) S().startedAt = Date.now();
  core.scheduleSave();
  audit(c.admin, 'game.status', st, c.ip);
  emit({ type: 'game', cat: 'game', quiet: true, text: st === 'live' ? 'Game is LIVE' : st === 'paused' ? 'Game PAUSED - scans are blocked' : 'Game set to NOT STARTED' });
  json(res, 200, { ok: true, game: gameView() });
});
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
route('PUT', /^\/admin\/api\/game\/config$/, { admin: true, perm: 'game.control', body: true }, (req, res, c) => {
  const g = S().settings.game, b = c.body;
  if ('registrationOpen' in b) g.registrationOpen = !!b.registrationOpen;
  if ('scanningOpen' in b) g.scanningOpen = !!b.scanningOpen;
  if ('dupPolicy' in b && ['notify', 'ignore'].includes(b.dupPolicy)) g.dupPolicy = b.dupPolicy;
  if ('minScanGapSec' in b) g.minScanGapSec = num(b.minScanGapSec, 0, 600, g.minScanGapSec);
  if ('blockFastScans' in b) g.blockFastScans = !!b.blockFastScans;
  if ('suspiciousThreshold' in b) g.suspiciousThreshold = num(b.suspiciousThreshold, 1, 20, g.suspiciousThreshold);
  if ('prizeLimit' in b) { g.prizeLimit = num(b.prizeLimit, 0, 1000, g.prizeLimit); core.recomputeRanks(); }
  core.scheduleSave();
  audit(c.admin, 'game.config', JSON.stringify(b).slice(0, 200), c.ip);
  json(res, 200, { ok: true, game: gameView() });
});
route('POST', /^\/admin\/api\/game\/reset$/, { admin: true, perm: 'data.manage', body: true }, (req, res, c) => {
  if (c.body.confirm !== 'RESET') return CONFIRM_ERR(res);
  S().players = {}; S().log = []; S().counters = { invalid: 0, revoked: 0, dup: 0 }; S().resetAt = Date.now(); S().startedAt = null;
  core.scheduleSave();
  audit(c.admin, 'game.reset', 'all players, scans and winners cleared', c.ip);
  emit({ type: 'admin', cat: 'admin', quiet: true, text: `${c.admin.username} RESET the game` });
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ QR management (separate permissions, secrets never leave this section)
const baseUrl = (req) => cfg.BASE_URL || `${(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()}://${req.headers.host}`;
const slotParam = (c) => qr.slotOf(Number(c.params[0]));
route('GET', /^\/admin\/api\/qr$/, { admin: true, perm: 'qr.view' }, (req, res) => {
  const players = Object.values(S().players);
  json(res, 200, { ok: true, slots: S().qr.map((q) => qr.meta(q, players.filter((p) => p.scans.some((s) => s.n === q.slot)).length)), retired: S().retired.length });
});
route('GET', /^\/admin\/api\/qr\/template\.png$/, { admin: true, perm: 'qr.download' }, (req, res) => core.sendFile(res, path.join(cfg.ROOT, 'private', 'card_template.png'), { 'Cache-Control': 'private, no-store' }, req));
route('GET', /^\/admin\/api\/qr\/font\.ttf$/, { admin: true, perm: 'qr.download' }, (req, res) => core.sendFile(res, path.join(cfg.ROOT, 'private', 'fonts', 'Poppins-Bold.ttf'), { 'Cache-Control': 'private, max-age=3600' }, req));
route('GET', /^\/admin\/api\/qr\/zip$/, { admin: true, perm: 'qr.download' }, async (req, res, c) => {
  const files = [];
  for (const q of S().qr) if (q.token && q.active) files.push({ name: `MrDooD_QR_${q.slot}.png`, data: await qr.pngOf(qr.linkFor(q, baseUrl(req))) });
  if (!files.length) return fail(res, 409, 'no_active_qr');
  audit(c.admin, 'qr.download', `ZIP with ${files.length} QR codes`, c.ip);
  send(res, 200, qr.zipStore(files), { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="MrDooD_QR_codes.zip"', 'Cache-Control': 'no-store' });
});
route('GET', /^\/admin\/api\/qr\/sheet$/, { admin: true, perm: 'qr.download' }, (req, res, c) => {
  const only = Number(c.url.searchParams.get('slot')) || 0;
  const items = S().qr.filter((q) => q.token && (!only || q.slot === only)).map((q) => qr.cardSvg(qr.linkFor(q, baseUrl(req)), q.slot));
  if (!items.length) return fail(res, 409, 'no_qr');
  audit(c.admin, 'qr.sheet', only ? `slot ${only}` : 'all cards', c.ip);
  send(res, 200, qr.sheetHtml(items), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
});
route('GET', /^\/admin\/api\/qr\/([1-7])\/link$/, { admin: true, perm: 'qr.view' }, (req, res, c) => {
  const q = slotParam(c);
  if (!q.token) return fail(res, 409, 'revoked');
  audit(c.admin, 'qr.reveal-link', `slot ${q.slot}`, c.ip);
  json(res, 200, { ok: true, url: qr.linkFor(q, baseUrl(req)) });
});
route('GET', /^\/admin\/api\/qr\/([1-7])\/image\.(svg|png)$/, { admin: true, perm: 'qr.view' }, async (req, res, c) => {
  const q = slotParam(c);
  if (!q.token) return fail(res, 409, 'revoked');
  const dl = c.url.searchParams.get('download') === '1';
  if (dl && !can(c.admin, 'qr.download')) { audit(c.admin, 'denied', `qr download slot ${q.slot}`, c.ip); return fail(res, 403, 'forbidden'); }
  const url = qr.linkFor(q, baseUrl(req));
  const png = c.params[1] === 'png';
  if (dl) audit(c.admin, 'qr.download', `slot ${q.slot} ${c.params[1]}`, c.ip); else audit(c.admin, 'qr.preview', `slot ${q.slot}`, c.ip);
  const headers = { 'Content-Type': png ? 'image/png' : 'image/svg+xml', 'Cache-Control': 'no-store' };
  if (dl) headers['Content-Disposition'] = `attachment; filename="MrDooD_QR_${q.slot}.${c.params[1]}"`;
  send(res, 200, png ? await qr.pngOf(url) : await qr.svgOf(url), headers);
});
const qrAction = (name, fn) => route('POST', new RegExp(`^\\/admin\\/api\\/qr\\/([1-7])\\/${name}$`), { admin: true, perm: 'qr.manage', body: true }, (req, res, c) => {
  const q = slotParam(c);
  const r = fn(q, c);
  if (r === null) return fail(res, 409, 'revoked_regenerate_first');
  emit({ type: 'admin', cat: 'admin', quiet: true, text: `${c.admin.username}: QR #${q.slot} ${name}` });
  json(res, 200, { ok: true, slot: qr.meta(q, 0) });
});
qrAction('regenerate', (q, c) => qr.regenerate(q.slot, c.admin));
qrAction('revoke', (q, c) => qr.revoke(q.slot, c.admin));
qrAction('activate', (q, c) => qr.setActive(q.slot, true, c.admin));
qrAction('deactivate', (q, c) => qr.setActive(q.slot, false, c.admin));
qrAction('meta', (q, c) => qr.setMeta(q.slot, c.body.label, c.body.notes, c.admin));
route('POST', /^\/admin\/api\/qr\/generate-all$/, { admin: true, perm: 'qr.manage', body: true }, (req, res, c) => {
  if (c.body.confirm !== 'REGENERATE') return CONFIRM_ERR(res);
  qr.resetAll(c.admin, true);
  json(res, 200, { ok: true });
});
route('POST', /^\/admin\/api\/qr\/reset$/, { admin: true, perm: 'qr.reset', body: true }, (req, res, c) => {
  if (c.body.confirm !== 'RESET QR') return CONFIRM_ERR(res);
  qr.resetAll(c.admin, false);
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ settings
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
route('GET', /^\/admin\/api\/settings$/, { admin: true, perm: 'settings.view' }, (req, res) => {
  const s = S().settings, n = core.notifyCfg();
  json(res, 200, {
    ok: true, general: s.general, game: gameView(), security: s.security,
    notifications: { ntfyServer: s.notifications.ntfyServer, ntfyTopic: s.notifications.ntfyTopic, telegramToken: s.notifications.telegramToken ? MASK : '', telegramChat: s.notifications.telegramChat, effective: { ntfy: !!n.ntfyTopic, telegram: !!(n.tgToken && n.tgChat) } },
    totalQr: TOTAL, persistence: cfg.UPSTASH_URL ? 'upstash' : 'file', onRender: cfg.ON_RENDER,
  });
});
route('PUT', /^\/admin\/api\/settings\/general$/, { admin: true, perm: 'settings.edit', body: true }, (req, res, c) => {
  const g = S().settings.general, b = c.body;
  const title = str(b.title, 60), brand = str(b.brand, 40), ans = str(b.secretAnswer, 40);
  if (!title || !brand) return fail(res, 400, 'required');
  if (!ans.replace(/[^A-Za-z0-9]/g, '')) return fail(res, 400, 'bad_answer');
  Object.assign(g, { title, brand, eventInfo: str(b.eventInfo, 200), description: str(b.description, 300), secretAnswer: ans });
  core.scheduleSave(); audit(c.admin, 'settings.general', 'updated' + (ans !== undefined ? ' (secret answer may have changed)' : ''), c.ip);
  json(res, 200, { ok: true });
});
route('PUT', /^\/admin\/api\/settings\/notifications$/, { admin: true, perm: 'settings.edit', body: true }, (req, res, c) => {
  const n = S().settings.notifications, b = c.body;
  const server = str(b.ntfyServer, 100) || 'https://ntfy.sh';
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(server.replace(/\/+$/, ''))) return fail(res, 400, 'bad_server');
  n.ntfyServer = server.replace(/\/+$/, ''); n.ntfyTopic = str(b.ntfyTopic, 80).replace(/[^A-Za-z0-9_-]/g, '');
  n.telegramChat = str(b.telegramChat, 40);
  if (typeof b.telegramToken === 'string' && b.telegramToken !== MASK) n.telegramToken = str(b.telegramToken, 120);
  core.scheduleSave(); audit(c.admin, 'settings.notifications', 'updated', c.ip);
  json(res, 200, { ok: true });
});
route('POST', /^\/admin\/api\/notifications\/test$/, { admin: true, perm: 'settings.edit', body: true }, async (req, res, c) => {
  const n = core.notifyCfg(); const results = {};
  const text = `Test notification from ${S().settings.general.brand} admin (${c.admin.username})`;
  try { if (n.ntfyTopic) { const r = await fetch(`${n.ntfyServer}/${encodeURIComponent(n.ntfyTopic)}`, { method: 'POST', headers: { Title: 'Mr.DooD test' }, body: text }); results.ntfy = r.ok ? 'sent' : 'error ' + r.status; } else results.ntfy = 'not configured'; } catch (e) { results.ntfy = 'failed'; }
  try { if (n.tgToken && n.tgChat) { const r = await fetch(`https://api.telegram.org/bot${n.tgToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: n.tgChat, text }) }); results.telegram = r.ok ? 'sent' : 'error ' + r.status; } else results.telegram = 'not configured'; } catch (e) { results.telegram = 'failed'; }
  json(res, 200, { ok: true, results });
});
route('PUT', /^\/admin\/api\/settings\/security$/, { admin: true, perm: 'security.manage', body: true }, (req, res, c) => {
  const s = S().settings.security, b = c.body;
  s.sessionHours = num(b.sessionHours, 1, 72, s.sessionHours); s.loginMax = num(b.loginMax, 3, 30, s.loginMax); s.loginWindowMin = num(b.loginWindowMin, 1, 120, s.loginWindowMin);
  core.scheduleSave(); audit(c.admin, 'settings.security', JSON.stringify(s), c.ip);
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ administrators
route('GET', /^\/admin\/api\/admins$/, { admin: true, perm: 'admins.manage' }, (req, res) => json(res, 200, { ok: true, admins: S().admins.map(adminPublic), grantable: core.GRANTABLE, roles: Object.keys(core.ROLE_PERMS) }));
const cleanPerms = (p) => (Array.isArray(p) ? p.filter((x) => core.GRANTABLE.includes(x)) : []);
route('POST', /^\/admin\/api\/admins$/, { admin: true, perm: 'admins.manage', body: true }, (req, res, c) => {
  const username = str(c.body.username, 30).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return fail(res, 400, 'bad_username');
  if (S().admins.some((a) => a.username === username)) return fail(res, 409, 'exists');
  if (typeof c.body.password !== 'string' || c.body.password.length < 10) return fail(res, 400, 'weak_password');
  if (!core.ROLE_PERMS[c.body.role]) return fail(res, 400, 'bad_role');
  const a = newAdmin(username, c.body.password, c.body.role, cleanPerms(c.body.extraPerms));
  S().admins.push(a); core.scheduleSave();
  audit(c.admin, 'admin.create', `${username} as ${a.role}`, c.ip);
  json(res, 200, { ok: true, admin: adminPublic(a) });
});
const supersLeft = (except) => S().admins.filter((a) => a.role === 'super' && !a.disabled && a.id !== except).length;
route('PUT', /^\/admin\/api\/admins\/([a-f0-9]{16})$/, { admin: true, perm: 'admins.manage', body: true }, (req, res, c) => {
  const a = S().admins.find((x) => x.id === c.params[0]);
  if (!a) return fail(res, 404, 'none');
  const b = c.body;
  const losingSuper = (a.role === 'super') && ((b.role && b.role !== 'super') || b.disabled === true);
  if (losingSuper && !supersLeft(a.id)) return fail(res, 409, 'last_super');
  if (a.id === c.admin.id && b.disabled === true) return fail(res, 409, 'self');
  if (b.role && core.ROLE_PERMS[b.role]) a.role = b.role;
  if ('extraPerms' in b) a.extraPerms = cleanPerms(b.extraPerms);
  if ('disabled' in b) a.disabled = !!b.disabled;
  a.sv = crypto.randomBytes(4).toString('hex'); // permission changes take effect immediately: old sessions die
  core.closeStreamsFor(a.id);
  if (a.id === c.admin.id) core.startSession(req, res, a);
  core.scheduleSave(); audit(c.admin, 'admin.update', `${a.username}: ${a.role}${a.disabled ? ' (disabled)' : ''}`, c.ip);
  json(res, 200, { ok: true, admin: adminPublic(a) });
});
route('POST', /^\/admin\/api\/admins\/([a-f0-9]{16})\/password$/, { admin: true, perm: 'admins.manage', body: true }, (req, res, c) => {
  const a = S().admins.find((x) => x.id === c.params[0]);
  if (!a) return fail(res, 404, 'none');
  if (typeof c.body.password !== 'string' || c.body.password.length < 10) return fail(res, 400, 'weak_password');
  a.passHash = core.hashPassword(c.body.password); a.sv = crypto.randomBytes(4).toString('hex'); core.closeStreamsFor(a.id);
  if (a.id === c.admin.id) core.startSession(req, res, a);
  core.scheduleSave(); audit(c.admin, 'admin.password-reset', a.username, c.ip);
  json(res, 200, { ok: true });
});
route('POST', /^\/admin\/api\/admins\/([a-f0-9]{16})\/delete$/, { admin: true, perm: 'admins.manage', body: true }, (req, res, c) => {
  const a = S().admins.find((x) => x.id === c.params[0]);
  if (!a) return fail(res, 404, 'none');
  if (a.id === c.admin.id) return fail(res, 409, 'self');
  if (a.role === 'super' && !supersLeft(a.id)) return fail(res, 409, 'last_super');
  S().admins = S().admins.filter((x) => x.id !== a.id); core.closeStreamsFor(a.id);
  core.scheduleSave(); audit(c.admin, 'admin.delete', a.username, c.ip);
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ data management + audit
route('GET', /^\/admin\/api\/audit$/, { admin: true, perm: 'audit.view' }, (req, res) => json(res, 200, { ok: true, audit: S().audit.slice(-300).reverse() }));
route('GET', /^\/admin\/api\/data\/backup$/, { admin: true, perm: 'data.manage' }, (req, res, c) => {
  const s = S();
  const out = { kind: 'mrdood-backup', version: 2, at: Date.now(), settings: { general: s.settings.general, game: s.settings.game }, players: s.players, log: s.log, counters: s.counters, startedAt: s.startedAt };
  audit(c.admin, 'data.backup', 'downloaded (no QR tokens, no admin accounts)', c.ip);
  send(res, 200, JSON.stringify(out), { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="mrdood-backup-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' });
});
route('POST', /^\/admin\/api\/data\/restore$/, { admin: true, perm: 'data.manage', body: true, maxBody: 8 * 1024 * 1024 }, (req, res, c) => {
  const b = c.body.backup;
  if (c.body.confirm !== 'RESTORE') return CONFIRM_ERR(res);
  if (!b || b.kind !== 'mrdood-backup' || typeof b.players !== 'object' || Array.isArray(b.players)) return fail(res, 400, 'bad_backup');
  const players = {};
  for (const [id, p] of Object.entries(b.players)) {
    if (!/^[a-f0-9]{24}$/.test(id) || !p || typeof p.name !== 'string' || !Array.isArray(p.scans)) return fail(res, 400, 'bad_backup');
    const scans = p.scans.filter((s) => s && Number.isInteger(s.n) && s.n >= 1 && s.n <= TOTAL && Number.isFinite(s.at)).map((s) => ({ n: s.n, at: s.at, flag: !!s.flag }));
    players[id] = { id, name: str(p.name, 24), createdAt: Number(p.createdAt) || Date.now(), scans, won: p.won && typeof p.won === 'object' ? { rank: Number(p.won.rank) || 0, at: Number(p.won.at) || 0, ms: Number(p.won.ms) || 0, code: str(p.won.code, 8), prize: p.won.prize !== false, verified: !!p.won.verified } : null, dq: !!p.dq, attempts: Number(p.attempts) || 0 };
  }
  const merged = core.migrate({ settings: Object.assign({}, S().settings, { general: Object.assign({}, S().settings.general, (b.settings || {}).general), game: Object.assign({}, S().settings.game, (b.settings || {}).game) }) });
  S().players = players; S().settings.general = merged.settings.general; S().settings.game = merged.settings.game;
  S().log = Array.isArray(b.log) ? b.log.slice(-500) : []; S().counters = Object.assign({ invalid: 0, revoked: 0, dup: 0 }, b.counters || {}); S().startedAt = b.startedAt || null;
  core.recomputeRanks(); core.scheduleSave();
  audit(c.admin, 'data.restore', `${Object.keys(players).length} players restored`, c.ip);
  json(res, 200, { ok: true, players: Object.keys(players).length });
});
const csvCell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
route('GET', /^\/admin\/api\/data\/players\.csv$/, { admin: true, perm: 'players.view' }, (req, res, c) => {
  const rows = [['Name', 'Status', 'Letters collected', 'Registered', 'First scan', 'Last scan', 'Winner place', 'Claim code', 'Verified', 'Fast scans']];
  for (const p of Object.values(S().players)) {
    const r = playerRow(p);
    rows.push([p.name, r.status, r.count, new Date(p.createdAt).toISOString(), p.scans[0] ? new Date(p.scans[0].at).toISOString() : '', r.last ? new Date(r.last).toISOString() : '', p.won ? p.won.rank : '', p.won ? p.won.code : '', p.won && p.won.verified ? 'yes' : '', r.flags]);
  }
  audit(c.admin, 'data.export', 'players CSV', c.ip);
  send(res, 200, rows.map((r) => r.map(csvCell).join(',')).join('\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mrdood-players.csv"', 'Cache-Control': 'no-store' });
});
route('POST', /^\/admin\/api\/data\/clear-log$/, { admin: true, perm: 'data.manage', body: true }, (req, res, c) => {
  S().log = []; core.scheduleSave(); audit(c.admin, 'data.clear-log', 'activity feed cleared', c.ip);
  json(res, 200, { ok: true });
});

module.exports = { ensureAdmin };
