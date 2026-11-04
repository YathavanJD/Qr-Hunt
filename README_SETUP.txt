MR.DOOD QR HUNT v2 - SETUP GUIDE
================================
What is new: premium player game, professional admin Control Center, separate permission-gated QR Management,
roles (Super admin / Game manager / QR manager), audit log, live notifications, backup & restore, and more.

DEPENDENCY
  One package: "qrcode" (npm, MIT licence, widely used) - generates QR images/SVG/PNG on the server.
  Render installs it automatically (buildCommand: npm install --omit=dev). Everything else is plain Node.js (v18+).

ENVIRONMENT VARIABLES (Render > your service > Environment)
  SECRET                    REQUIRED. 16+ random characters. Signs cookies. KEEP THE SAME VALUE AS YOUR OLD DEPLOYMENT:
                            your already-printed cards were made from it and keep working until you regenerate them.
  ADMIN_PASSWORD            REQUIRED on first start. Creates the first super administrator (username: admin).
                            Afterwards passwords are changed inside the app (Settings > Security).
  ADMIN_USERNAME            optional, default "admin" (only used when the first admin is created).
  FORCE_ADMIN_RESET=1       emergency only: resets the password of ADMIN_USERNAME to ADMIN_PASSWORD at next start. Remove it afterwards.
  UPSTASH_REDIS_REST_URL    STRONGLY RECOMMENDED on Render. Free Redis from upstash.com. Without it, Render's free disk is
  UPSTASH_REDIS_REST_TOKEN  wiped on every restart/redeploy and you lose players, scans and winners.
  BASE_URL                  optional, e.g. https://mr-dood-game.onrender.com (forces the address inside QR codes)
  NTFY_TOPIC / NTFY_SERVER  optional phone push (can also be set in Settings > Notifications)
  TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   optional Telegram push (also in Settings)
  PORT, DATA_DIR            normally leave alone (Render sets PORT).

DEPLOY ON RENDER (upgrading your existing game)
  1. Replace the files in your PRIVATE GitHub repo with this folder's contents (do not upload node_modules or data).
  2. Render dashboard > your Web Service > Settings: Build Command = "npm install --omit=dev", Start Command = "node server.js".
  3. Environment: keep SECRET and ADMIN_PASSWORD, add the two Upstash variables (create a free Upstash Redis database first).
  4. Deploy. Check https://YOUR-SITE/healthz shows "ok", then open https://YOUR-SITE/admin and sign in (admin / your ADMIN_PASSWORD).
  5. Open QR Management. Slots show a "legacy token" label: these are the codes already printed. They work as they are.
     For maximum security (recommended before the real event), click "Regenerate all 7", then "Print-ready A4 cards" and reprint.
  6. Test: scan one card with a phone, watch Live Activity, then Settings > Data management > Reset entire game.
  Keep it awake: add a free UptimeRobot monitor for /healthz every 5 minutes (Render free sleeps after 15 idle minutes).

FIRST-TIME USE ON THE ADMIN SIDE
  Settings > Security > Administrators: create a "Game manager" for staff (cannot see QR codes unless you tick QR access)
  and a "QR manager" for whoever prints the cards. Give each person their own login.

ROLES
  Super administrator  everything (QR codes, settings, administrators, reset, backup, audit log)
  Game manager         overview, live activity, players, winners, pause/resume, game controls. No QR access by default.
  QR manager           QR Management only: view/generate/regenerate/activate/revoke/edit labels/download/print.
  Extra access can be granted per person. All checks run on the server; hiding buttons is only cosmetic.

RUN LOCALLY / TEST
  npm install
  SECRET=any-16plus-characters ADMIN_PASSWORD=your-password node server.js     (open http://localhost:3000)
  npm test          runs the automated integration tests (starts its own temporary server)

FILES
  server.js                 entry point
  lib/core.js               config, state, persistence, sessions, permissions, live events, router
  lib/qr.js                 seven-slot QR registry, token lifecycle, QR/SVG/PNG/ZIP/print-sheet generation
  lib/player.js             player API (register, scan, letter images, secret word, leaderboard)
  lib/admin.js              admin API (auth, roles, players, winners, game, QR, settings, data, audit)
  public/index.html, assets/game.js, fx.js, player.css      player experience + motion system
  public/admin.html, assets/admin*.js, admin.css            admin Control Center
  private/img/1-7.jpg       letter images (only served after a valid scan)
  private/card_template.png, fonts/Poppins-Bold.ttf         used for print-ready A4 cards (admin only)
  tests/run.js              automated tests
