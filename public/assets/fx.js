/* Mr.DooD motion system: ambient glow particles + burst + confetti. Lightweight, pauses when hidden, honours reduced-motion. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var low = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 2;
  var bg = document.getElementById('bg'), fx = document.getElementById('fx');
  var bctx = bg && bg.getContext('2d'), fctx = fx && fx.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, amb = [], parts = [], ambRun = false, fxRun = false, last = 0;

  function resize() {
    W = innerWidth; H = innerHeight;
    [bg, fx].forEach(function (c) { if (c) { c.width = W * dpr; c.height = H * dpr; } });
    if (bctx) bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fctx) fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();

  function mkAmb() { return { x: Math.random() * W, y: H + Math.random() * H, r: 1.5 + Math.random() * 3.5, v: 12 + Math.random() * 28, a: .15 + Math.random() * .45, w: Math.random() * 6 }; }
  function ambient() {
    if (!ambRun) return;
    var now = performance.now(), dt = Math.min((now - last) / 1000, .1);
    if (now - last < 32) return requestAnimationFrame(ambient); // ~30fps cap
    last = now;
    bctx.clearRect(0, 0, W, H);
    for (var i = 0; i < amb.length; i++) {
      var p = amb[i]; p.y -= p.v * dt; p.w += dt; p.x += Math.sin(p.w) * .3;
      if (p.y < -10) { amb[i] = mkAmb(); amb[i].y = H + 10; continue; }
      bctx.beginPath(); bctx.fillStyle = 'rgba(255,' + (120 + (p.r * 20 | 0)) + ',20,' + p.a + ')';
      bctx.arc(p.x, p.y, p.r, 0, 6.283); bctx.fill();
    }
    requestAnimationFrame(ambient);
  }
  function startAmbient() {
    if (reduce || !bctx || ambRun) return;
    var n = low ? 18 : 36; amb = []; for (var i = 0; i < n; i++) { var p = mkAmb(); p.y = Math.random() * H; amb.push(p); }
    ambRun = true; last = 0; requestAnimationFrame(ambient);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) ambRun = false; else if (bctx && !reduce && !ambRun) startAmbient();
  });

  function loop() {
    if (!parts.length) { fxRun = false; fctx.clearRect(0, 0, W, H); return; }
    fctx.clearRect(0, 0, W, H);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i]; p.life -= 1;
      if (p.life <= 0 || p.y > H + 30) { parts.splice(i, 1); continue; }
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= p.drag; p.rot += p.vr;
      fctx.globalAlpha = Math.max(0, Math.min(1, p.life / 30));
      fctx.fillStyle = p.c;
      if (p.rect) { fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillRect(-p.s, -p.s / 2, p.s * 2, p.s); fctx.restore(); }
      else { fctx.beginPath(); fctx.arc(p.x, p.y, p.s, 0, 6.283); fctx.fill(); }
    }
    fctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  }
  function kick() { if (!fxRun) { fxRun = true; requestAnimationFrame(loop); } }
  var COLS = ['#ff6a00', '#ff9e28', '#ffd36b', '#ffffff', '#c43e00'];

  window.FX = {
    ambient: startAmbient,
    burst: function (x, y, n) {
      if (reduce || !fctx) return;
      n = Math.min(n || 50, low ? 36 : 80);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * 6.283, s = 2 + Math.random() * 7;
        parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, g: .12, drag: .985, s: 1.5 + Math.random() * 3.2, c: COLS[(Math.random() * 4) | 0], life: 50 + Math.random() * 40, rot: 0, vr: 0 });
      }
      kick();
    },
    confetti: function (ms) {
      if (reduce || !fctx) return;
      var n = low ? 70 : 140, end = Date.now() + (ms || 3000), emitted = 0;
      (function drip() {
        var batch = Math.min(14, n - emitted);
        for (var i = 0; i < batch; i++) parts.push({ x: Math.random() * W, y: -10 - Math.random() * 60, vx: -1.5 + Math.random() * 3, vy: 1 + Math.random() * 2, g: .05, drag: .995, s: 3 + Math.random() * 4, c: COLS[(Math.random() * COLS.length) | 0], life: 260 + Math.random() * 80, rot: Math.random() * 6, vr: -.15 + Math.random() * .3, rect: true });
        emitted += batch; kick();
        if (emitted < n && Date.now() < end) setTimeout(drip, 120);
      })();
    },
  };
  startAmbient();
})();
