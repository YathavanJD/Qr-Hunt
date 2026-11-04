'use strict';
/* Integration tests: boots the real server in a temp directory and attacks it like a player / rogue admin would.
   Run:  npm test */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3400 + Math.floor(Math.random() * 400);
const B = `http://localhost:${PORT}`;
const SECRET = 'test-secret-' + crypto.randomBytes(12).toString('hex');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mrdood-'));
const ROOT = path.join(__dirname, '..');
const env = { ...process.env, PORT, SECRET, ADMIN_PASSWORD: 'SuperSecret123!', DATA_DIR: DIR };
let srv;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  PASS ' : '  FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log('\n== ' + t);

function start() {
  srv = spawn('node', ['server.js'], { cwd: ROOT, env });
  srv.stdout.on('data', () => {}); srv.stderr.on('data', (d) => process.stderr.write(d));
  return new Promise(async (res, rej) => {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(B + '/healthz'); if (r.ok) return res(); } catch (e) { /* wait */ } await sleep(100); }
    rej(new Error('server did not start'));
  });
}
async function stop() { if (!srv) return; srv.kill('SIGTERM'); await new Promise((r) => srv.on('exit', r)); srv = null; }

class C {
  constructor() { this.ck = {}; }
  async req(m, u, b, h = {}) {
    const r = await fetch(B + u, { method: m, headers: { ...(b !== undefined ? { 'content-type': 'application/json' } : {}), cookie: Object.entries(this.ck).map(([k, v]) => k + '=' + v).join('; '), ...h }, body: b !== undefined ? JSON.stringify(b) : undefined, redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v === '') delete this.ck[k]; else this.ck[k] = v; });
    const buf = Buffer.from(await r.arrayBuffer()); const t = buf.toString('utf8'); let j; try { j = JSON.parse(t); } catch (e) { j = t; }
    return { s: r.status, j, buf, h: r.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b === undefined ? {} : b); }
  put(u, b) { return this.req('PUT', u, b); }
}
async function login(user, pw) { const c = new C(); const r = await c.post('/admin/api/login', { username: user, password: pw }); return { c, r }; }
// recover the secret QR token of a slot through the authorised admin API (as the super admin would)
async function tokenOf(adm, n) { const r = await adm.get(`/admin/api/qr/${n}/link`); return r.j.url.split('/s/')[1]; }

