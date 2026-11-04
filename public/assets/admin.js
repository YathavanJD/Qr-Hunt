(function () {
  'use strict';
  var A = window.A = { pages: {}, cleanup: null, me: null, env: {}, feed: [], unread: 0, page: null };
  var $ = function (id) { return document.getElementById(id); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var esc = A.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  A.$ = $;

  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18.5 14.5c1.9.8 3 2.6 3 5.5"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.5M14 20h3M20 17v4"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
    bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4l2-2zM10 21h4"/>', volume: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>',
    volumeoff: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>', logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
    chevron: '<path d="M15 6l-6 6 6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.5"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 012-2h10"/>',
    print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    play: '<path d="M7 4l13 8-13 8V4z"/>', pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  };
  var ic = A.ic = function (n) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + '</svg>'; };

  // ------------------------------------------------------------ helpers
  var ERR = { auth: 'Please sign in again.', forbidden: 'You do not have permission for that.', confirm_required: 'Confirmation text did not match.', network: 'No connection to the server.', last_super: 'You cannot remove the last super administrator.', self: 'You cannot do that to your own account.', weak_password: 'Use at least 10 characters.', bad_current: 'Current password is incorrect.', exists: 'That username already exists.', bad_username: 'Username: 3-30 letters, numbers . _ -', bad_backup: 'That file is not a valid Mr.DooD backup.', too_many: 'Too many attempts. Try again later.', revoked_regenerate_first: 'This QR is revoked. Regenerate it first.', no_active_qr: 'There are no active QR codes to download.', required: 'Please fill in the required fields.', bad_answer: 'The secret answer needs letters or numbers.', bad_server: 'ntfy server must be an https:// address.' };
  A.errText = function (r) { return ERR[r && r.error] || 'Something went wrong (' + ((r && (r.error || r.status)) || 'error') + ').'; };
  A.can = function (p) { return !!(A.me && A.me.perms.indexOf(p) >= 0); };
  A.api = function (url, body, method) {
    var opt = { credentials: 'same-origin' };
    if (body !== undefined || method) { opt.method = method || 'POST'; opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body || {}); }
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; if (r.status === 401 && url.indexOf('/login') < 0) A.showLogin(); return j; });
    }).catch(function () { return { status: 0, ok: false, error: 'network' }; });
  };
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  A.tm = function (t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  A.dt = function (t) { var d = new Date(t); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  A.dur = function (ms) { var s = Math.round(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? h + 'h ' + (m % 60) + 'm' : m ? m + 'm ' + (s % 60) + 's' : s + 's'; };
  A.ago = function (t) { if (!t) return 'never'; var s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
  A.countUp = function (el, to) {
    if (reduce || !el) { if (el) el.textContent = to; return; }
    var t0 = performance.now(), d = 900;
    (function f(n) { var k = Math.min(1, (n - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e); if (k < 1) requestAnimationFrame(f); })(t0);
  };
  A.toast = function (msg, kind) {
    var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    var box = $('toasts'); box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 320); }, 5200);
  };
  A.dialog = function (o) {
    return new Promise(function (resolve) {
      var m = $('modal');
      m.innerHTML = '<div class="dlg" role="dialog" aria-modal="true"><h2>' + esc(o.title) + '</h2><div>' + (o.body || '') + '</div><div class="err" id="dErr"></div><div class="acts">' +
        (o.cancel === false ? '' : '<button class="btn" id="dNo">' + esc(o.cancel || 'Cancel') + '</button>') +
        (o.confirm ? '<button class="btn ' + (o.danger ? 'danger' : 'primary') + '" id="dYes">' + esc(o.confirm) + '</button>' : '') + '</div></div>';
      m.classList.add('open');
      var el = m.firstChild;
      function close(v) { m.classList.remove('open'); m.innerHTML = ''; document.removeEventListener('keydown', key); resolve(v); }
      function key(e) { if (e.key === 'Escape') close(false); }
      document.addEventListener('keydown', key);
      m.onmousedown = function (e) { if (e.target === m) close(false); };
      var no = $('dNo'); if (no) no.onclick = function () { close(false); };
      var yes = $('dYes');
      if (yes) yes.onclick = function () {
        if (!o.onConfirm) return close(true);
        yes.disabled = true;
        Promise.resolve(o.onConfirm(el)).then(function (err) { yes.disabled = false; if (err) $('dErr').textContent = err; else close(true); });
      };
      if (o.onOpen) o.onOpen(el, close);
      var f = el.querySelector('input,textarea,select'); if (f && !o.noFocus) setTimeout(function () { f.focus(); }, 60);
    });
  };
  /** Confirmation dialog. opts.type = text the admin must type (for destructive actions). */
  A.confirm = function (title, text, opts) {
    opts = opts || {};
    return A.dialog({
      title: title, confirm: opts.confirm || 'Confirm', danger: opts.danger !== false,
      body: '<p class="muted">' + text + '</p>' + (opts.type ? '<label class="f">Type <b>' + esc(opts.type) + '</b> to confirm</label><input id="cType" autocomplete="off">' : ''),
      onConfirm: function (el) {
        if (opts.type && el.querySelector('#cType').value !== opts.type) return 'Please type ' + opts.type + ' exactly.';
        return opts.onConfirm ? opts.onConfirm(el) : undefined;
      },
    });
  };

  // ------------------------------------------------------------ charts (pure SVG, animated)
  A.lineChart = function (tl) {
    var W = 640, H = 240, L = 34, B = 26, T = 12, R = 10, n = tl.labels.length;
    var max = Math.max(4, Math.max.apply(null, tl.scans.concat(tl.regs))); max = Math.ceil(max / 4) * 4;
    var x = function (i) { return L + (i * (W - L - R)) / (n - 1); }, y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var line = function (d) { return d.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(''); };
    var g = '';
    for (var k = 0; k <= 4; k++) { var v = (max / 4) * k; g += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>'; }
    for (var i = 0; i < n; i += 6) g += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + pad(new Date(tl.labels[i]).getHours()) + ':' + pad(new Date(tl.labels[i]).getMinutes()) + '</text>';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scan and registration activity over time"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a00" stop-opacity=".35"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/></linearGradient></defs>' + g +
      '<path class="ar" d="' + line(tl.scans) + 'L' + x(n - 1) + ' ' + y(0) + 'L' + x(0) + ' ' + y(0) + 'Z" fill="url(#ga)"/>' +
      '<path class="ln" pathLength="1" d="' + line(tl.regs) + '" stroke="#58a6ff"/><path class="ln" pathLength="1" d="' + line(tl.scans) + '" stroke="#ff8a1f"/></svg>';
  };
  A.barChart = function (items) {
    var W = 640, H = 220, L = 28, B = 34, T = 22, n = items.length, bw = (W - L - 10) / n;
    var max = Math.max(4, Math.max.apply(null, items.map(function (i) { return i.scans; }))); max = Math.ceil(max / 4) * 4;
    var s = '';
    items.forEach(function (it, i) {
      var h = (H - T - B) * (it.scans / max), x0 = L + i * bw + bw * 0.18, w = bw * 0.64;
      s += '<rect class="bar" style="animation-delay:' + (i * 70) + 'ms" x="' + x0.toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(h, 2).toFixed(1) + '" rx="7" fill="' + (it.active ? '#ff7a10' : '#4a4a55') + '"/>' +
        '<text x="' + (x0 + w / 2) + '" y="' + (H - B - h - 6) + '" text-anchor="middle" style="fill:#fff;font-weight:700">' + it.scans + '</text>' +
        '<text x="' + (x0 + w / 2) + '" y="' + (H - 12) + '" text-anchor="middle">QR ' + it.slot + '</text>';
    });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Players who scanned each QR">' + s + '</svg>';
  };
  A.donut = function (pct) {
    return '<svg class="donut" width="170" height="170" viewBox="0 0 130 130" role="img" aria-label="Completion ' + pct + ' percent"><circle cx="65" cy="65" r="52" fill="none" stroke="#2a2a33" stroke-width="12"/><circle class="v" id="dv" data-p="' + pct + '" cx="65" cy="65" r="52" fill="none" stroke="url(#dg)" stroke-width="12" stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="326.7" transform="rotate(-90 65 65)"/><defs><linearGradient id="dg"><stop offset="0" stop-color="#ffb040"/><stop offset="1" stop-color="#ff6a00"/></linearGradient></defs><text x="65" y="72" text-anchor="middle" style="fill:#fff;font-size:24px;font-weight:800">' + pct + '%</text></svg>';
  };
  A.animateDonut = function () { var v = $('dv'); if (v) requestAnimationFrame(function () { requestAnimationFrame(function () { v.style.strokeDashoffset = String(326.7 * (1 - Number(v.dataset.p) / 100)); }); }); };
  A.empty = function (icon, msg) { return '<div class="empty">' + ic(icon) + '<div>' + esc(msg) + '</div></div>'; };
  A.skeleton = function () { return '<div class="skel"></div><div class="skel" style="height:260px"></div>'; };

  // ------------------------------------------------------------ sound + notifications
  var soundOn = localStorage.getItem('mdSound') !== '0', notifOn = localStorage.getItem('mdNotif') === '1', audio = null, titleBase = 'Mr.DooD Control Center';
  function ensureAudio() { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { /* no audio */ } }
  function tone(f, t0, d, v) { if (!audio) return; var o = audio.createOscillator(), g = audio.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = v || .15; g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + t0 + d); o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + t0); o.stop(audio.currentTime + t0 + d); }
  function beep(k) {
    if (!soundOn) return; ensureAudio();
    if (k === 'scan') { tone(880, 0, .15); tone(1175, .15, .2); } else if (k === 'win') { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * .14, .3, .2); }); }
    else if (k === 'bad') { tone(300, 0, .2, .22); tone(300, .28, .2, .22); } else tone(660, 0, .1, .1);
  }
  function setBtnStates() {
    $('bSound').innerHTML = ic(soundOn ? 'volume' : 'volumeoff'); $('bSound').classList.toggle('on', soundOn);
    $('bNotif').innerHTML = ic('bell'); $('bNotif').classList.toggle('on', notifOn && window.Notification && Notification.permission === 'granted');
  }
  $('bSound').onclick = function () { soundOn = !soundOn; localStorage.setItem('mdSound', soundOn ? '1' : '0'); ensureAudio(); if (soundOn) beep('scan'); setBtnStates(); A.toast(soundOn ? 'Sound alerts on' : 'Sound alerts off'); };
  $('bNotif').onclick = function () {
    ensureAudio();
    if (!window.Notification) return A.toast('This browser cannot show notifications. Use ntfy or Telegram in Settings.', 'bad');
    if (notifOn && Notification.permission === 'granted') { notifOn = false; localStorage.setItem('mdNotif', '0'); setBtnStates(); return A.toast('Browser notifications off'); }
    Notification.requestPermission().then(function (p) { notifOn = p === 'granted'; localStorage.setItem('mdNotif', notifOn ? '1' : '0'); setBtnStates(); A.toast(notifOn ? 'Browser notifications enabled' : 'Notifications are blocked in your browser settings', notifOn ? 'ok' : 'bad'); });
  };

  // ------------------------------------------------------------ live stream
  var es = null, refreshT = null;
  A.connect = function () {
    if (!A.can('live.view')) { $('conn').textContent = 'offline'; return; }
    if (es) es.close();
    es = new EventSource('/admin/api/stream');
    es.onopen = function () { $('dot').className = 'dot'; $('conn').textContent = 'live'; };
    es.onerror = function () { $('dot').className = 'dot off'; $('conn').textContent = 'reconnecting...'; };
    es.onmessage = function (e) { try { A.onEvent(JSON.parse(e.data)); } catch (err) { /* ignore */ } };
  };
  A.onEvent = function (ev) {
    A.feed.push(ev); if (A.feed.length > 300) A.feed.shift();
    var p = A.pages[A.page];
    if (p && p.onFeed) p.onFeed(ev);
    var kind = ev.type === 'win' ? 'win' : (ev.type === 'invalid' || ev.type === 'suspicious') ? 'bad' : ev.type === 'scan' ? 'ok' : '';
    if (!ev.quiet || ev.type === 'game') {
      if (ev.type !== 'dup') A.toast((ev.type === 'win' ? '🏆 ' : ev.type === 'scan' ? '📱 ' : ev.type === 'suspicious' ? '⚠️ ' : '') + ev.text, kind);
      beep(ev.type === 'win' ? 'win' : kind === 'bad' ? 'bad' : ev.type === 'scan' ? 'scan' : 'reg');
    }
    if (document.hidden) {
      A.unread++; document.title = '(' + A.unread + ') ' + titleBase;
      if (notifOn && window.Notification && Notification.permission === 'granted' && ev.type !== 'dup') { try { new Notification(ev.type === 'win' ? 'We have a winner!' : 'Mr.DooD', { body: ev.text, tag: 'mrdood' }); } catch (e) { /* blocked */ } }
    }
    if (A.page !== 'live') { var nb = document.querySelector('[data-nav="live"] .badge'); if (nb && ev.type !== 'dup') { nb.textContent = (Number(nb.textContent) || 0) + 1; nb.style.display = ''; } }
    clearTimeout(refreshT);
    refreshT = setTimeout(function () { var pg = A.pages[A.page]; if (pg && pg.refresh) pg.refresh(); }, 500);
  };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { A.unread = 0; document.title = titleBase; } });

  // ------------------------------------------------------------ shell + routing
  var NAV = [
    { id: 'overview', label: 'Overview', perm: 'stats.view', icon: 'grid' },
    { id: 'live', label: 'Live Activity', perm: 'live.view', icon: 'pulse' },
    { id: 'players', label: 'Players', perm: 'players.view', icon: 'users' },
    { id: 'winners', label: 'Winners', perm: 'winners.view', icon: 'trophy' },
    { id: 'qr', label: 'QR Management', perm: 'qr.view', icon: 'qr' },
    { id: 'game', label: 'Game Controls', perm: 'game.control', icon: 'sliders' },
    { id: 'settings', label: 'Settings', perm: 'settings.view', icon: 'gear' },
  ];
  A.NAV = NAV;
  function renderSide() {
    var items = NAV.filter(function (n) { return A.can(n.perm); });
    $('side').innerHTML = '<div class="brand"><img src="/assets/logo.png" alt=""><span>Mr.DooD<small>Control Center</small></span></div><nav>' +
      items.map(function (n) { return '<a data-nav="' + n.id + '" href="#/' + n.id + '" title="' + esc(n.label) + '">' + ic(n.icon) + '<span class="lbl">' + esc(n.label) + '</span>' + (n.id === 'live' ? '<span class="badge" style="display:none">0</span>' : '') + '</a>'; }).join('') + '</nav>' +
      '<div class="side-foot"><div class="who"><div class="av">' + esc(A.me.username[0].toUpperCase()) + '</div><div><b>' + esc(A.me.username) + '</b><small>' + esc(A.me.role === 'qr' ? 'QR manager' : A.me.role === 'manager' ? 'Game manager' : 'Super admin') + '</small></div></div>' +
      '<div style="display:flex;gap:8px"><button class="btn sm" id="bCol" title="Collapse menu" style="flex:1;justify-content:center">' + ic('chevron') + '</button><button class="btn sm" id="bOut" title="Sign out" style="flex:2;justify-content:center">' + ic('logout') + '<span class="lbl">Sign out</span></button></div></div>';
    $('bCol').onclick = function () { $('shell').classList.toggle('collapsed'); localStorage.setItem('mdCol', $('shell').classList.contains('collapsed') ? '1' : '0'); };
    $('bOut').onclick = function () { A.api('/admin/api/logout', {}).then(function () { if (es) es.close(); A.me = null; A.showLogin(); }); };
  }
  A.go = function (id) { location.hash = '#/' + id; };
  A.render = function () {
    if (!A.me) return;
    var allowed = NAV.filter(function (n) { return A.can(n.perm); });
    var id = (location.hash || '').replace('#/', '');
    if (!allowed.some(function (n) { return n.id === id; })) id = allowed.length ? allowed[0].id : null;
    if (A.cleanup) { try { A.cleanup(); } catch (e) { /* ignore */ } A.cleanup = null; }
    $('shell').classList.remove('menu');
    if (!id) { $('view').innerHTML = A.empty('lock', 'Your account has no permissions yet. Ask a super administrator.'); return; }
    A.page = id;
    var nav = NAV.filter(function (n) { return n.id === id; })[0];
    $('ptitle').textContent = nav.label;
    document.querySelectorAll('nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.nav === id); });
    if (id === 'live') { var nb = document.querySelector('[data-nav="live"] .badge'); if (nb) { nb.textContent = '0'; nb.style.display = 'none'; } }
    var view = $('view'); view.onclick = null; view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
    view.innerHTML = A.skeleton();
    A.pages[id].render();
  };
  window.addEventListener('hashchange', A.render);
  $('burger').innerHTML = ic('menu'); $('burger').onclick = function () { $('shell').classList.add('menu'); };
  $('bd').onclick = function () { $('shell').classList.remove('menu'); };

  A.showLogin = function () {
    if (es) es.close();
    $('shell').classList.add('hidden'); $('login').classList.remove('hidden'); $('lp').value = ''; setTimeout(function () { $('lp').focus(); }, 50);
  };
  function doLogin() {
    ensureAudio(); $('lerr').textContent = '';
    var b = $('lbtn'); b.disabled = true;
    A.api('/admin/api/login', { username: $('lu').value, password: $('lp').value }).then(function (r) {
      b.disabled = false;
      if (r.status === 429) { $('lerr').textContent = 'Too many attempts. Please wait before trying again.'; return; }
      if (!r.ok) { $('lerr').textContent = 'Wrong username or password.'; return; }
      A.boot();
    });
  }
  $('lbtn').onclick = doLogin;
  $('lp').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };

  A.boot = function () {
    A.api('/admin/api/me').then(function (r) {
      if (r.status !== 200) return A.showLogin();
      A.me = r.me; A.env = r.env || {};
      $('login').classList.add('hidden'); $('shell').classList.remove('hidden');
      if (localStorage.getItem('mdCol') === '1') $('shell').classList.add('collapsed');
      renderSide(); setBtnStates();
      var pre = A.can('live.view') ? A.api('/admin/api/activity').then(function (a) { A.feed = (a.log || []).slice(); }) : Promise.resolve();
      pre.then(function () { A.connect(); A.render(); });
    });
  };
  A.start = function () { A.boot(); };
  A.pad = pad;
  A.setRefresh = function (id, fn) { A.pages[id].refresh = fn; };
})();
