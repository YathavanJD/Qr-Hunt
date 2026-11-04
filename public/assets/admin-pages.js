(function () {
  'use strict';
  var A = window.A, $ = A.$, esc = A.esc, ic = A.ic;
  var view = function () { return $('view'); };
  var PILL = { dq: ['bad', 'Disqualified'], winner: ['ok', 'Winner'], finished: ['or', 'Finished all 7'], hunting: ['blue', 'Hunting'], registered: ['', 'Registered'] };
  function dots(slots, total) {
    var h = '<span class="dots" title="' + slots.length + '/' + total + ' letters">';
    for (var i = 1; i <= total; i++) h += '<i class="' + (slots.indexOf(i) >= 0 ? 'on' : '') + '"></i>';
    return h + '</span> <span class="muted small">' + slots.length + '/' + total + '</span>';
  }
  function statusPill(p) { var s = PILL[p.status] || ['', p.status]; return '<span class="pill ' + s[0] + '">' + s[1] + '</span>' + (p.suspicious ? ' <span class="pill warn">' + ic('alert').replace('class="i"', 'class="i" width="12" height="12"') + ' ' + p.flags + ' fast</span>' : ''); }
  function errView(r) { view().innerHTML = '<div class="card">' + A.empty('alert', A.errText(r)) + '</div>'; }

  // ============================================================ OVERVIEW
  var ov = A.pages.overview = { last: null };
  function ovLoad(first) {
    A.api('/admin/api/overview').then(function (r) {
      if (!r.ok) return errView(r);
      if (A.page !== 'overview') return;
      first ? ovDraw(r) : ovUpdate(r);
      ov.last = r;
    });
  }
  ov.render = function () { ovLoad(true); };
  ov.refresh = function () { ovLoad(false); };
  var STATS = [['players', 'Registered players', 'users', ''], ['scans', 'Successful QR scans', 'qr', ''], ['completed', 'Completed all 7', 'check', 'ok'], ['winners', 'Winners', 'trophy', 'ok'],
    ['active', 'Active players', 'pulse', ''], ['disqualified', 'Disqualified', 'lock', ''], ['suspicious', 'Suspicious events', 'alert', 'warn'], ['completion', 'Game completion', 'sliders', '']];
  function statusChip(g) { return g.status === 'live' ? '<span class="pill ok">● Game live</span>' : g.status === 'paused' ? '<span class="pill warn">❚❚ Paused</span>' : '<span class="pill">Not started</span>'; }
  function slotBars(r) {
    var tp = Math.max(1, r.stats.players);
    return r.perSlot.map(function (s) {
      return '<div class="slotbar"><span><b>QR ' + s.slot + '</b></span><div class="tr"><i data-w="' + Math.round((s.scans / tp) * 100) + '"></i></div><span class="muted small" style="text-align:right">' + s.scans + ' / ' + r.stats.players + (s.revoked ? ' · revoked' : !s.active ? ' · off' : '') + '</span></div>';
    }).join('');
  }
  function ovDraw(r) {
    var g = r.game;
    view().innerHTML =
      '<div class="toolbar"><div id="ovStatus">' + statusChip(g) + (g.registrationOpen ? '' : ' <span class="pill warn">Registration closed</span>') + (g.scanningOpen ? '' : ' <span class="pill warn">Scanning closed</span>') + '</div><span class="sp"></span>' +
      (A.can('game.control') ? '<button class="btn" id="ovToggle">' + ic(g.status === 'live' ? 'pause' : 'play') + (g.status === 'live' ? 'Pause game' : 'Start / resume game') + '</button>' : '') + '<button class="btn" id="ovRef">' + ic('refresh') + 'Refresh</button></div>' +
      '<div class="grid g4" style="margin-bottom:18px">' + STATS.map(function (s, i) { return '<div class="stat ' + s[3] + '" style="animation-delay:' + i * 50 + 'ms"><small>' + ic(s[2]) + s[1] + '</small><b data-k="' + s[0] + '">0</b></div>'; }).join('') + '</div>' +
      '<div class="grid g21"><div class="card"><h2>Activity over time <span class="legend"><span><i style="background:#ff8a1f"></i>Scans</span><span><i style="background:#58a6ff"></i>Registrations</span></span></h2><div id="cLine">' + A.lineChart(r.timeline) + '</div></div>' +
      '<div class="card"><h2>Overall completion</h2><div id="cDon">' + A.donut(r.stats.completion) + '</div><p class="muted small" style="text-align:center;margin-top:10px">' + r.stats.scans + ' of ' + r.stats.players * 7 + ' possible letters collected</p></div></div>' +
      '<div class="grid g2"><div class="card"><h2>Players who scanned each QR</h2><div id="cBar">' + A.barChart(r.perSlot) + '</div></div>' +
      '<div class="card"><h2>Seven-QR progress overview</h2><div id="cSlots">' + slotBars(r) + '</div><p class="muted small" style="margin-top:8px">Counts only. QR codes and links are managed in QR Management.</p></div></div>';
    STATS.forEach(function (s) { var el = view().querySelector('[data-k="' + s[0] + '"]'); A.countUp(el, r.stats[s[0]]); if (s[0] === 'completion') setTimeout(function () { el.textContent = r.stats.completion + '%'; }, 950); });
    A.animateDonut();
    requestAnimationFrame(function () { requestAnimationFrame(function () { view().querySelectorAll('.slotbar i').forEach(function (i) { i.style.width = i.dataset.w + '%'; }); }); });
    $('ovRef').onclick = ov.refresh;
    var t = $('ovToggle');
    if (t) t.onclick = function () { A.api('/admin/api/game/status', { status: g.status === 'live' ? 'paused' : 'live' }).then(function (x) { if (x.ok) { A.toast(x.game.status === 'live' ? 'Game is live' : 'Game paused', 'ok'); ovLoad(true); } else A.toast(A.errText(x), 'bad'); }); };
  }
  function ovUpdate(r) {
    var prev = ov.last; if (!prev || !view().querySelector('[data-k]')) return ovDraw(r);
    STATS.forEach(function (s) { var el = view().querySelector('[data-k="' + s[0] + '"]'); if (el) el.textContent = r.stats[s[0]] + (s[0] === 'completion' ? '%' : ''); });
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    if (!same(prev.timeline, r.timeline)) { $('cLine').innerHTML = A.lineChart(r.timeline); $('cLine').classList.add('noanim'); }
    if (!same(prev.perSlot, r.perSlot)) { $('cBar').innerHTML = A.barChart(r.perSlot); $('cBar').classList.add('noanim'); $('cSlots').innerHTML = slotBars(r); view().querySelectorAll('.slotbar i').forEach(function (i) { i.style.width = i.dataset.w + '%'; }); }
    if (prev.stats.completion !== r.stats.completion) { $('cDon').innerHTML = A.donut(r.stats.completion); A.animateDonut(); }
    $('ovStatus').innerHTML = statusChip(r.game) + (r.game.registrationOpen ? '' : ' <span class="pill warn">Registration closed</span>') + (r.game.scanningOpen ? '' : ' <span class="pill warn">Scanning closed</span>');
  }

  // ============================================================ LIVE ACTIVITY
  var live = A.pages.live = { filter: 'all' };
  var FILTERS = [['all', 'All'], ['scan', 'Scans'], ['register', 'Players'], ['dup', 'Duplicates'], ['invalid', 'Invalid'], ['suspicious', 'Suspicious'], ['win', 'Winners'], ['admin', 'Admin & game']];
  var matches = function (ev) { var f = live.filter; return f === 'all' || ev.type === f || (f === 'admin' && (ev.type === 'admin' || ev.type === 'game')); };
  var ICON_E = { scan: '📱', register: '👋', dup: '🔁', invalid: '🚫', suspicious: '⚠️', win: '🏆', admin: '🛠️', game: '🎮' };
  function feedRow(ev, fresh) {
    var li = document.createElement('li'); li.className = ev.type; if (!fresh) li.style.animation = 'none';
    li.innerHTML = '<span class="t">' + A.tm(ev.at) + '</span><span>' + (ICON_E[ev.type] || '') + ' ' + esc(ev.text) + '</span>';
    return li;
  }
  live.render = function () {
    view().innerHTML = '<div class="toolbar"><div class="chips" id="lf">' + FILTERS.map(function (f) { return '<span class="chip' + (f[0] === live.filter ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</span>'; }).join('') + '</div><span class="sp"></span><span class="muted small">Alerts: sound ' + ic('volume').replace('class="i"', 'class="i" width="14" height="14"') + ' and browser notifications ' + ic('bell').replace('class="i"', 'class="i" width="14" height="14"') + ' in the top bar</span></div><div class="card"><ul class="feed" id="feed"></ul></div>';
    $('lf').onclick = function (e) { var c = e.target.closest('.chip'); if (!c) return; live.filter = c.dataset.f; document.querySelectorAll('#lf .chip').forEach(function (x) { x.classList.toggle('on', x === c); }); fill(); };
    fill();
  };
  function fill() {
    var ul = $('feed'); if (!ul) return; ul.innerHTML = '';
    var list = A.feed.filter(matches).slice(-150).reverse();
    if (!list.length) ul.innerHTML = '<li style="animation:none;border:0;background:none">' + A.empty('pulse', 'Waiting for activity... scans will appear here instantly.') + '</li>';
    list.forEach(function (ev) { ul.appendChild(feedRow(ev, false)); });
  }
  live.onFeed = function (ev) {
    var ul = $('feed'); if (!ul || A.page !== 'live' || !matches(ev)) return;
    if (ul.firstChild && !ul.firstChild.className) ul.innerHTML = '';
    ul.insertBefore(feedRow(ev, true), ul.firstChild);
    while (ul.children.length > 150) ul.lastChild.remove();
  };

  // ============================================================ PLAYERS
  var pl = A.pages.players = { q: '', status: 'all', limit: 100, data: [] };
  pl.render = function () {
    view().innerHTML = '<div class="toolbar"><input id="pq" placeholder="Search players..." value="' + esc(pl.q) + '" aria-label="Search players"><select id="ps" aria-label="Filter by status">' +
      [['all', 'All statuses'], ['registered', 'Registered'], ['hunting', 'Hunting'], ['finished', 'Finished all 7'], ['winner', 'Winners'], ['dq', 'Disqualified'], ['suspicious', 'Suspicious']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === pl.status ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select><span class="sp"></span><a class="btn" href="/admin/api/data/players.csv">' + ic('download') + 'Export CSV</a><button class="btn" id="pr">' + ic('refresh') + 'Refresh</button></div><div class="card" style="padding:8px"><div class="tw" id="ptab"></div></div>';
    $('pq').oninput = function () { pl.q = this.value; pl.limit = 100; drawP(); };
    $('ps').onchange = function () { pl.status = this.value; pl.limit = 100; drawP(); };
    $('pr').onclick = pl.refresh;
    pl.refresh();
  };
  pl.refresh = function () {
    A.api('/admin/api/players').then(function (r) { if (!r.ok) return errView(r); pl.data = r.players; if (A.page === 'players') drawP(); });
  };
  function drawP() {
    var q = pl.q.trim().toLowerCase();
    var rows = pl.data.filter(function (p) {
      if (q && p.name.toLowerCase().indexOf(q) < 0) return false;
      if (pl.status === 'all') return true;
      if (pl.status === 'suspicious') return p.suspicious;
      return p.status === pl.status;
    });
    var box = $('ptab'); if (!box) return;
    if (!rows.length) { box.innerHTML = A.empty('users', pl.data.length ? 'No players match your filters.' : 'No players yet. They will appear as soon as someone registers.'); return; }
    box.innerHTML = '<table><thead><tr><th>Player</th><th>Progress</th><th>Last scan</th><th>Status</th><th></th></tr></thead><tbody>' + rows.slice(0, pl.limit).map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b><div class="muted small">joined ' + A.ago(p.createdAt) + '</div></td><td>' + dots(p.slots, 7) + '</td><td>' + (p.last ? A.ago(p.last) : '-') + '</td><td>' + statusPill(p) + '</td><td style="text-align:right"><button class="btn sm" data-id="' + p.id + '">Details</button></td></tr>';
    }).join('') + '</tbody></table>' + (rows.length > pl.limit ? '<div style="padding:12px;text-align:center"><button class="btn" id="more">Show more (' + (rows.length - pl.limit) + ')</button></div>' : '');
    box.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; if (b.id === 'more') { pl.limit += 100; return drawP(); } if (b.dataset.id) detail(b.dataset.id); };
  }
  function detail(id) {
    A.api('/admin/api/players/' + id).then(function (r) {
      if (!r.ok) return A.toast(A.errText(r), 'bad');
      var p = r.player, mg = A.can('players.manage');
      var chips = ''; for (var i = 1; i <= 7; i++) { var s = p.scans.filter(function (x) { return x.slot === i; })[0]; chips += '<div style="flex:1;min-width:38px;text-align:center;padding:8px 2px;border-radius:10px;background:' + (s ? 'rgba(255,106,0,.18)' : 'var(--s2)') + ';border:1px solid ' + (s ? 'var(--o)' : 'var(--line)') + '"><b style="font-size:18px">' + (s ? esc(s.letter) : '·') + '</b><div class="muted" style="font-size:10px">QR ' + i + '</div></div>'; }
      var body = '<div style="display:flex;gap:6px;margin:6px 0 14px">' + chips + '</div><div class="muted small" style="line-height:1.9">Status: ' + statusPill(p) + '<br>Registered: ' + A.dt(p.createdAt) + '<br>Progress: <b style="color:#fff">' + p.count + '/7</b>' + (p.finishMs ? ' · completion time <b style="color:#fff">' + A.dur(p.finishMs) + '</b>' : '') + '<br>Wrong secret-word attempts: ' + p.attempts + (p.won ? '<br>Winner place <b style="color:#fff">#' + p.won.rank + '</b> · claim code <b style="color:#fff">' + esc(p.won.code) + '</b>' + (p.won.verified ? ' ✓ verified' : '') : '') + '</div>' +
        '<h3 style="margin:16px 0 8px;font-size:13px">Scan history</h3>' + (p.scans.length ? '<div class="tw"><table><tbody>' + p.scans.map(function (s) { return '<tr><td>' + A.dt(s.at) + ' <span class="muted small">' + A.tm(s.at) + '</span></td><td>' + esc(s.label || 'QR ' + s.slot) + ' <b>(' + esc(s.letter) + ')</b></td><td>' + (s.flag ? '<span class="pill bad">fast scan</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted small">No scans yet.</p>') +
        (mg ? '<div class="acts" id="pacts" style="justify-content:flex-start"><button class="btn sm" data-a="' + (p.dq ? 'reinstate' : 'disqualify') + '">' + (p.dq ? 'Reinstate' : 'Disqualify') + '</button><button class="btn sm" data-a="reset">Reset progress</button><button class="btn sm danger" data-a="delete">Remove player</button></div>' : '');
      A.dialog({ title: p.name, cancel: 'Close', body: body, noFocus: true, onOpen: function (el, close) {
        var box = el.querySelector('#pacts'); if (!box) return;
        box.onclick = function (e) {
          var b = e.target.closest('button'); if (!b) return; var act = b.dataset.a;
          var text = { disqualify: 'Disqualify <b>' + esc(p.name) + '</b>? They will be blocked from scanning.', reinstate: 'Reinstate <b>' + esc(p.name) + '</b>?', reset: 'Reset all progress for <b>' + esc(p.name) + '</b>? Their scans and win (if any) will be erased.', delete: 'Permanently remove <b>' + esc(p.name) + '</b> and all their scans?' }[act];
          close(false);
          A.confirm(act === 'delete' ? 'Remove player' : act === 'reset' ? 'Reset progress' : act === 'reinstate' ? 'Reinstate player' : 'Disqualify player', text, { confirm: 'Yes, ' + act, danger: act !== 'reinstate', onConfirm: function () { return A.api('/admin/api/players/' + id + '/' + act, {}).then(function (x) { if (!x.ok) return A.errText(x); A.toast('Done', 'ok'); pl.refresh(); }); } });
        };
      } });
    });
  }

  // ============================================================ WINNERS
  var wn = A.pages.winners = {};
  wn.render = function () {
    view().innerHTML = '<div class="toolbar"><input id="wc" placeholder="Verify a claim code..." maxlength="8" style="text-transform:uppercase;max-width:240px" aria-label="Claim code"><button class="btn primary" id="wb">' + ic('search') + 'Check code</button><span id="wr" class="muted"></span><span class="sp"></span><button class="btn" id="wrf">' + ic('refresh') + 'Refresh</button></div><div class="card" style="padding:8px"><div class="tw" id="wtab"></div></div>';
    $('wrf').onclick = wn.refresh;
    var check = function () {
      var code = $('wc').value.trim(); if (!code) return;
      A.api('/admin/api/winners/lookup?code=' + encodeURIComponent(code)).then(function (r) {
        $('wr').innerHTML = r.ok ? '<span class="pill ok">Valid</span> <b style="color:#fff">' + esc(r.winner.name) + '</b> · place #' + r.winner.won.rank + (r.winner.won.verified ? ' · already verified' : ' · not yet verified') : '<span class="pill bad">No winner has this code</span>';
      });
    };
    $('wb').onclick = check; $('wc').onkeydown = function (e) { if (e.key === 'Enter') check(); };
    wn.refresh();
  };
  wn.refresh = function () {
    A.api('/admin/api/winners').then(function (r) {
      if (!r.ok) return errView(r); var box = $('wtab'); if (!box || A.page !== 'winners') return;
      if (!r.winners.length) { box.innerHTML = A.empty('trophy', 'No winners yet. The first player to solve the secret word will appear here.'); return; }
      var mg = A.can('winners.manage');
      box.innerHTML = '<table><thead><tr><th>Place</th><th>Player</th><th>Completion time</th><th>Finished</th><th>Claim code</th><th>Verification</th><th></th></tr></thead><tbody>' + r.winners.map(function (w) {
        return '<tr><td><span class="letterb" style="width:auto;padding:0 10px;font-size:15px">#' + w.won.rank + '</span></td><td><b>' + esc(w.name) + '</b>' + (w.dq ? ' <span class="pill bad">DQ</span>' : '') + (w.won.prize ? '' : ' <span class="pill">no prize (limit)</span>') + '</td><td>' + A.dur(w.won.ms) + '</td><td>' + A.dt(w.won.at) + '</td><td><b style="letter-spacing:.14em">' + esc(w.won.code) + '</b></td><td>' + (w.won.verified ? '<span class="pill ok">✓ Verified</span>' : '<span class="pill warn">Awaiting</span>') + '</td><td>' + (mg ? '<button class="btn sm" data-id="' + w.id + '" data-v="' + (w.won.verified ? 0 : 1) + '">' + (w.won.verified ? 'Unverify' : 'Mark verified') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
      box.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; A.api('/admin/api/winners/' + b.dataset.id + '/verify', { value: b.dataset.v === '1' }).then(function (x) { if (x.ok) { A.toast(b.dataset.v === '1' ? 'Winner verified' : 'Verification removed', 'ok'); wn.refresh(); } else A.toast(A.errText(x), 'bad'); }); };
    });
  };
})();
