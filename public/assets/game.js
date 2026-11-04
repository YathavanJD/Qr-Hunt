(function () {
  'use strict';
  var app = document.getElementById('app');
  var cfg = { title: 'Mr.DooD QR Hunt', brand: 'Mr.DooD', description: '', eventInfo: '', total: 7 };
  var timers = [];
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, reduce ? Math.min(ms, 80) : ms); }); };
  var ICON = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    scan: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M4 12h16"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.5"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };
  var ic = function (n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; };

  function api(url, body) {
    var opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; });
    }).catch(function () { return { status: 0, ok: false, error: 'network' }; });
  }
  function clearTimers() { timers.forEach(clearInterval); timers = []; }
  function screen(html) {
    clearTimers();
    app.innerHTML = '<section class="screen">' + html + '</section>';
    window.scrollTo(0, 0);
  }
  function brand() { return '<div class="brand"><img src="/assets/logo.png" alt="" width="36" height="44"><b>' + esc(cfg.brand) + '</b></div>'; }
  function fmt(ms) { var s = Math.round(ms / 1000), m = Math.floor(s / 60); return m ? m + 'm ' + (s % 60) + 's' : s + 's'; }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function setBusy(btn, busy, label) { btn.disabled = busy; btn.innerHTML = busy ? '<span class="btn-spin"></span>' + esc(label) : esc(label); }
  function loading() { screen('<div class="card skel"><i></i><i></i><i></i></div>'); }

  // ------------------------------------------------------------ message screens
  var MSG = {
    invalid: ['ban', 'Not an official QR code', 'This QR code is not part of the official Mr.DooD hunt. Look for the genuine cards placed around the venue.'],
    revoked: ['ban', 'This QR code has expired', 'The organisers replaced or withdrew this QR code. Please find the current official card.'],
    inactive: ['pause', 'QR temporarily unavailable', 'This QR code is switched off right now. Try another card and come back later.', 'warn'],
    paused: ['pause', 'The hunt is paused', 'The organisers have paused the game. Hang tight, it will be back soon!', 'warn'],
    not_started: ['pause', 'The hunt has not started yet', 'Get ready! Your scans will count as soon as the organisers start the game.', 'warn'],
    scanning_closed: ['pause', 'Scanning is closed', 'Scanning is switched off at the moment. Please check with the organisers.', 'warn'],
    registration_closed: ['pause', 'Registration is closed', 'New players cannot join right now. Please ask the organisers.', 'warn'],
    dq: ['ban', 'You were removed from the hunt', 'Please speak to the organisers if you think this is a mistake.'],
    slow_down: ['alert', 'Too many tries', 'Please wait a moment and try again.', 'warn'],
    too_fast: ['alert', 'Slow down, hunter!', 'You scanned too quickly after your last card. Wait a few seconds and scan again.', 'warn'],
    network: ['alert', 'No connection', 'Check your internet and try again.', 'warn'],
    server: ['alert', 'Something went wrong', 'Please try again in a moment.', 'warn'],
  };
  function message(code, extra) {
    var m = MSG[code] || MSG.server;
    var text = m[2] + (code === 'too_fast' && extra && extra.wait ? ' (about ' + extra.wait + 's)' : '');
    screen(brand() + '<div class="card errscreen"><div class="eico ' + (m[3] || '') + '">' + ic(m[0]) + '</div><h2>' + esc(m[1]) + '</h2><p class="muted" style="margin-top:10px">' + esc(text) + '</p><button id="back" class="ghost">Back to the game</button></div>');
    document.getElementById('back').onclick = function () { home(); };
  }

  // ------------------------------------------------------------ welcome + register
  function welcome() {
    var closed = cfg.status !== 'live';
    screen('<div class="hero"><div class="logo"><img src="/assets/logo.png" alt="Mr.DooD"></div>' +
      '<span class="eyebrow">' + esc(cfg.eventInfo || 'QR scan hunt') + '</span><h1>' + esc(cfg.title) + '</h1><p>' + esc(cfg.description) + '</p></div>' +
      (cfg.status === 'paused' ? '<div class="banner">' + ic('pause').replace('<svg', '<svg width="22" height="22" style="stroke:#ffd98a;fill:none;stroke-width:2"') + 'The hunt is paused right now.</div>' : '') +
      (cfg.status === 'not_started' ? '<div class="banner">Coming soon: the hunt has not started yet.</div>' : '') +
      '<div class="steps"><div class="step">' + ic('search') + '<b>Find</b>7 hidden QR cards</div><div class="step">' + ic('scan') + '<b>Scan</b>with your camera</div><div class="step">' + ic('trophy') + '<b>Win</b>crack the word</div></div>' +
      '<button id="start" class="shine">Start the hunt</button>');
    document.getElementById('start').onclick = function () { if (!cfg.registrationOpen) return message('registration_closed'); register(null); };
    void closed;
  }
  function register(pendingToken) {
    screen(brand() + '<div class="card"><span class="eyebrow">' + (pendingToken ? 'One quick step' : 'Player registration') + '</span><h2>What should we call you?</h2><p class="muted" style="margin:8px 0 18px">' + (pendingToken ? 'Enter your name and your scan will be counted right away.' : 'Your name appears on the leaderboard and the organisers\' screen.') + '</p>' +
      '<label for="nm">Your name</label><input id="nm" type="text" maxlength="24" placeholder="e.g. Shya" autocomplete="nickname" autocapitalize="words" enterkeyhint="go"><div id="err" class="err" role="alert"></div>' +
      '<button id="go" class="shine">' + (pendingToken ? 'Save name & reveal' : "Let's go") + '</button></div>');
    var inp = document.getElementById('nm'), err = document.getElementById('err'), btn = document.getElementById('go');
    var label = btn.textContent;
    var NAME_ERR = { name_short: 'Please use at least 2 characters.', name_invalid: 'Use letters, numbers and spaces only.', name_taken: 'That name is already taken. Add something to make it yours.', registration_closed: 'Registration is closed right now.', slow_down: 'Too many tries, wait a moment.' };
    function submit() {
      var name = inp.value.trim();
      inp.classList.remove('bad'); err.textContent = '';
      if (name.length < 2) { inp.classList.add('bad'); err.textContent = NAME_ERR.name_short; return; }
      setBusy(btn, true, 'Saving...');
      api('/api/register', { name: name }).then(function (r) {
        if (r.ok) return pendingToken ? scan(pendingToken) : home();
        setBusy(btn, false, label); inp.classList.add('bad');
        err.textContent = NAME_ERR[r.error] || 'Something went wrong. Try again.';
      });
    }
    btn.onclick = submit;
    inp.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
    setTimeout(function () { inp.focus(); }, 300);
  }

  // ------------------------------------------------------------ hunt screen
  function slotsHtml(slots, newSlot, pop) {
    return '<div class="slots">' + slots.map(function (s, i) {
      return '<div class="slot' + (s.collected ? ' on' : '') + (s.slot === newSlot ? ' new' : '') + (pop ? ' pop' : '') + '" style="--i:' + i + '" aria-label="Slot ' + s.slot + (s.collected ? ' collected' : ' locked') + '">' +
        ic('lock') + '<span class="ltr">' + (s.collected ? esc(s.letter) : '') + '</span><small>' + s.slot + '/7</small></div>';
    }).join('') + '</div>';
  }
  function ringHtml(count, total) {
    return '<div class="ring"><svg viewBox="0 0 104 104"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb040"/><stop offset="1" stop-color="#ff6a00"/></linearGradient></defs><circle class="t" cx="52" cy="52" r="46"/><circle class="v" id="rv" cx="52" cy="52" r="46" data-p="' + (count / total) + '"/></svg><b id="rc">' + count + '/' + total + '</b></div>';
  }
  function animateRing() {
    var v = document.getElementById('rv'); if (!v) return;
    requestAnimationFrame(function () { requestAnimationFrame(function () { v.style.strokeDashoffset = String(289 * (1 - Number(v.dataset.p))); }); });
  }
  function hunt(me, opts) {
    opts = opts || {};
    var all = me.count >= me.total;
    var paused = me.status !== 'live';
    screen('<div class="top"><div class="brand" style="margin:0;justify-content:flex-start"><img src="/assets/logo.png" alt="" width="28" height="34"><b style="font-size:20px">' + esc(cfg.brand) + '</b></div><div class="chip">' + esc(me.name) + '</div></div>' +
      (paused ? '<div class="banner">' + (me.status === 'paused' ? 'The hunt is paused. Scans are on hold.' : 'The hunt has not started yet.') + '</div>' : '') +
      (opts.complete ? '<div class="card center" style="border-color:var(--o)"><span class="eyebrow">All seven unlocked</span><h2>You collected every letter!</h2><p class="muted" style="margin-top:6px">One last step: crack the secret word.</p></div>' : '') +
      '<div class="card"><div class="prog">' + ringHtml(me.count, me.total) + '<div><h2>' + (all ? 'Complete!' : me.count ? 'Keep going!' : 'Ready to hunt') + '</h2><p class="muted" style="margin-top:4px">' + (all ? 'Solve the secret word below.' : (me.total - me.count) + ' letter' + (me.total - me.count === 1 ? '' : 's') + ' still hidden.') + '</p></div></div>' +
      slotsHtml(me.slots, opts.newSlot, !opts.newSlot) + '</div>' +
      (all ? '<div class="card"><span class="eyebrow">Final challenge</span><h2>What is the secret word?</h2><p class="muted" style="margin:6px 0 14px">Put the seven letters together.</p><input id="ans" type="text" maxlength="20" placeholder="Type the word" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><div id="err" class="err" role="alert"></div><button id="sub" class="shine">Claim victory</button></div>'
        : '<div class="card hint">' + ic('scan') + '<div><b>How to scan</b><p class="muted">Open your phone camera, point it at an official Mr.DooD QR card and tap the link.</p></div></div>') +
      '<div class="card"><h3>Leaderboard</h3><div id="lb" class="muted">Loading...</div></div>');
    animateRing();
    if (opts.complete) { FX.confetti(2500); }
    if (all) {
      var ans = document.getElementById('ans'), err = document.getElementById('err'), btn = document.getElementById('sub');
      var submit = function () {
        if (!ans.value.trim()) return;
        setBusy(btn, true, 'Checking...'); err.textContent = ''; ans.classList.remove('bad');
        api('/api/submit', { answer: ans.value }).then(function (r) {
          if (r.ok) { FX.confetti(5000); return home(); }
          setBusy(btn, false, 'Claim victory');
          ans.classList.add('bad'); void ans.offsetWidth;
          err.textContent = r.error === 'locked' ? 'Too many wrong answers. Try again in ' + Math.ceil((r.wait || 600) / 60) + ' min.' : r.status === 429 ? 'Too many tries, wait a few seconds.' : r.status === 403 ? 'The hunt is paused right now.' : 'Not quite! Think about the letters again.';
        });
      };
      btn.onclick = submit; ans.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
    }
    loadLb(); timers.push(setInterval(function () { loadLb(); }, 15000));
  }
  function loadLb() {
    var el = document.getElementById('lb');
    if (!el) return;
    api('/api/leaderboard').then(function (r) {
      if (r.status !== 200 || !document.getElementById('lb')) return;
      var h = '';
      if (r.winners.length) h += '<ul class="lb">' + r.winners.map(function (w) { return '<li><span>' + (w.rank === 1 ? '🥇' : w.rank === 2 ? '🥈' : w.rank === 3 ? '🥉' : '#' + w.rank) + ' ' + esc(w.name) + '</span><b>' + fmt(w.ms) + '</b></li>'; }).join('') + '</ul>';
      if (r.hunters.length) h += '<p class="muted" style="margin:12px 0 4px">Still hunting</p><ul class="lb">' + r.hunters.map(function (w) { return '<li><span>' + esc(w.name) + '</span><b>' + w.count + '/7</b></li>'; }).join('') + '</ul>';
      document.getElementById('lb').innerHTML = h || 'Nobody has scored yet. Be the first!';
    });
  }

  // ------------------------------------------------------------ win screen
  function win(me) {
    var w = me.won;
    screen('<div class="card center"><svg class="trophy" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4"/></svg>' +
      '<span class="eyebrow">Hunt complete</span><div class="rank">' + esc(ord(w.rank)) + '</div><h2 style="margin-top:6px">place, ' + esc(me.name) + '!</h2>' +
      '<p class="muted" style="margin-top:8px">You cracked the secret word in <b style="color:#fff">' + fmt(w.ms) + '</b>.</p>' +
      (w.prize ? '<p class="muted" style="margin-top:14px">Show this claim code to an organiser to collect your prize:</p>' : '<p class="muted" style="margin-top:14px">The prize limit has been reached, but you made the leaderboard! Show this code to an organiser to confirm your finish:</p>') +
      '<div class="code" id="code">' + esc(w.code) + '</div><button id="copy" class="ghost" style="margin-top:6px">Copy code</button></div>' +
      '<div class="card"><h3>Leaderboard</h3><div id="lb" class="muted">Loading...</div></div>');
    document.getElementById('copy').onclick = function () {
      var b = this;
      var done = function () { b.textContent = 'Copied!'; setTimeout(function () { b.textContent = 'Copy code'; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(w.code).then(done, function () { }); else done();
    };
    FX.confetti(6000); FX.burst(innerWidth / 2, innerHeight * 0.25, 70);
    loadLb(); timers.push(setInterval(loadLb, 15000));
  }

  // ------------------------------------------------------------ scan experience
  function verifying() {
    screen('<div class="verify"><div class="vring" id="vr"><svg viewBox="0 0 130 130"><circle class="bg" cx="65" cy="65" r="56"/><circle class="sp" cx="65" cy="65" r="56"/><path class="ck" d="M40 67l17 17 33-37"/></svg></div><h2>Verifying QR code...</h2><p class="muted" style="margin-top:8px">Checking with the Mr.DooD server</p></div>');
  }
  function preload(src) {
    return new Promise(function (resolve) {
      var im = new Image(); var t = setTimeout(function () { resolve(); }, 6000);
      im.onload = im.onerror = function () { clearTimeout(t); resolve(); };
      im.src = src;
    });
  }
  function scan(tok) {
    verifying();
    var t0 = Date.now();
    return api('/api/scan', { token: tok }).then(function (r) {
      return sleep(Math.max(0, 900 - (Date.now() - t0))).then(function () { return r; });
    }).then(function (r) {
      if (r.status === 401 && r.error === 'register') return register(tok);
      if (!r.ok) return message(r.status === 0 ? 'network' : r.error, r);
      var pre = preload('/api/letter/' + r.n + '.jpg');
      var vr = document.getElementById('vr');
      if (vr) vr.classList.add('done');
      if (!r.duplicate) FX.burst(innerWidth / 2, innerHeight * 0.36, 45);
      return Promise.all([pre, sleep(900)]).then(function () { return api('/api/me'); }).then(function (me) { reveal(r, me); });
    });
  }
  function reveal(r, me) {
    var left = r.total - r.count;
    var slots = me.slots || [];
    screen('<div class="reveal"><div class="rays" aria-hidden="true"></div>' + brand() +
      '<span class="okbadge' + (r.duplicate ? ' dup' : '') + '">' + (r.duplicate ? 'ALREADY COLLECTED' : 'VERIFIED &#10003;') + '</span>' +
      '<h2 style="margin-top:12px">' + (r.duplicate ? 'You already have this one' : 'Letter unlocked!') + '</h2>' +
      '<div class="frame"><img id="li" alt="Revealed letter ' + esc(r.letter) + '" src="/api/letter/' + r.n + '.jpg"></div>' +
      slotsHtml(slots, r.duplicate ? 0 : r.n, false).replace('class="slots"', 'class="slots" style="transform:scale(.8);margin:0"') +
      '<p class="count"><b>' + r.count + '</b> / ' + r.total + ' letters' + (r.duplicate ? ' (no extra progress)' : '') + '</p>' +
      '<p class="muted" style="margin-top:6px">' + (left > 0 ? left + ' more to find.' : 'You have them all!') + '</p>' +
      '<button id="cont" class="shine">' + (left > 0 ? 'Continue the hunt' : 'Solve the secret word') + '</button></div>');
    var li = document.getElementById('li');
    var show = function () { li.classList.add('in'); if (!r.duplicate) setTimeout(function () { var b = li.getBoundingClientRect(); FX.burst(b.left + b.width / 2, b.top + b.height / 2, 60); }, 500); };
    if (li.complete) show(); else { li.onload = show; li.onerror = show; }
    document.getElementById('cont').onclick = function () { home({ complete: left === 0 && !r.duplicate }); };
  }

  // ------------------------------------------------------------ home router
  function home(opts) {
    loading();
    var p = cfg.loaded ? Promise.resolve() : api('/api/config').then(function (c) { if (c.ok) { Object.assign(cfg, c, { loaded: true }); document.title = c.title; } });
    return p.then(function () { return api('/api/me'); }).then(function (me) {
      if (me.status === 401) return welcome();
      if (me.status !== 200) return message('network');
      if (me.dq) return message('dq');
      if (me.won) return win(me);
      hunt(me, opts);
    });
  }

  // ------------------------------------------------------------ boot
  var m = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
  if (m) {
    var tok = m[1];
    history.replaceState(null, '', '/');
    api('/api/config').then(function (c) { if (c.ok) { Object.assign(cfg, c, { loaded: true }); document.title = c.title; } }).then(function () { scan(tok); });
  } else home();
})();
