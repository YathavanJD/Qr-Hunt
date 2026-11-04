'use strict';
/**
 * Server-side registry of EXACTLY seven official QR slots.
 * Slot -> letter/image mapping is fixed in code and can never be edited.
 * Only the secret token (and display metadata) can change.
 */
const crypto = require('crypto');
const QRCode = require('qrcode');
const core = require('./core');
const { LETTERS, TOTAL, cfg } = core;

const newToken = () => crypto.randomBytes(20).toString('base64url'); // 160-bit random

// Tokens printed on the first-generation cards were derived from SECRET. We keep them
// working on first boot so existing printed cards are not wasted; regenerate to replace.
function legacyToken(n) {
  if (!cfg.SECRET) return null;
  return crypto.createHmac('sha256', cfg.SECRET).update('mrdood-letter-' + n).digest('hex').slice(0, 20);
}
function ensureRegistry() {
  const S = core.state;
  if (Array.isArray(S.qr) && S.qr.length === TOTAL) return;
  const now = Date.now();
  S.qr = LETTERS.map((letter, i) => {
    const legacy = legacyToken(i + 1);
    return { slot: i + 1, letter, label: `QR #${i + 1}`, notes: '', token: legacy || newToken(), legacy: !!legacy, version: 1, active: true, revoked: false, createdAt: now, regeneratedAt: null, revokedAt: null };
  });
  S.retired = S.retired || [];
  core.scheduleSave();
}
const slotOf = (n) => core.state.qr.find((q) => q.slot === n) || null;

function findByToken(token) {
  const tb = Buffer.from(String(token));
  let hit = null;
  for (const q of core.state.qr) {
    if (!q.token) continue;
    const qb = Buffer.from(q.token);
    if (qb.length === tb.length && crypto.timingSafeEqual(qb, tb)) hit = q; // no early exit
  }
  return hit;
}
const isRetired = (token) => { const h = core.sha(token).slice(0, 16); return core.state.retired.some((r) => r.h === h); };
function retire(q, reason) {
  if (!q.token) return;
  core.state.retired.push({ h: core.sha(q.token).slice(0, 16), slot: q.slot, at: Date.now(), reason });
  if (core.state.retired.length > 200) core.state.retired.splice(0, core.state.retired.length - 200);
}
function regenerate(n, who) {
  const q = slotOf(n);
  retire(q, 'regenerated');
  q.token = newToken(); q.legacy = false; q.version += 1; q.regeneratedAt = Date.now(); q.revoked = false; q.revokedAt = null; q.active = true;
  core.audit(who, 'qr.regenerate', `slot ${n} (token v${q.version})`);
  core.scheduleSave();
  return q;
}
function revoke(n, who) {
  const q = slotOf(n);
  retire(q, 'revoked');
  q.token = null; q.revoked = true; q.revokedAt = Date.now(); q.active = false;
  core.audit(who, 'qr.revoke', `slot ${n}`);
  core.scheduleSave();
  return q;
}
function setActive(n, active, who) {
  const q = slotOf(n);
  if (!q.token) return null; // revoked slots must be regenerated first
  q.active = !!active;
  core.audit(who, active ? 'qr.activate' : 'qr.deactivate', `slot ${n}`);
  core.scheduleSave();
  return q;
}
function setMeta(n, label, notes, who) {
  const q = slotOf(n);
  q.label = String(label || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || `QR #${n}`;
  q.notes = String(notes || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 200);
  core.audit(who, 'qr.meta', `slot ${n} label/notes edited`);
  core.scheduleSave();
  return q;
}
function resetAll(who, keepMeta) {
  core.state.qr.forEach((q) => {
    retire(q, 'reset');
    q.token = newToken(); q.legacy = false; q.version += 1; q.regeneratedAt = Date.now(); q.revoked = false; q.revokedAt = null; q.active = true;
    if (!keepMeta) { q.label = `QR #${q.slot}`; q.notes = ''; }
  });
  core.audit(who, 'qr.reset', 'all 7 tokens regenerated');
  core.scheduleSave();
}
// public-safe metadata (NEVER includes token)
function meta(q, collectedBy) {
  return { slot: q.slot, letter: q.letter, label: q.label, notes: q.notes, active: q.active, revoked: q.revoked, hasToken: !!q.token, version: q.version, legacy: !!q.legacy, createdAt: q.createdAt, regeneratedAt: q.regeneratedAt, revokedAt: q.revokedAt, collectedBy };
}
function linkFor(q, base) { return q.token ? `${base}/s/${q.token}` : null; }

// ------------------------------------------------------------------ rendering
const QR_OPTS = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#231912', light: '#ffffff' } };
const svgOf = (url) => QRCode.toString(url, { ...QR_OPTS, type: 'svg' });
const pngOf = (url) => QRCode.toBuffer(url, { ...QR_OPTS, scale: 12 });

// Full A4 card as one SVG (same geometry as the printed cards: 2480 x 3508 canvas)
function cardSvg(url, n) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const N = qr.modules.size, data = qr.modules.data;
  const px = Math.floor(1000 / N), size = px * N, x0 = 1240 - Math.floor(size / 2), y0 = 1960;
  let d = '';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (data[r * N + c]) d += `M${x0 + c * px} ${y0 + r * px}h${px}v${px}h-${px}z`;
  return `<svg class="card" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2480 3508"><image href="/admin/api/qr/template.png" width="2480" height="3508"/><path d="${d}" fill="#231912"/><text x="1240" y="3457" text-anchor="middle" font-family="PoppinsEmb, Arial, sans-serif" font-weight="700" font-size="84" letter-spacing="4" fill="#fff">CARD 0${n} / 0${TOTAL}</text></svg>`;
}
function sheetHtml(items) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Mr.DooD QR cards - print sheet</title><link rel="stylesheet" href="/assets/sheet.css"></head><body>
<div class="bar"><b>Print-ready QR cards</b><span>Print on A4, margins: none, scale: 100%. Keep these pages private.</span><button id="print">Print / Save as PDF</button></div>
${items.map((s) => `<div class="page">${s}</div>`).join('\n')}
<script src="/assets/sheet.js"></script></body></html>`;
}

// ------------------------------------------------------------------ minimal ZIP (store, no compression)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipStore(files) {
  const parts = [], central = []; let offset = 0;
  const dt = new Date(); const time = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1);
  const date = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name), data = f.data, crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

module.exports = { ensureRegistry, slotOf, findByToken, isRetired, regenerate, revoke, setActive, setMeta, resetAll, meta, linkFor, svgOf, pngOf, cardSvg, sheetHtml, zipStore, newToken };
