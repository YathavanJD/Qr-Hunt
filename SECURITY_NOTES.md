# Security notes

**QR validation.** The server keeps a registry of exactly seven slots. A slot's letter and image are fixed in code; only its
secret token and label can change. Every scan is checked against the registry with a constant-time comparison. The browser never
sends a QR number, letter, filename or progress value that the server trusts. Unknown, modified, copied, revoked, old and
deactivated tokens are rejected and logged (without ever logging the submitted token).

**Token lifecycle.** Tokens are 160-bit random values. Regenerate and Revoke remove the old token immediately; its hash is
remembered so players see "expired". "Legacy" tokens (derived from SECRET, used by the first printed cards) keep working until you
regenerate them. Regenerate once before the real event.

**Where secrets live.** Tokens exist only in server state and in the QR Management workspace (permission `qr.view`). They are not
in any other API response, page, script, SSE event, backup file or localStorage. Settings has no QR list or links. QR previews are
hidden until "Reveal" is pressed and hide themselves after 60 seconds. Reveal/download/print actions are audit-logged.

**Letter images** live outside the public folder and are served only to a player who has scanned that slot.

**Admin auth.** scrypt password hashing, signed HttpOnly SameSite=Strict cookies (Secure on HTTPS), configurable session length,
per-IP and per-user login throttling, constant-time comparison, generic error messages. Changing a role/permissions, disabling or
resetting a password invalidates that admin's sessions immediately. Permissions are enforced per request on the server.

**CSRF / injection.** State-changing requests require JSON and a same-origin `Origin`. Strict CSP (scripts only from this site),
frame denial, no-sniff, no-referrer. All dynamic text is escaped; player names are sanitised; CSV export neutralises formulas.

**Rate limits.** Registration, scanning, invalid-token attempts, secret-word attempts (plus a 10-minute lock after 25 wrong tries),
and admin login.

**Honest limits.** A player who photographs a QR code, or a link someone forwards, can still be used by another person - no web
game can prevent sharing. Suspicious-scan detection (fast successive scans) and disqualification help; physical placement helps most.
Data is stored as one JSON document (file or Upstash); that is plenty for an event of a few thousand players but is not a database cluster.
