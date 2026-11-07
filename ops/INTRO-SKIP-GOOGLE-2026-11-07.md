# First visit, skip and Google production preparation

Application commit `777ff1012f6b98e7897edde2c5b364d5b69124ce` deployed to staging and production on November 7, 2026.
Archive SHA256: `a8b02f59c03faded61078b4469a54b503f012fe655b144f445b8e8e4dd2e7fc1`.

## Completed

- A new unauthenticated visitor sees the introduction before registration, including direct `#register`, `#register-email` and `#login` visits. Existing authenticated sessions, OAuth return and password-reset completion retain their uninterrupted flows.
- A transparent 136×48 CSS-pixel Skip button sits at the top right. Skip and completed pledge persist the existing `disbit_intro_v1` key; skipping does not create a pledge. Storage is per browser/device and is reset if the user clears site data.
- Keyboard focus cycles through Skip and the pledge control. Pointer/keyboard hold cancellation remains intact.
- All 54 automated tests passed, including explicit production Google opt-in, HTTPS requirements and missing-secret rejection. The full intro browser suite passed locally, through SSH-forwarded staging, and on public HTTPS production. First auth-link visits, skip persistence after reload, completed pledge, canceled hold, navigation and six viewport sizes were tested. No JavaScript page errors.
- Caddy callback logging protected via `log_skip /api/auth/oauth/google/callback`. Configuration validated and reloaded; a synthetic callback marker was absent from access logs. Other request logging is retained. Caddy backup: `/etc/caddy/Caddyfile.pre-google-20261107`.
- Google login data handling documented in the privacy page; unrelated legal completeness has not been certified.

## Server recovery

- Staging backup verified/restored: `/srv/disbit-staging/backups/pre-777ff10-20261107T064425Z`.
- Production backup verified/restored: `/srv/disbit/backups/pre-777ff10-20261107T064537Z` (database plus media, 12 files).
- Production rollback: `sudo bash /srv/disbit/rollback-777ff10.sh`; preserves current database/media.
- Staging rollback: `sudo bash /srv/disbit-staging/rollback-777ff10.sh`.
- Services disbit, disbit-staging, Caddy and monitoring timer active; approximately 2.8 GB disk free.

## Google: pending, not enabled

The existing OAuth client in project `disbit-staging-20261104` currently has staging and loopback redirects. A third URI `https://disbit.ru/api/auth/oauth/google/callback` is filled in the Google Cloud form but NOT saved. Browser policy requires action-time confirmation for extending OAuth access. An async confirmation question was sent; no answer received during this turn. Keep this form pending and do not save before approval.

Backend now supports production only with BOTH `GOOGLE_OAUTH_ENABLED=1` and `GOOGLE_OAUTH_PRODUCTION_ENABLED=1`, a client ID/secret and a valid HTTPS PUBLIC_URL. These were NOT enabled in production. Public `/api/auth/oauth/providers` still reports Google false, Apple false.

Next: after approval save the prepared callback; inspect consent/audience settings; securely configure the existing credential on the server without printing it; enable flags and verify real first/repeat login and explicit account linking. Credential location and client ID are recorded in SOCIAL-AUTH-STAGING.md. No Gmail/Drive scopes are requested. Do not claim production Google works until the real flow passes.

Native Android/iOS OAuth remains unavailable and requires a separate system-browser/native return flow. No new APK, real-device test or real Google production login was completed here. GitHub push remains a separate action.
