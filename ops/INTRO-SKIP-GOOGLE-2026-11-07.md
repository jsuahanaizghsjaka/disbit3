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

## Google: enabled; existing-account sign-in verified

The user approved the production callback. Saved and re-opened the Google client to verify `https://disbit.ru/api/auth/oauth/google/callback` persisted alongside the existing staging and loopback URIs.

The existing credential was installed through SSH stdin without printing its secret. Production now has both GOOGLE_OAUTH_ENABLED=1 and GOOGLE_OAUTH_PRODUCTION_ENABLED=1. Pre-change environment backup: `/etc/disbit/password-release.env.pre-google-enable-20261107`.

On November 8, 2026, public `/api/auth/oauth/providers` returned Google true, Apple false. Services disbit and Caddy were active; health reported release 777ff1012f6b98e7897edde2c5b364d5b69124ce and live payments false. Clicking the active Google button on production opened Google's account chooser with the correct production redirect, PKCE and only openid/email/profile scopes. No redirect mismatch was shown at that step.

The user completed the real Google flow on November 8. Browser verification showed the existing @sinon account with its previous promises and confirmed email. A subsequent logout and Google sign-in performed through the browser returned to the same @sinon profile and its existing transaction history. Thus the real callback and repeat existing-account sign-in passed. New-account creation and a separate explicit linking flow were not exercised in this production session.

Native Android/iOS OAuth remains unavailable and requires a separate system-browser/native return flow. No new APK or real-device test was completed. GitHub push remains a separate action.
