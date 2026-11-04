(function () {
  'use strict';
  var A = window.A, $ = A.$, esc = A.esc, ic = A.ic;
  var view = function () { return $('view'); };
  var sw = function (id, on, dis) { return '<label class="sw"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + (dis ? ' disabled' : '') + '><i></i></label>'; };
  var errCard = function (r) { view().innerHTML = '<div class="card">' + A.empty('alert', A.errText(r)) + '</div>'; };
  var copy = function (txt) { return navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject(); };

  // ============================================================ QR MANAGEMENT (separate, permission-gated workspace)
  var qp = A.pages.qr = { shown: {}, timers: {}, data: null };
  qp.render = function () { load(); };
  qp.refresh = function () { if (A.page === 'qr' && !Object.keys(qp.shown).length) load(); };
  function clearTimers() { Object.keys(qp.timers).forEach(function (k) { clearTimeout(qp.timers[k]); }); qp.timers = {}; qp.shown = {}; }
  function load() {
    A.cleanup = clearTimers;
    A.api('/admin/api/qr').then(function (r) { if (A.page !== 'qr') return; if (!r.ok) return errCard(r); qp.data = r; drawQr(); });
  }
  function drawQr() {
    var r = qp.data, mg = A.can('qr.manage'), dl = A.can('qr.download');
    view().innerHTML =
      '<div class="notice bad">' + ic('alert') + '<div><b>Sensitive area.</b> These QR codes unlock the game. Regenerating or revoking a QR code <b>immediately invalidates every printed copy</b> of the old code. Every view, download and change here is recorded in the audit log.</div></div>' +
      '<div class="toolbar">' + (dl ? '<a class="btn primary" href="/admin/api/qr/zip">' + ic('download') + 'Download all (ZIP)</a><a class="btn" href="/admin/api/qr/sheet" target="_blank" rel="noopener">' + ic('print') + 'Print-ready A4 cards</a>' : '') +
      '<span class="sp"></span>' + (mg ? '<button class="btn danger" id="qAll">' + ic('refresh') + 'Regenerate all 7</button>' : '') + (A.can('qr.reset') ? '<button class="btn danger" id="qReset">Reset QR configuration</button>' : '') + '</div>' +
      '<div class="qrg">' + r.slots.map(card).join('') + '</div><p class="muted small" style="margin-top:14px">The game always has exactly seven QR slots. Each slot is permanently tied to its letter and image; only the secret link and the label can change. ' + r.retired + ' retired token(s) are remembered so old codes show a clear "expired" message to players.</p>';
    view().onclick = onClick;
    if (mg) { var a = $('qAll'); if (a) a.onclick = regenAll; }
    var rs = $('qReset'); if (rs) rs.onclick = resetCfg;
  }
  function card(q) {
    var mg = A.can('qr.manage'), dl = A.can('qr.download'), shown = !!qp.shown[q.slot];
    var st = q.revoked ? '<span class="pill bad">Revoked</span>' : q.active ? '<span class="pill ok">Active</span>' : '<span class="pill warn">Inactive</span>';
    var box = shown && q.hasToken ? '<img alt="QR code ' + q.slot + '" src="/admin/api/qr/' + q.slot + '/image.svg?t=' + Date.now() + '">' :
      '<div class="cover">' + ic(q.revoked ? 'x' : 'lock') + '<div>' + (q.revoked ? 'Revoked: no active token' : 'Hidden for privacy') + '</div></div>';
    return '<div class="qrc' + (q.active ? '' : ' off') + '" data-slot="' + q.slot + '"><header><div style="display:flex;gap:10px;align-items:center"><span class="letterb">' + esc(q.letter) + '</span><div><b>' + esc(q.label) + '</b><div class="muted small">Slot ' + q.slot + ' of 7</div></div></div>' + st + '</header>' +
      '<div class="qrbox">' + box + '</div>' +
      '<div class="muted small">Collected by <b style="color:#fff">' + q.collectedBy + '</b> player' + (q.collectedBy === 1 ? '' : 's') + ' · token v' + q.version + (q.legacy ? ' · <span class="pill warn">legacy token</span>' : '') + (q.notes ? '<br>' + esc(q.notes) : '') + '</div>' +
      '<div class="acts">' + (q.hasToken ? '<button class="btn sm" data-a="toggle">' + ic('eye') + (shown ? 'Hide' : 'Reveal') + '</button>' : '') +
      (dl && q.hasToken ? '<a class="btn sm" href="/admin/api/qr/' + q.slot + '/image.png?download=1">PNG</a><a class="btn sm" href="/admin/api/qr/' + q.slot + '/image.svg?download=1">SVG</a><a class="btn sm" href="/admin/api/qr/sheet?slot=' + q.slot + '" target="_blank" rel="noopener">' + ic('print') + 'Card</a>' : '') +
      (q.hasToken ? '<button class="btn sm" data-a="link">' + ic('copy') + 'Copy link</button>' : '') + '</div>' +
      (mg ? '<div class="acts" style="border-top:1px solid var(--line);padding-top:10px"><button class="btn sm" data-a="edit">Edit</button><button class="btn sm" data-a="regen">Regenerate</button>' + (q.hasToken ? '<button class="btn sm" data-a="' + (q.active ? 'deactivate' : 'activate') + '">' + (q.active ? 'Deactivate' : 'Activate') + '</button><button class="btn sm danger" data-a="revoke">Revoke</button>' : '') + '</div>' : '') + '</div>';
  }
  function slotOf(btn) { var c = btn.closest('.qrc'); return c ? Number(c.dataset.slot) : 0; }
  function act(slot, a, body) { return A.api('/admin/api/qr/' + slot + '/' + a, body || {}).then(function (r) { if (!r.ok) { A.toast(A.errText(r), 'bad'); return false; } return true; }); }
  function onClick(e) {
    var b = e.target.closest('button[data-a]'); if (!b) return;
    var slot = slotOf(b), a = b.dataset.a, q = qp.data.slots[slot - 1];
    if (a === 'toggle') {
      if (qp.shown[slot]) { delete qp.shown[slot]; clearTimeout(qp.timers[slot]); } else { qp.shown[slot] = true; qp.timers[slot] = setTimeout(function () { delete qp.shown[slot]; if (A.page === 'qr') drawQr(); }, 60000); }
      return drawQr();
    }
    if (a === 'link') return A.api('/admin/api/qr/' + slot + '/link').then(function (r) { if (!r.ok) return A.toast(A.errText(r), 'bad'); copy(r.url).then(function () { A.toast('Secret link copied. Do not share it with players.', 'ok'); }, function () { A.dialog({ title: 'Secret link', cancel: 'Close', body: '<input readonly value="' + esc(r.url) + '" onclick="this.select()">' }); }); });
    if (a === 'edit') return A.dialog({ title: 'Edit ' + q.label, confirm: 'Save', body: '<p class="muted small">Labels are for your organisation only. The letter (' + esc(q.letter) + ') and image of this slot can never change.</p><label class="f">Label</label><input id="eL" maxlength="40" value="' + esc(q.label) + '"><label class="f">Notes (for example, where it is placed)</label><textarea id="eN" maxlength="200">' + esc(q.notes) + '</textarea>', onConfirm: function (el) { return A.api('/admin/api/qr/' + slot + '/meta', { label: el.querySelector('#eL').value, notes: el.querySelector('#eN').value }).then(function (r) { if (!r.ok) return A.errText(r); load(); }); } });
    if (a === 'regen') return A.confirm('Regenerate QR #' + slot + '?', 'A brand-new secret link is created. <b>The old QR code stops working immediately</b>, so any printed copy of it must be replaced.', { confirm: 'Regenerate', onConfirm: function () { return act(slot, 'regenerate').then(function (ok) { if (!ok) return 'Failed'; delete qp.shown[slot]; A.toast('QR #' + slot + ' regenerated. Old code is now invalid.', 'ok'); load(); }); } });
    if (a === 'revoke') return A.confirm('Revoke QR #' + slot + '?', 'The code is destroyed and the slot is disabled until you regenerate it. Players who scan the old code will see an "expired" message.', { confirm: 'Revoke', onConfirm: function () { return act(slot, 'revoke').then(function (ok) { if (!ok) return 'Failed'; delete qp.shown[slot]; A.toast('QR #' + slot + ' revoked', 'ok'); load(); }); } });
    if (a === 'activate' || a === 'deactivate') return act(slot, a).then(function (ok) { if (ok) { A.toast('QR #' + slot + (a === 'activate' ? ' activated' : ' deactivated'), 'ok'); load(); } });
  }
  function regenAll() {
    A.confirm('Regenerate all seven QR codes?', 'All 7 secret links are replaced. <b>Every printed QR card stops working immediately</b> and you must reprint them all.', { type: 'REGENERATE', confirm: 'Regenerate all', onConfirm: function () { return A.api('/admin/api/qr/generate-all', { confirm: 'REGENERATE' }).then(function (r) { if (!r.ok) return A.errText(r); clearTimers(); A.toast('All 7 QR codes regenerated', 'ok'); load(); }); } });
  }
  function resetCfg() {
    A.confirm('Reset QR configuration?', 'Regenerates all 7 tokens <b>and</b> clears every label and note. All printed cards become invalid.', { type: 'RESET QR', confirm: 'Reset QR configuration', onConfirm: function () { return A.api('/admin/api/qr/reset', { confirm: 'RESET QR' }).then(function (r) { if (!r.ok) return A.errText(r); clearTimers(); A.toast('QR configuration reset', 'ok'); load(); }); } });
  }

  // ============================================================ GAME CONFIG FORM (shared by Game Controls and Settings)
  function gameForm(g, canEdit) {
    var d = canEdit ? '' : ' disabled';
    return '<div class="form2"><div><label class="f">Minimum seconds between scans</label><input id="gGap" type="number" min="0" max="600" value="' + g.minScanGapSec + '"' + d + '></div><div><label class="f">Suspicious after N fast scans</label><input id="gThr" type="number" min="1" max="20" value="' + g.suspiciousThreshold + '"' + d + '></div>' +
      '<div><label class="f">Duplicate scan policy</label><select id="gDup"' + d + '><option value="notify"' + (g.dupPolicy === 'notify' ? ' selected' : '') + '>Show in live feed</option><option value="ignore"' + (g.dupPolicy === 'ignore' ? ' selected' : '') + '>Ignore silently</option></select></div>' +
      '<div><label class="f">Prize limit (0 = every finisher)</label><input id="gPrize" type="number" min="0" max="1000" value="' + g.prizeLimit + '"' + d + '></div></div>' +
      '<div class="row-sw"><div><b>Block fast scans</b><div class="muted small">Reject scans that come sooner than the minimum interval (otherwise they are only flagged).</div></div>' + sw('gBlock', g.blockFastScans, !canEdit) + '</div>' +
      (canEdit ? '<button class="btn primary" id="gSave" style="margin-top:10px">Save game configuration</button>' : '<p class="muted small">You need the Game Controls permission to change this.</p>');
  }
  function bindGameForm(done) {
    var b = $('gSave'); if (!b) return;
    b.onclick = function () {
      A.api('/admin/api/game/config', { minScanGapSec: $('gGap').value, suspiciousThreshold: $('gThr').value, dupPolicy: $('gDup').value, prizeLimit: $('gPrize').value, blockFastScans: $('gBlock').checked }, 'PUT').then(function (r) { if (r.ok) { A.toast('Saved', 'ok'); if (done) done(r.game); } else A.toast(A.errText(r), 'bad'); });
    };
  }
  function resetGame() {
    A.confirm('Reset the entire game?', 'Deletes <b>all players, scans, winners and the activity feed</b>. QR codes and settings are kept. This cannot be undone. Download a backup first if unsure.', { type: 'RESET', confirm: 'Reset game', onConfirm: function () { return A.api('/admin/api/game/reset', { confirm: 'RESET' }).then(function (r) { if (!r.ok) return A.errText(r); A.feed = []; A.toast('Game reset', 'ok'); if (A.page === 'game') A.pages.game.render(); }); } });
  }

  // ============================================================ GAME CONTROLS
  var gp = A.pages.game = {};
  gp.render = function () {
    A.api('/admin/api/game').then(function (r) {
      if (A.page !== 'game') return;
      if (!r.ok) return errCard(r);
      var g = r.game;
      view().innerHTML =
        '<div class="card"><h2>Game status</h2><div class="seg" id="gSeg">' + [['not_started', 'Not started'], ['live', 'Live'], ['paused', 'Paused']].map(function (s) { return '<button data-s="' + s[0] + '" class="' + (g.status === s[0] ? 'on' : '') + '">' + s[1] + '</button>'; }).join('') + '</div><p class="muted small" style="margin-top:10px">Scans and secret-word answers only count while the game is <b>Live</b>. Players can still open the game while it is paused.</p></div>' +
        '<div class="grid g2"><div class="card"><h2>Availability</h2><div class="row-sw"><div><b>Allow new registrations</b><div class="muted small">Turn off to stop new players joining.</div></div>' + sw('gReg', g.registrationOpen) + '</div><div class="row-sw"><div><b>Allow scanning</b><div class="muted small">Turn off to block all QR scans immediately.</div></div>' + sw('gScan', g.scanningOpen) + '</div></div>' +
        '<div class="card"><h2>Scan restrictions &amp; suspicious-scan detection</h2>' + gameForm(g, true) + '</div></div>' +
        (A.can('data.manage') ? '<div class="card" style="border-color:rgba(255,90,77,.4)"><h2>Danger zone</h2><p class="muted small" style="margin-bottom:12px">Start a fresh event by clearing every player, scan and winner.</p><button class="btn danger" id="gReset">Reset entire game</button></div>' : '');
      $('gSeg').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; A.api('/admin/api/game/status', { status: b.dataset.s }).then(function (x) { if (x.ok) { A.toast('Game status: ' + b.textContent, 'ok'); gp.render(); } else A.toast(A.errText(x), 'bad'); }); };
      [['gReg', 'registrationOpen'], ['gScan', 'scanningOpen']].forEach(function (p) { $(p[0]).onchange = function () { var o = {}; o[p[1]] = this.checked; A.api('/admin/api/game/config', o, 'PUT').then(function (x) { A.toast(x.ok ? 'Updated' : A.errText(x), x.ok ? 'ok' : 'bad'); }); }; });
      bindGameForm();
      var rg = $('gReset'); if (rg) rg.onclick = resetGame;
    });
  };

  // ============================================================ SETTINGS
  var sp = A.pages.settings = { tab: 'general', data: null };
  var TABS = [['general', 'General'], ['game', 'Game configuration'], ['security', 'Security'], ['notifications', 'Notifications'], ['data', 'Data management']];
  sp.render = function () {
    A.api('/admin/api/settings').then(function (r) { if (A.page !== 'settings') return; if (!r.ok) return errCard(r); sp.data = r; drawSettings(); });
  };
  function drawSettings() {
    view().innerHTML = '<div class="tabs" id="stabs">' + TABS.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === sp.tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div id="spane"></div>';
    $('stabs').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; sp.tab = b.dataset.t; drawSettings(); };
    ({ general: tGeneral, game: tGame, security: tSecurity, notifications: tNotif, data: tData })[sp.tab]();
  }
  function saveBtn(id, label) { return '<button class="btn primary" id="' + id + '" style="margin-top:14px">' + (label || 'Save changes') + '</button>'; }
  function tGeneral() {
    var g = sp.data.general, ed = A.can('settings.edit');
    $('spane').innerHTML = '<div class="card"><h2>General settings</h2><div class="form2"><div><label class="f">Game title</label><input id="sT" maxlength="60" value="' + esc(g.title) + '"></div><div><label class="f">Brand name</label><input id="sB" maxlength="40" value="' + esc(g.brand) + '"></div></div>' +
      '<label class="f">Event information</label><input id="sE" maxlength="200" value="' + esc(g.eventInfo) + '" placeholder="e.g. Mr.DooD Launch Day, Colombo"><label class="f">Game description</label><textarea id="sD" maxlength="300">' + esc(g.description) + '</textarea>' +
      '<div class="form2"><div><label class="f">Secret answer</label><input id="sA" maxlength="40" value="' + esc(g.secretAnswer) + '" autocomplete="off"><div class="muted small" style="margin-top:4px">Case, spaces and punctuation are ignored when players answer.</div></div><div><label class="f">Total QR codes</label><input value="7 (fixed)" disabled></div></div>' + (ed ? saveBtn('sSave') : '') + '</div>';
    var b = $('sSave'); if (b) b.onclick = function () { A.api('/admin/api/settings/general', { title: $('sT').value, brand: $('sB').value, eventInfo: $('sE').value, description: $('sD').value, secretAnswer: $('sA').value }, 'PUT').then(function (r) { A.toast(r.ok ? 'General settings saved' : A.errText(r), r.ok ? 'ok' : 'bad'); }); };
  }
  function tGame() {
    $('spane').innerHTML = '<div class="card"><h2>Game configuration</h2>' + gameForm(sp.data.game, A.can('game.control')) + '</div><p class="muted small">Registration, scanning and start/pause controls live in <a href="#/game" style="color:var(--o2)">Game Controls</a>.</p>';
    bindGameForm();
  }
  var PERM_L = { 'stats.view': 'View overview', 'live.view': 'Live activity', 'players.view': 'View players', 'players.manage': 'Manage players', 'winners.view': 'View winners', 'winners.manage': 'Verify winners', 'game.control': 'Game controls', 'qr.view': 'View QR codes', 'qr.manage': 'Manage QR codes', 'qr.download': 'Download / print QR', 'settings.view': 'View settings', 'settings.edit': 'Edit settings', 'data.manage': 'Backup / reset data', 'audit.view': 'View audit log' };
  function tSecurity() {
    var s = sp.data.security, sec = A.can('security.manage');
    $('spane').innerHTML =
      '<div class="grid g2"><div class="card"><h2>Change my password</h2><label class="f">Current password</label><input id="pC" type="password" autocomplete="current-password"><label class="f">New password (min 10 characters)</label><input id="pN" type="password" autocomplete="new-password"><div class="err" id="pE"></div>' + saveBtn('pSave', 'Update password') + '</div>' +
      '<div class="card"><h2>Sessions &amp; login protection</h2><label class="f">Session length (hours)</label><input id="sH" type="number" min="1" max="72" value="' + s.sessionHours + '"' + (sec ? '' : ' disabled') + '><div class="form2"><div><label class="f">Max failed logins</label><input id="sM" type="number" min="3" max="30" value="' + s.loginMax + '"' + (sec ? '' : ' disabled') + '></div><div><label class="f">Lockout window (min)</label><input id="sW" type="number" min="1" max="120" value="' + s.loginWindowMin + '"' + (sec ? '' : ' disabled') + '></div></div>' + (sec ? saveBtn('sSec') : '') + '</div></div>' +
      '<div class="card"><h2>QR token security</h2><p class="muted">Every QR code carries a 160-bit random secret generated on the server. Tokens are never sent to players, never stored in the browser and never shown here. Regenerating a token invalidates the old one instantly.</p>' + (A.can('qr.view') ? '<a class="btn" style="margin-top:12px" href="#/qr">' + ic('qr') + 'Open QR Management</a>' : '') + '</div>' +
      '<div id="admBox"></div><div id="audBox"></div>';
    $('pSave').onclick = function () {
      var n = $('pN').value; $('pE').textContent = '';
      A.api('/admin/api/me/password', { current: $('pC').value, password: n }).then(function (r) { if (r.ok) { A.toast('Password updated', 'ok'); $('pC').value = ''; $('pN').value = ''; } else $('pE').textContent = A.errText(r); });
    };
    var sb = $('sSec'); if (sb) sb.onclick = function () { A.api('/admin/api/settings/security', { sessionHours: $('sH').value, loginMax: $('sM').value, loginWindowMin: $('sW').value }, 'PUT').then(function (r) { A.toast(r.ok ? 'Security settings saved' : A.errText(r), r.ok ? 'ok' : 'bad'); }); };
    if (A.can('admins.manage')) loadAdmins();
    if (A.can('audit.view')) loadAudit();
  }
  function permBoxes(list, have) { return list.map(function (p) { return '<label class="perm"><input type="checkbox" value="' + p + '"' + (have.indexOf(p) >= 0 ? ' checked' : '') + '>' + esc(PERM_L[p] || p) + '</label>'; }).join(''); }
  var ROLE_L = { super: 'Super administrator', manager: 'Game manager', qr: 'QR manager' };
  function loadAdmins() {
    A.api('/admin/api/admins').then(function (r) {
      if (!r.ok || !$('admBox')) return;
      $('admBox').innerHTML = '<div class="card"><h2>Administrators <button class="btn sm primary" id="aAdd">' + ic('plus') + 'Add administrator</button></h2><div class="tw"><table><thead><tr><th>User</th><th>Role</th><th>Extra access</th><th>Last login</th><th></th></tr></thead><tbody>' + r.admins.map(function (a) {
        return '<tr><td><b>' + esc(a.username) + '</b>' + (a.disabled ? ' <span class="pill bad">disabled</span>' : '') + '</td><td>' + esc(ROLE_L[a.role] || a.role) + '</td><td class="muted small">' + (a.role === 'super' ? 'everything' : a.extraPerms.length ? a.extraPerms.map(function (p) { return esc(PERM_L[p] || p); }).join(', ') : '-') + '</td><td>' + (a.lastLogin ? A.ago(a.lastLogin) : 'never') + '</td><td style="text-align:right"><button class="btn sm" data-e="' + a.id + '">Edit</button> <button class="btn sm" data-p="' + a.id + '">Password</button> <button class="btn sm danger" data-d="' + a.id + '">Delete</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="muted small" style="margin-top:10px">Game managers cannot see QR codes unless you grant them QR access under Extra access.</p></div>';
      var byId = {}; r.admins.forEach(function (a) { byId[a.id] = a; });
      $('aAdd').onclick = function () { adminDialog(null, r); };
      $('admBox').onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.e) return adminDialog(byId[b.dataset.e], r);
        if (b.dataset.p) { var a = byId[b.dataset.p]; return A.dialog({ title: 'New password for ' + a.username, confirm: 'Set password', body: '<label class="f">New password (min 10 characters)</label><input id="aPw" type="password" autocomplete="new-password"><p class="muted small" style="margin-top:8px">Their active sessions will be signed out.</p>', onConfirm: function (el) { return A.api('/admin/api/admins/' + a.id + '/password', { password: el.querySelector('#aPw').value }).then(function (x) { if (!x.ok) return A.errText(x); A.toast('Password changed', 'ok'); }); } }); }
        if (b.dataset.d) { var d = byId[b.dataset.d]; return A.confirm('Delete ' + d.username + '?', 'This administrator account is removed permanently.', { confirm: 'Delete', onConfirm: function () { return A.api('/admin/api/admins/' + d.id + '/delete', {}).then(function (x) { if (!x.ok) return A.errText(x); A.toast('Administrator deleted', 'ok'); loadAdmins(); }); } }); }
      };
    });
  }
  function adminDialog(a, r) {
    var edit = !!a;
    A.dialog({ title: edit ? 'Edit ' + a.username : 'Add administrator', confirm: edit ? 'Save' : 'Create', noFocus: false,
      body: (edit ? '' : '<label class="f">Username</label><input id="aU" maxlength="30" autocomplete="off"><label class="f">Password (min 10 characters)</label><input id="aP" type="password" autocomplete="new-password">') +
        '<label class="f">Role</label><select id="aR">' + r.roles.map(function (x) { return '<option value="' + x + '"' + (edit && a.role === x ? ' selected' : '') + '>' + esc(ROLE_L[x] || x) + '</option>'; }).join('') + '</select>' +
        '<label class="f">Extra access (on top of the role)</label><div id="aX">' + permBoxes(r.grantable, edit ? a.extraPerms : []) + '</div>' + (edit ? '<div class="row-sw" style="margin-top:8px"><b>Account disabled</b>' + sw('aDis', a.disabled) + '</div>' : ''),
      onConfirm: function (el) {
        var extra = Array.prototype.map.call(el.querySelectorAll('#aX input:checked'), function (i) { return i.value; });
        var body = { role: el.querySelector('#aR').value, extraPerms: extra };
        var p;
        if (edit) { body.disabled = el.querySelector('#aDis').checked; p = A.api('/admin/api/admins/' + a.id, body, 'PUT'); }
        else { body.username = el.querySelector('#aU').value; body.password = el.querySelector('#aP').value; p = A.api('/admin/api/admins', body); }
        return p.then(function (x) { if (!x.ok) return A.errText(x); A.toast(edit ? 'Administrator updated' : 'Administrator created', 'ok'); loadAdmins(); });
      } });
  }
  function loadAudit() {
    A.api('/admin/api/audit').then(function (r) {
      if (!r.ok || !$('audBox')) return;
      $('audBox').innerHTML = '<div class="card"><h2>Audit log <span class="muted small">last ' + r.audit.length + ' actions</span></h2><div class="tw" style="max-height:420px;overflow:auto"><table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead><tbody>' + r.audit.map(function (x) {
        return '<tr><td>' + A.dt(x.at) + ' <span class="muted small">' + A.tm(x.at) + '</span></td><td>' + esc(x.admin) + '</td><td><span class="pill ' + (/denied|failed|revoke|reset|delete/.test(x.action) ? 'bad' : /qr\./.test(x.action) ? 'or' : '') + '">' + esc(x.action) + '</span></td><td class="muted" style="white-space:normal">' + esc(x.detail) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    });
  }
  function tNotif() {
    var n = sp.data.notifications, ed = A.can('settings.edit');
    $('spane').innerHTML = '<div class="card"><h2>On this device</h2><p class="muted">Sound alerts and browser notifications are switched on or off per device with the speaker and bell buttons in the top bar. Browser notifications only work while this page stays open in the background.</p></div>' +
      '<div class="card"><h2>Phone push (works when this page is closed)</h2><div class="form2"><div><label class="f">ntfy server</label><input id="nS" value="' + esc(n.ntfyServer) + '"' + (ed ? '' : ' disabled') + '></div><div><label class="f">ntfy topic (use a long random name)</label><input id="nT" value="' + esc(n.ntfyTopic) + '" placeholder="mrdood-secret-topic-123"' + (ed ? '' : ' disabled') + '></div><div><label class="f">Telegram bot token</label><input id="nK" type="password" value="' + esc(n.telegramToken) + '" autocomplete="off"' + (ed ? '' : ' disabled') + '></div><div><label class="f">Telegram chat ID</label><input id="nC" value="' + esc(n.telegramChat) + '"' + (ed ? '' : ' disabled') + '></div></div>' +
      '<p class="muted small" style="margin-top:8px">Status: ntfy ' + (n.effective.ntfy ? '<span class="pill ok">on</span>' : '<span class="pill">off</span>') + ' Telegram ' + (n.effective.telegram ? '<span class="pill ok">on</span>' : '<span class="pill">off</span>') + '</p>' + (ed ? '<div style="display:flex;gap:10px;flex-wrap:wrap">' + saveBtn('nSave') + '<button class="btn" id="nTest" style="margin-top:14px">Send test notification</button></div>' : '') + '</div>';
    var s = $('nSave'); if (!s) return;
    s.onclick = function () { A.api('/admin/api/settings/notifications', { ntfyServer: $('nS').value, ntfyTopic: $('nT').value, telegramToken: $('nK').value, telegramChat: $('nC').value }, 'PUT').then(function (r) { A.toast(r.ok ? 'Notification settings saved' : A.errText(r), r.ok ? 'ok' : 'bad'); if (r.ok) sp.render(); }); };
    $('nTest').onclick = function () { A.api('/admin/api/notifications/test', {}).then(function (r) { A.toast(r.ok ? 'ntfy: ' + r.results.ntfy + ' · Telegram: ' + r.results.telegram : A.errText(r), r.ok ? 'ok' : 'bad'); }); };
  }
  function tData() {
    var d = sp.data, ed = A.can('data.manage');
    $('spane').innerHTML =
      '<div class="notice' + (d.persistence === 'file' && d.onRender ? ' bad' : '') + '" style="' + (d.persistence === 'file' && d.onRender ? '' : 'background:rgba(52,209,126,.08);border-color:rgba(52,209,126,.35);color:#9ff0c4') + '">' + ic(d.persistence === 'file' && d.onRender ? 'alert' : 'shield') + '<div>' + (d.persistence === 'upstash' ? '<b>Persistent storage: Upstash Redis.</b> Game data survives restarts and redeploys.' : d.onRender ? '<b>Warning: temporary storage.</b> Render\'s free disk is wiped on every restart or redeploy, so players, scans and winners would be lost. Connect Upstash Redis (see setup guide) before a live event.' : '<b>Storage: local file.</b> Fine for testing on your own computer.') + '</div></div>' +
      '<div class="grid g2"><div class="card"><h2>Backup &amp; restore</h2><p class="muted small">Backups contain players, scans, winners and settings. They never contain QR tokens or administrator accounts.</p>' + (ed ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><a class="btn primary" href="/admin/api/data/backup">' + ic('download') + 'Download backup</a><label class="btn" style="cursor:pointer">Restore from file<input id="dFile" type="file" accept="application/json,.json" hidden></label></div>' : '<p class="muted small">Requires the Data Management permission.</p>') + '</div>' +
      '<div class="card"><h2>Export</h2><p class="muted small">Download every player record as a spreadsheet-friendly CSV file.</p>' + (A.can('players.view') ? '<a class="btn" style="margin-top:12px" href="/admin/api/data/players.csv">' + ic('download') + 'Export player records (CSV)</a>' : '') + '</div></div>' +
      (ed ? '<div class="card" style="border-color:rgba(255,90,77,.4)"><h2>Clear event data</h2><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn danger" id="dClr">Clear activity feed</button><button class="btn danger" id="dRst">Reset entire game</button></div></div>' : '');
    if (!ed) return;
    $('dRst').onclick = resetGame;
    $('dClr').onclick = function () { A.confirm('Clear the activity feed?', 'Removes the live activity history. Players and scores are not affected.', { confirm: 'Clear feed', onConfirm: function () { return A.api('/admin/api/data/clear-log', {}).then(function (r) { if (!r.ok) return A.errText(r); A.feed = []; A.toast('Activity feed cleared', 'ok'); }); } }); };
    $('dFile').onchange = function () {
      var f = this.files[0]; if (!f) return; var inp = this;
      var rd = new FileReader();
      rd.onload = function () {
        var json; try { json = JSON.parse(rd.result); } catch (e) { inp.value = ''; return A.toast('That file is not valid JSON', 'bad'); }
        A.confirm('Restore this backup?', 'This <b>replaces</b> all current players, scans and winners with the backup (' + esc(f.name) + '). QR codes and administrators are not touched.', { type: 'RESTORE', confirm: 'Restore', onConfirm: function () { return A.api('/admin/api/data/restore', { backup: json, confirm: 'RESTORE' }).then(function (r) { if (!r.ok) return A.errText(r); A.toast('Restored ' + r.players + ' players', 'ok'); }); } });
        inp.value = '';
      };
      rd.readAsText(f);
    };
  }

  A.start();
})();
