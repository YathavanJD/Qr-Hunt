# Test results (actually executed)

## Automated integration tests - `npm test` - 191 passed, 0 failed
Boots the real server in a temporary folder and attacks it. Covers: static assets and private-file protection, security headers;
QR 1-7 scans; random / modified / path-like / object / fabricated-number tokens; duplicate scans; image gating (before scan,
other letters, other visitors); correct and wrong secret word; winner ranking incl. 5 simultaneous finishers; claim codes;
admin login, lockout, forged and expired cookies, CSRF origin check, JSON-only; role permissions for Game manager and QR manager on
direct API calls; permission changes killing live sessions; QR regenerate / revoke / deactivate / reset and old-token rejection;
no tokens in any non-QR admin response, Settings payload, backups or SSE events; ZIP validity; print sheet; suspicious-scan flagging
and blocking; pause, scanning-off, registration-off; player disqualify / reset / remove / rank recompute; winner verification;
settings, masked integration secrets; backup / restore / reset; audit log; live SSE notifications; persistence across a server restart.

## Browser tests (headless Chromium via Playwright)
Full player run on a phone-sized screen: welcome, registration, verifying animation, letter reveal, duplicate, invalid QR,
all seven letters, final challenge, wrong answer, winner screen. Admin tour on desktop (login, every page, QR reveal, all
Settings tabs, player details) and on a phone (overview, slide-out menu). Result: no JavaScript errors, no horizontal overflow.
Bugs found and fixed by this run: a mobile layout overflow on the reveal screen, and a function-name clash that broke QR Management.
The in-app print sheet was rendered and its QR code decoded back to the correct secret link.

## Upgrade test
A version-1 data file migrated correctly, and a card printed by the first version (decoded from your original PNG) still scanned.

## Not tested
Real phone cameras on a printed card, Render itself, Upstash, ntfy and Telegram delivery (no network credentials here), and
physical printing. Please do one end-to-end rehearsal on Render before the event.
