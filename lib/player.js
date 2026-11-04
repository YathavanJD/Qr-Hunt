'use strict';
const crypto = require('crypto');
const path = require('path');
const core = require('./core');
const qr = require('./qr');
const { route, json, fail, LETTERS, TOTAL, limited, emit } = core;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function claimCode() {
  const b = crypto.randomBytes(6); let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}
function cleanName(n) {
  return String(n || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u;
const getPlayer = (req) => { const id = core.unsign(core.parseCookies(req).pid); return (id && core.state.players[id]) || null; };
const S = () => core.state;
const status = () => S().settings.game.status;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function recomputeRanks() {
  const w = Object.values(S().players).filter((p) => p.won).sort((a, b) => a.won.at - b.won.at);
  const lim = S().settings.game.prizeLimit;
  w.forEach((p, i) => { p.won.rank = i + 1; p.won.prize = !lim || i + 1 <= lim; });
}
function slotsFor(p) {
  const by = new Map(p.scans.map((s) => [s.n, s]));
  return Array.from({ length: TOTAL }, (_, i) => {
    const s = by.get(i + 1);
    return s ? { slot: i + 1, collected: true, letter: LETTERS[i], at: s.at } : { slot: i + 1, collected: false };
  });
}
core.recomputeRanks = recomputeRanks;
core.getPlayer = getPlayer;

route('GET', /^\/api\/config$/, {}, (req, res) => {
  const s = S().settings;
  json(res, 200, { ok: true, title: s.general.title, brand: s.general.brand, eventInfo: s.general.eventInfo, description: s.general.description, status: s.game.status, registrationOpen: s.game.registrationOpen, scanningOpen: s.game.scanningOpen, total: TOTAL });
});

route('POST', /^\/api\/register$/, { body: true }, (req, res, c) => {
  if (limited('reg:' + c.ip, 80, 600000)) return fail(res, 429, 'slow_down');
  const existing = getPlayer(req);
  if (existing) return json(res, 200, { ok: true, name: existing.name });
  if (!S().settings.game.registrationOpen) return fail(res, 403, 'registration_closed');
  const name = cleanName(c.body.name);
  if (name.length < 2) return fail(res, 400, 'name_short');
  if (!NAME_RE.test(name)) return fail(res, 400, 'name_invalid');
  const lower = name.toLowerCase();
  if (Object.values(S().players).some((q) => q.name.toLowerCase() === lower)) return fail(res, 409, 'name_taken');
  const id = crypto.randomBytes(12).toString('hex');
  S().players[id] = { id, name, createdAt: Date.now(), scans: [], won: null, dq: false, attempts: 0 };
  core.setCookie(req, res, 'pid', core.sign(id));
  core.scheduleSave();
  emit({ type: 'register', cat: 'register', name, text: `${name} joined the hunt` });
  json(res, 200, { ok: true, name });
});

route('GET', /^\/api\/me$/, {}, (req, res) => {
  const p = getPlayer(req);
  if (!p) return fail(res, 401, 'register');
  const g = S().settings.game;
  json(res, 200, {
    ok: true, name: p.name, slots: slotsFor(p), count: p.scans.length, total: TOTAL, dq: !!p.dq,
    status: g.status, scanningOpen: g.scanningOpen,
    won: p.won ? { rank: p.won.rank, code: p.won.code, ms: p.won.ms, at: p.won.at, prize: p.won.prize !== false } : null,
    startedAt: p.scans.length ? p.scans[0].at : null,
  });
});

route('GET', /^\/api\/leaderboard$/, {}, (req, res) => {
  const all = Object.values(S().players).filter((q) => !q.dq);
  const winners = all.filter((q) => q.won).sort((a, b) => a.won.rank - b.won.rank).slice(0, 10).map((q) => ({ rank: q.won.rank, name: q.name, ms: q.won.ms }));
  const hunters = all.filter((q) => !q.won && q.scans.length).sort((a, b) => b.scans.length - a.scans.length || a.scans[a.scans.length - 1].at - b.scans[b.scans.length - 1].at).slice(0, 10).map((q) => ({ name: q.name, count: q.scans.length }));
  json(res, 200, { ok: true, winners, hunters, players: all.length });
});

route('POST', /^\/api\/scan$/, { body: true }, (req, res, c) => {
  const ip = c.ip;
  if (limited('scan:' + ip, 300, 60000)) return fail(res, 429, 'slow_down');
  const p = getPlayer(req);
  const token = String(c.body.token || '');
  const slot = /^[A-Za-z0-9_-]{8,64}$/.test(token) ? qr.findByToken(token) : null;
  const who = p ? p.name : 'An unregistered visitor';

  if (!slot) { // unknown / forged / old / revoked
    if (limited('bad:' + ip, 30, 600000)) return fail(res, 429, 'slow_down');
    const retired = /^[A-Za-z0-9_-]{8,64}$/.test(token) && qr.isRetired(token);
    S().counters.invalid++; if (retired) S().counters.revoked++;
    core.scheduleSave();
    emit({ type: 'invalid', cat: 'invalid', name: p && p.name, reason: retired ? 'revoked' : 'unknown', text: retired ? `${who} scanned an OLD or REVOKED QR code` : `${who} scanned an unrecognised QR code` });
    return fail(res, 404, retired ? 'revoked' : 'invalid');
  }
  if (!p) return fail(res, 401, 'register');
  if (p.dq) return fail(res, 403, 'dq');
  const g = S().settings.game;
  if (g.status === 'not_started') return fail(res, 403, 'not_started');
  if (g.status === 'paused') return fail(res, 403, 'paused');
  if (!g.scanningOpen) return fail(res, 403, 'scanning_closed');
  if (!slot.active) {
    S().counters.invalid++; core.scheduleSave();
    emit({ type: 'invalid', cat: 'invalid', name: p.name, reason: 'inactive', text: `${p.name} scanned QR #${slot.slot}, which is currently DEACTIVATED` });
    return fail(res, 403, 'inactive');
  }
  const n = slot.slot;
  const letter = LETTERS[n - 1];
  if (p.scans.some((s) => s.n === n)) {
    S().counters.dup++; core.scheduleSave();
    if (g.dupPolicy === 'notify') emit({ type: 'dup', cat: 'dup', name: p.name, n, text: `${p.name} re-scanned QR #${n} (already collected)`, quiet: true });
    return json(res, 200, { ok: true, duplicate: true, n, letter, count: p.scans.length, total: TOTAL, won: !!p.won });
  }
  const now = Date.now();
  const prev = p.scans.length ? p.scans[p.scans.length - 1].at : null;
  const gap = prev === null ? null : now - prev;
  const fast = gap !== null && gap < g.minScanGapSec * 1000;
  if (fast && g.blockFastScans) {
    emit({ type: 'suspicious', cat: 'suspicious', name: p.name, n, text: `${p.name} was BLOCKED: scanned only ${Math.round(gap / 1000)}s after the previous scan` });
    return fail(res, 429, 'too_fast', { wait: Math.ceil((g.minScanGapSec * 1000 - gap) / 1000) });
  }
  p.scans.push({ n, at: now, flag: fast });
  core.scheduleSave();
  const count = p.scans.length;
  emit({ type: 'scan', cat: 'scan', name: p.name, n, letter, count, flagged: fast, text: `${p.name} scanned QR #${n} (letter "${letter}") - ${count}/${TOTAL} collected` });
  if (fast) emit({ type: 'suspicious', cat: 'suspicious', name: p.name, n, text: `Suspicious: ${p.name} scanned QR #${n} only ${Math.round(gap / 1000)}s after the previous scan` });
  json(res, 200, { ok: true, duplicate: false, n, letter, count, total: TOTAL, won: !!p.won });
});

route('GET', /^\/api\/letter\/([1-7])\.jpg$/, { raw: true }, (req, res, c) => {
  const p = getPlayer(req);
  const n = Number(c.params[0]);
  if (!p || p.dq || !p.scans.some((s) => s.n === n)) return core.send(res, 403, 'Scan the QR first', { 'Content-Type': 'text/plain' });
  core.sendFile(res, path.join(core.cfg.ROOT, 'private', 'img', n + '.jpg'), { 'Cache-Control': 'private, max-age=3600' }, req);
});

route('POST', /^\/api\/submit$/, { body: true }, (req, res, c) => {
  const p = getPlayer(req);
  if (!p) return fail(res, 401, 'register');
  if (p.dq) return fail(res, 403, 'dq');
  if (p.won) return json(res, 200, { ok: true, rank: p.won.rank, code: p.won.code });
  const g = S().settings.game;
  if (g.status !== 'live') return fail(res, 403, g.status);
  if (p.scans.length < TOTAL) return fail(res, 400, 'not_enough');
  if (p.lockUntil && p.lockUntil > Date.now()) return fail(res, 429, 'locked', { wait: Math.ceil((p.lockUntil - Date.now()) / 1000) });
  if (limited('sub:' + p.id, 8, 60000)) return fail(res, 429, 'slow_down');
  if (norm(c.body.answer) !== norm(S().settings.general.secretAnswer)) {
    p.attempts = (p.attempts || 0) + 1;
    if (p.attempts % 25 === 0) p.lockUntil = Date.now() + 10 * 60000;
    core.scheduleSave();
    return json(res, 200, { ok: false, error: 'wrong', attempts: p.attempts });
  }
  // synchronous section: ranks are assigned in finishing order, no await between read and write
  const at = Date.now();
  const rank = Object.values(S().players).filter((q) => q.won).length + 1;
  const lim = g.prizeLimit;
  p.won = { rank, at, ms: at - p.scans[0].at, code: claimCode(), prize: !lim || rank <= lim, verified: false };
  core.scheduleSave();
  emit({ type: 'win', cat: 'win', name: p.name, rank, code: p.won.code, text: `WINNER #${rank}: ${p.name} finished the hunt! Claim code ${p.won.code}` });
  json(res, 200, { ok: true, rank, code: p.won.code });
});