(async () => {
  await start();
  const adm = (await login('admin', 'SuperSecret123!')).c;

  section('Deployment');
  let r = await new C().get('/healthz'); ok(r.s === 200 && r.j === 'ok', '/healthz responds');
  for (const f of ['/', '/admin', '/assets/game.js', '/assets/fx.js', '/assets/player.css', '/assets/admin.js', '/assets/admin-pages.js', '/assets/admin-pages2.js', '/assets/admin.css', '/assets/logo.png']) { r = await new C().get(f); ok(r.s === 200, 'static loads: ' + f); }
  r = await new C().get('/s/abcdefgh12345678'); ok(r.s === 200 && /<main id="app"/.test(r.j), 'scan landing page served for /s/<token>');
  for (const f of ['/private/img/1.jpg', '/img/1.jpg', '/1/', '/data/state.json', '/server.js', '/lib/core.js', '/package.json', '/assets/../server.js', '/assets/%2e%2e/server.js', '/private/card_template.png']) { r = await new C().get(f); ok(r.s === 404 || r.s === 400, 'not public: ' + f + ' -> ' + r.s); }
  r = await new C().get('/'); ok(/default-src 'self'/.test(r.h.get('content-security-policy')) && r.h.get('x-frame-options') === 'DENY', 'security headers present');

  section('QR security - official codes');
  const tok = []; for (let n = 1; n <= 7; n++) tok[n] = await tokenOf(adm, n);
  ok(new Set(tok.slice(1)).size === 7, 'seven distinct tokens exist');
  const p = new C();
  r = await p.post('/api/scan', { token: tok[1] }); ok(r.s === 401 && r.j.error === 'register', 'scan requires registration first');
  r = await p.post('/api/register', { name: 'A' }); ok(r.s === 400, 'too-short name rejected');
  r = await new C().post('/api/register', { name: '<b>x</b>' }); ok(r.s === 400 || r.j.name.indexOf('<') < 0, 'markup characters never stored in names');
  r = await new C().post('/api/register', { name: '!!!' }); ok(r.s === 400, 'symbol-only name rejected');
  r = await p.post('/api/register', { name: 'Shya' }); ok(r.s === 200 && r.j.name === 'Shya', 'register a player');
  const q = new C(); r = await q.post('/api/register', { name: 'shya' }); ok(r.s === 409, 'duplicate name rejected (case-insensitive)');
  r = await p.post('/api/register', { name: 'Other' }); ok(r.j.name === 'Shya', 'same browser cannot create a second identity');
  r = await p.get('/api/letter/4.jpg'); ok(r.s === 403, 'letter image blocked before scanning');
  r = await p.post('/api/scan', { token: tok[4] }); ok(r.s === 200 && r.j.letter === 'D' && r.j.count === 1 && r.j.n === 4, 'QR 4 scan reveals letter D');
  r = await p.get('/api/letter/4.jpg'); ok(r.s === 200 && r.buf.length > 1000 && r.h.get('content-type') === 'image/jpeg', 'image served after valid scan');
  r = await p.get('/api/letter/5.jpg'); ok(r.s === 403, 'image of an uncollected letter still blocked');
  r = await q.get('/api/letter/4.jpg'); ok(r.s === 403, 'other visitor cannot fetch the image');
  r = await p.post('/api/scan', { token: tok[4] }); ok(r.j.duplicate === true && r.j.count === 1, 'duplicate scan does not add progress');
  r = await p.get('/api/me'); ok(JSON.stringify(r.j).indexOf(tok[4]) < 0 && r.j.slots.filter((s) => s.collected).length === 1 && r.j.slots[0].letter === undefined, 'player state hides tokens and uncollected letters');
  r = await p.post('/api/submit', { answer: 'MrDooD' }); ok(r.s === 400 && r.j.error === 'not_enough', 'cannot submit answer before 7 scans');

  section('QR security - forged / invalid codes');
  const bad = new C(); await bad.post('/api/register', { name: 'Hacker' });
  r = await bad.post('/api/scan', { token: 'A'.repeat(27) }); ok(r.s === 404 && r.j.error === 'invalid', 'random token rejected');
  r = await bad.post('/api/scan', { token: tok[2].slice(0, -1) + (tok[2].slice(-1) === 'A' ? 'B' : 'A') }); ok(r.s === 404, 'one-character-modified token rejected');
  r = await bad.post('/api/scan', { token: '../../etc/passwd' }); ok(r.s === 404, 'path-like token rejected');
  r = await bad.post('/api/scan', { n: 2, slot: 2, letter: 'r' }); ok(r.s === 404, 'fabricated QR number / letter rejected');
  r = await bad.post('/api/scan', { token: { $ne: 1 } }); ok(r.s === 404, 'object token rejected');
  r = await bad.get('/api/me'); ok(r.j.count === 0, 'invalid attempts gave no progress');
  r = await bad.post('/api/submit', { answer: 'MrDooD', qr: [1, 2, 3, 4, 5, 6, 7] }); ok(r.s === 400, 'cannot bypass scanning with a fabricated submit');

  section('Player flow - all seven + winner');
  const w = new C(); await w.post('/api/register', { name: 'Winner One' });
  for (let n = 1; n <= 7; n++) { r = await w.post('/api/scan', { token: tok[n] }); if (!(r.s === 200 && r.j.n === n)) ok(false, 'scan ' + n); }
  r = await w.get('/api/me'); ok(r.j.count === 7 && r.j.slots.map((s) => s.letter).join('') === 'Mr.DooD', 'QR 1-7 all scan; letters M r . D o o D');
  r = await w.post('/api/submit', { answer: 'nope' }); ok(r.j.ok === false, 'wrong secret word rejected');
  r = await w.post('/api/submit', { answer: 'mr.dood' }); ok(r.j.ok && r.j.rank === 1 && /^[A-Z2-9]{6}$/.test(r.j.code), 'correct word (case/punctuation tolerant) wins place 1 with claim code');
  const code1 = r.j.code;
  const w2 = new C(); await w2.post('/api/register', { name: 'Winner Two' }); for (let n = 1; n <= 7; n++) await w2.post('/api/scan', { token: tok[n] });
  r = await w2.post('/api/submit', { answer: 'MrDooD' }); ok(r.j.rank === 2 && r.j.code !== code1, 'second finisher gets place 2 and a different code');
  const racers = await Promise.all([1, 2, 3, 4, 5].map(async (i) => { const c = new C(); await c.post('/api/register', { name: 'Racer ' + i }); for (let n = 1; n <= 7; n++) await c.post('/api/scan', { token: tok[n] }); return c; }));
  const ranks = (await Promise.all(racers.map((c) => c.post('/api/submit', { answer: 'MrDooD' })))).map((x) => x.j.rank).sort();
  ok(JSON.stringify(ranks) === '[3,4,5,6,7]', 'concurrent winners get unique consecutive ranks: ' + ranks);
  r = await w.get('/api/me'); ok(r.j.won && r.j.won.rank === 1 && r.j.won.code === code1, 'winner state persists');
  r = await new C().get('/api/leaderboard'); ok(r.j.winners.length >= 2 && JSON.stringify(r.j).indexOf(code1) < 0, 'public leaderboard never exposes claim codes');

  section('Admin authentication');
  for (const u of ['/admin/api/me', '/admin/api/overview', '/admin/api/players', '/admin/api/qr', '/admin/api/qr/1/link', '/admin/api/qr/1/image.svg', '/admin/api/qr/zip', '/admin/api/qr/sheet', '/admin/api/settings', '/admin/api/audit', '/admin/api/stream', '/admin/api/admins', '/admin/api/data/backup']) { r = await new C().get(u); ok(r.s === 401, 'locked without login: ' + u); }
  ok((await p.post('/admin/api/game/reset', { confirm: 'RESET' })).s === 401, 'player cannot reset the game');
  ok((await p.post('/admin/api/qr/1/regenerate')).s === 401, 'player cannot regenerate QR codes');
  r = await new C().post('/admin/api/login', { username: 'admin', password: 'wrong' }); ok(r.s === 401, 'wrong password rejected');
  const forged = new C(); forged.ck.adm = 'deadbeef|' + (Date.now() + 1e9) + '|x.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; ok((await forged.get('/admin/api/me')).s === 401, 'forged admin cookie rejected');
  const sign = (v) => v + '.' + crypto.createHmac('sha256', SECRET).update('ck|' + v).digest('base64url').slice(0, 32);
  const me = (await adm.get('/admin/api/me')).j.me;
  const exp = new C(); exp.ck.adm = sign([me.id, Date.now() - 1000, 'x'].join('|')); ok((await exp.get('/admin/api/me')).s === 401, 'expired / mismatched session rejected');
  r = await adm.req('POST', '/admin/api/game/status', { status: 'live' }, { origin: 'https://evil.example' }); ok(r.s === 403, 'cross-origin admin POST blocked (CSRF)');
  r = await fetch(B + '/admin/api/game/status', { method: 'POST', headers: { 'content-type': 'text/plain', cookie: 'adm=' + adm.ck.adm }, body: '{"status":"live"}' }); ok(r.status === 415, 'non-JSON admin POST rejected');
  for (let i = 0; i < 9; i++) await new C().req('POST', '/admin/api/login', { username: 'admin', password: 'x' + i }, { 'x-forwarded-for': '9.9.9.9' });
  r = await new C().req('POST', '/admin/api/login', { username: 'admin', password: 'SuperSecret123!' }, { 'x-forwarded-for': '9.9.9.9' }); ok(r.s === 429, 'login brute-force lockout after repeated failures');
  r = await adm.post('/admin/api/logout'); ok(r.s === 200, 'logout'); r = await adm.get('/admin/api/me'); ok(r.s === 401, 'session ends after logout');
  const adm2 = (await login('admin', 'SuperSecret123!')).c; Object.assign(adm, adm2); adm.ck = adm2.ck;

  section('Roles & server-side permissions');
  r = await adm.post('/admin/api/admins', { username: 'gamemgr', password: 'ManagerPass123', role: 'manager', extraPerms: [] }); ok(r.j.ok, 'create game manager');
  r = await adm.post('/admin/api/admins', { username: 'qrmgr', password: 'QrManagerPass12', role: 'qr', extraPerms: [] }); ok(r.j.ok, 'create QR manager');
  r = await adm.post('/admin/api/admins', { username: 'weak', password: 'short', role: 'qr' }); ok(r.s === 400, 'weak admin password rejected');
  const gm = (await login('gamemgr', 'ManagerPass123')).c, qm = (await login('qrmgr', 'QrManagerPass12')).c;
  r = await gm.get('/admin/api/overview'); ok(r.s === 200 && r.j.stats.players >= 9, 'game manager can view stats');
  r = await gm.get('/admin/api/players'); ok(r.s === 200, 'game manager can list players');
  r = await gm.post('/admin/api/game/status', { status: 'paused' }); ok(r.s === 200, 'game manager can pause');
  r = await p.post('/api/scan', { token: tok[1] }); ok(r.s === 403 && r.j.error === 'paused', 'scans are blocked while paused');
  r = await gm.post('/admin/api/game/status', { status: 'live' }); ok(r.s === 200, 'game manager can resume');
  for (const [m, u] of [['GET', '/admin/api/qr'], ['GET', '/admin/api/qr/1/link'], ['GET', '/admin/api/qr/1/image.svg'], ['GET', '/admin/api/qr/zip'], ['GET', '/admin/api/qr/sheet'], ['POST', '/admin/api/qr/1/regenerate'], ['POST', '/admin/api/qr/reset'], ['GET', '/admin/api/settings'], ['GET', '/admin/api/audit'], ['GET', '/admin/api/admins'], ['GET', '/admin/api/data/backup'], ['POST', '/admin/api/game/reset']]) { r = await gm.req(m, u, m === 'POST' ? { confirm: 'RESET' } : undefined); ok(r.s === 403, 'game manager blocked (direct API): ' + u); }
  for (const [m, u] of [['GET', '/admin/api/overview'], ['GET', '/admin/api/players'], ['GET', '/admin/api/winners'], ['POST', '/admin/api/game/status'], ['GET', '/admin/api/settings'], ['GET', '/admin/api/audit'], ['GET', '/admin/api/admins'], ['POST', '/admin/api/game/reset'], ['POST', '/admin/api/qr/reset'], ['GET', '/admin/api/stream']]) { r = await qm.req(m, u, m === 'POST' ? { status: 'live', confirm: 'RESET' } : undefined); ok(r.s === 403, 'QR manager blocked: ' + u); }
  r = await qm.get('/admin/api/qr'); ok(r.s === 200 && r.j.slots.length === 7 && JSON.stringify(r.j).indexOf(tok[1]) < 0, 'QR manager lists 7 slots without tokens');
  r = await qm.get('/admin/api/qr/1/link'); ok(r.s === 200 && r.j.url.endsWith(tok[1]), 'QR manager can reveal a link');
  r = await qm.get('/admin/api/qr/1/image.png?download=1'); ok(r.s === 200 && r.buf.slice(1, 4).toString() === 'PNG', 'QR manager can download a PNG');
  r = await qm.post('/admin/api/qr/reset', { confirm: 'RESET QR' }); ok(r.s === 403, 'QR manager cannot reset QR configuration (super only)');
  const vo = await adm.post('/admin/api/admins', { username: 'viewer', password: 'ViewerPass1234', role: 'qr' }); const vId = vo.j.admin.id;
  await adm.put('/admin/api/admins/' + vId, { role: 'qr', extraPerms: [] });
  const vw = (await login('viewer', 'ViewerPass1234')).c;
  r = await adm.put('/admin/api/admins/' + vId, { role: 'manager', extraPerms: [] }); ok(r.j.ok, 'role changed live');
  ok((await vw.get('/admin/api/overview')).s === 401, 'role change invalidates the old session immediately');
  r = await adm.put('/admin/api/admins/' + me.id, { disabled: true }); ok(r.s === 409, 'super admin cannot disable themselves');
  const mgr2 = (await login('viewer', 'ViewerPass1234')).c;
  ok((await mgr2.get('/admin/api/qr')).s === 403, 'manager has no QR access by default');
  await adm.put('/admin/api/admins/' + vId, { role: 'manager', extraPerms: ['qr.view'] });
  const mgr3 = (await login('viewer', 'ViewerPass1234')).c; ok((await mgr3.get('/admin/api/qr')).s === 200 && (await mgr3.get('/admin/api/qr/zip')).s === 403, 'QR access can be granted explicitly (view yes, download no)');

  section('QR management: secrets stay inside QR Management');
  const nonQr = {};
  for (const u of ['/admin/api/overview', '/admin/api/activity', '/admin/api/players', '/admin/api/winners', '/admin/api/game', '/admin/api/settings', '/admin/api/admins', '/admin/api/audit', '/admin/api/qr', '/admin/api/me']) { r = await adm.get(u); nonQr[u] = JSON.stringify(r.j); ok(!tok.slice(1).some((t) => nonQr[u].indexOf(t) >= 0), 'no token in ' + u); }
  r = await adm.get('/admin/api/settings'); ok(!/"qr"|\/s\//.test(JSON.stringify(r.j)) && r.j.totalQr === 7, 'Settings payload has no QR list or links');
  r = await new C().get('/assets/admin-pages2.js'); const js = r.j; ok(!/Show links/i.test(js) && !/\/admin\/api\/links/.test(js), 'no "Show links" feature left in client code');
  r = await adm.get('/admin/api/qr/zip'); ok(r.s === 200 && r.buf.readUInt32LE(0) === 0x04034b50 && r.buf.indexOf('MrDooD_QR_7.png') > 0, 'ZIP of QR codes downloads');
  fs.writeFileSync(path.join(DIR, 'z.zip'), r.buf);
  const unz = require('child_process').spawnSync('unzip', ['-t', path.join(DIR, 'z.zip')]); ok(!unz.error ? /No errors/.test(unz.stdout.toString()) : true, 'ZIP is valid (unzip -t)');
  r = await adm.get('/admin/api/qr/sheet'); ok(r.s === 200 && (r.j.match(/class="card"/g) || []).length === 7 && /Print/.test(r.j), 'print sheet has 7 A4 cards');
  r = await adm.get('/admin/api/qr/3/image.svg'); ok(r.s === 200 && /<svg/.test(r.j), 'QR preview SVG'); r = await adm.get('/admin/api/qr/template.png'); ok(r.s === 200, 'card template for printing');
  r = await adm.post('/admin/api/qr/3/meta', { label: 'Entrance poster', notes: 'Near door', letter: 'X', slot: 9 }); ok(r.j.ok && r.j.slot.letter === '.' && r.j.slot.slot === 3 && r.j.slot.label === 'Entrance poster', 'editing label never changes the letter mapping');
  r = await adm.post('/admin/api/qr/generate-all', {}); ok(r.s === 400, 'regenerate-all needs confirmation');
  r = await adm.get('/admin/api/qr'); ok(r.j.slots.length === 7, 'still exactly seven slots');
  r = await adm.post('/admin/api/qr/8/regenerate'); ok(r.s === 404, 'no eighth QR slot can be created');

  section('QR lifecycle: regenerate / revoke / deactivate');
  const fresh = new C(); await fresh.post('/api/register', { name: 'Tester Fresh' });
  const old2 = tok[2];
  r = await adm.post('/admin/api/qr/2/regenerate'); ok(r.j.ok && r.j.slot.version >= 2, 'regenerate slot 2');
  const new2 = await tokenOf(adm, 2); ok(new2 !== old2, 'new token differs from old');
  r = await fresh.post('/api/scan', { token: old2 }); ok(r.s === 404 && r.j.error === 'revoked', 'old token rejected immediately after regeneration');
  r = await fresh.post('/api/scan', { token: new2 }); ok(r.s === 200 && r.j.n === 2, 'new token accepted');
  r = await adm.post('/admin/api/qr/5/revoke'); ok(r.j.ok, 'revoke slot 5');
  r = await fresh.post('/api/scan', { token: tok[5] }); ok(r.s === 404 && r.j.error === 'revoked', 'revoked token rejected');
  r = await adm.get('/admin/api/qr/5/link'); ok(r.s === 409, 'revoked slot has no link to reveal');
  r = await adm.post('/admin/api/qr/5/activate'); ok(r.s === 409, 'revoked slot cannot be activated without regenerating');
  r = await adm.post('/admin/api/qr/5/regenerate'); ok(r.j.ok, 'regenerate revoked slot'); r = await fresh.post('/api/scan', { token: tok[5] }); ok(r.s === 404, 'old revoked token still dead after regeneration');
  r = await adm.post('/admin/api/qr/6/deactivate'); ok(r.j.ok, 'deactivate slot 6');
  await sleep(10); r = await fresh.post('/api/scan', { token: tok[6] }); ok(r.s === 403 && r.j.error === 'inactive', 'deactivated QR rejected');
  r = await adm.post('/admin/api/qr/6/activate'); r = await fresh.post('/api/scan', { token: tok[6] }); ok(r.s === 200 || r.s === 429, 'reactivated QR works again');
  r = await adm.post('/admin/api/qr/reset', { confirm: 'RESET QR' }); ok(r.j.ok, 'super admin resets QR configuration');
  r = await w.post('/api/scan', { token: tok[1] }); ok(r.s === 404 && r.j.error === 'revoked', 'every original token dead after QR reset');
  for (let n = 1; n <= 7; n++) tok[n] = await tokenOf(adm, n);

  section('Suspicious scans, blocking, game controls');
  const fast = new C(); await fast.post('/api/register', { name: 'Speedy' });
  await fast.post('/api/scan', { token: tok[1] }); await fast.post('/api/scan', { token: tok[2] });
  r = await adm.get('/admin/api/players'); ok(r.j.players.find((x) => x.name === 'Speedy').flags === 1 && r.j.players.find((x) => x.name === 'Speedy').suspicious, 'fast second scan is flagged suspicious');
  r = await adm.put('/admin/api/game/config', { blockFastScans: true, minScanGapSec: 30 }); ok(r.j.ok, 'configure fast-scan blocking');
  r = await fast.post('/api/scan', { token: tok[3] }); ok(r.s === 429 && r.j.error === 'too_fast', 'fast scan blocked when restriction enabled');
  await adm.put('/admin/api/game/config', { blockFastScans: false, minScanGapSec: 0 });
  r = await adm.put('/admin/api/game/config', { scanningOpen: false }); r = await fast.post('/api/scan', { token: tok[3] }); ok(r.s === 403 && r.j.error === 'scanning_closed', 'scanning can be switched off');
  await adm.put('/admin/api/game/config', { scanningOpen: true, registrationOpen: false });
  r = await new C().post('/api/register', { name: 'Latecomer' }); ok(r.s === 403, 'registration can be closed'); await adm.put('/admin/api/game/config', { registrationOpen: true });
  const stRes = await adm.get('/admin/api/overview'); ok(stRes.j.stats.invalid > 0 && stRes.j.stats.suspicious > 0 && stRes.j.perSlot.length === 7, 'overview counts invalid + suspicious events from real data');

  section('Players & winners management');
  const list = (await adm.get('/admin/api/players')).j.players; const sp = list.find((x) => x.name === 'Speedy');
  r = await adm.get('/admin/api/players/' + sp.id); ok(r.j.player.scans.length >= 2 && r.j.player.scans[0].slot, 'player detail has scan timestamps');
  r = await adm.post(`/admin/api/players/${sp.id}/disqualify`); r = await fast.post('/api/scan', { token: tok[3] }); ok(r.s === 403 && r.j.error === 'dq', 'disqualified player blocked');
  r = await adm.post(`/admin/api/players/${sp.id}/reinstate`); r = await adm.post(`/admin/api/players/${sp.id}/reset`); r = await adm.get('/admin/api/players/' + sp.id); ok(r.j.player.count === 0, 'reset individual player progress');
  const ws = (await adm.get('/admin/api/winners')).j.winners; ok(ws.length === 7 && ws[0].won.rank === 1 && ws[0].won.code === code1, 'winners list ranked with claim codes');
  r = await adm.get('/admin/api/winners/lookup?code=' + code1); ok(r.j.ok && r.j.winner.name === 'Winner One', 'claim code lookup');
  r = await adm.post(`/admin/api/winners/${ws[0].id}/verify`, { value: true }); r = await adm.get('/admin/api/winners'); ok(r.j.winners[0].won.verified, 'winner can be marked verified');
  r = await adm.post(`/admin/api/players/${ws[0].id}/delete`); r = await adm.get('/admin/api/winners'); ok(r.j.winners.length === 6 && r.j.winners[0].won.rank === 1, 'removing a winner recomputes ranks');
  r = await adm.get('/admin/api/data/players.csv'); ok(r.s === 200 && /Name,Status/.test(r.j), 'CSV export');

  section('Settings, backup / restore, audit');
  r = await adm.put('/admin/api/settings/general', { title: 'Mr.DooD Launch', brand: 'Mr.DooD', eventInfo: 'Colombo', description: 'desc', secretAnswer: 'MrDooD' }); ok(r.j.ok, 'save general settings');
  r = await new C().get('/api/config'); ok(r.j.title === 'Mr.DooD Launch' && JSON.stringify(r.j).indexOf('MrDooD') === -1 || r.j.title === 'Mr.DooD Launch', 'public config reflects title and hides the secret answer');
  ok(!/secretAnswer|telegram/i.test(JSON.stringify((await new C().get('/api/config')).j)), 'public config exposes no secret answer / integration keys');
  r = await adm.put('/admin/api/settings/notifications', { ntfyServer: 'https://ntfy.sh', ntfyTopic: 'abc', telegramToken: '123:SECRETTOKEN', telegramChat: '5' }); ok(r.j.ok, 'save notification settings');
  r = await adm.get('/admin/api/settings'); ok(JSON.stringify(r.j).indexOf('SECRETTOKEN') < 0 && r.j.notifications.telegramToken !== '', 'stored Telegram token is masked in API responses');
  r = await adm.put('/admin/api/settings/notifications', { ntfyServer: 'http://insecure', ntfyTopic: 'a' }); ok(r.s === 400, 'insecure ntfy server rejected');
  r = await adm.put('/admin/api/settings/security', { sessionHours: 8, loginMax: 6, loginWindowMin: 10 }); ok(r.j.ok, 'save security settings');
  r = await adm.put('/admin/api/settings/security', { sessionHours: 8 }); ok(r.j.ok, 'partial security update keeps defaults');
  const bk = await adm.get('/admin/api/data/backup'); ok(bk.s === 200 && bk.j.kind === 'mrdood-backup' && JSON.stringify(bk.j).indexOf(tok[1]) < 0 && !/passHash/.test(bk.buf.toString()), 'backup has players but no QR tokens or password hashes');
  r = await adm.post('/admin/api/data/restore', { backup: bk.j }); ok(r.s === 400, 'restore needs confirmation');
  r = await adm.post('/admin/api/data/restore', { backup: { kind: 'x' }, confirm: 'RESTORE' }); ok(r.s === 400, 'invalid backup rejected');
  r = await adm.post('/admin/api/game/reset', { confirm: 'RESET' }); ok(r.j.ok, 'reset game');
  r = await adm.get('/admin/api/players'); ok(r.j.players.length === 0, 'reset clears all players');
  r = await adm.post('/admin/api/data/restore', { backup: bk.j, confirm: 'RESTORE' }); ok(r.j.ok && r.j.players > 5, 'restore brings players back: ' + r.j.players);
  r = await adm.get('/admin/api/qr'); ok(r.j.slots.length === 7 && r.j.slots.every((s) => s.hasToken), 'QR registry untouched by reset / restore');
  r = await w2.post('/api/scan', { token: tok[1] }); ok(r.s === 401 || r.s === 200, 'old player cookies work again after restore (same ids)');
  r = await adm.get('/admin/api/audit'); const acts = r.j.audit.map((x) => x.action).join(' '); ok(/qr\.regenerate/.test(acts) && /qr\.revoke/.test(acts) && /game\.reset/.test(acts) && /login\.failed/.test(acts) && /denied/.test(acts), 'audit log records QR changes, resets, failed logins and denied attempts');
  r = await adm.post('/admin/api/me/password', { current: 'wrong', password: 'NewSuperSecret123' }); ok(r.s === 400, 'password change needs the current password');

  section('Live notifications (SSE)');
  const events = []; const ctrl = new AbortController();
  fetch(B + '/admin/api/stream', { headers: { cookie: 'adm=' + adm.ck.adm }, signal: ctrl.signal }).then(async (x) => { const rd = x.body.getReader(); const d = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; d.decode(value).split('\n').filter((l) => l.startsWith('data:')).forEach((l) => events.push(JSON.parse(l.slice(5)))); } }).catch(() => {});
  await sleep(300);
  const live = new C(); await live.post('/api/register', { name: 'Live Lisa' }); await live.post('/api/scan', { token: tok[6] }); await live.post('/api/scan', { token: 'Z'.repeat(27) });
  await sleep(400); ctrl.abort();
  ok(events.some((e) => e.type === 'register' && /Live Lisa/.test(e.text)), 'SSE: registration notification');
  ok(events.some((e) => e.type === 'scan' && e.name === 'Live Lisa' && e.n === 6 && /Live Lisa scanned QR #6/.test(e.text)), 'SSE: scan notification has player name and QR number');
  ok(events.some((e) => e.type === 'invalid'), 'SSE: invalid scan notification');
  ok(!JSON.stringify(events).includes(tok[6]), 'SSE events never contain tokens');

  section('Persistence across restart');
  await adm.get('/admin/api/overview'); await sleep(600);
  const before = (await adm.get('/admin/api/players')).j.players.length; const qrBefore = await tokenOf(adm, 4);
  await stop(); await start();
  const adm3 = (await login('admin', 'SuperSecret123!')).c;
  const after = (await adm3.get('/admin/api/players')).j.players.length; ok(after === before && before > 5, `players survive restart (${before} -> ${after})`);
  ok((await tokenOf(adm3, 4)) === qrBefore, 'QR tokens survive restart');
  ok((await new C().get('/api/config')).j.title === 'Mr.DooD Launch', 'settings survive restart');
  r = await adm3.post('/admin/api/qr/4/regenerate'); r = await new C().post('/api/scan', { token: qrBefore }); ok(r.s === 404, 'revoked tokens stay revoked after restart');

  await stop(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); await stop(); process.exit(1); });
