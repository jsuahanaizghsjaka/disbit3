# Welcome screen release — 2026-11-06 (Moscow)

Application commit: `b431a4ad1fea56bba46e5dc7654f98d5ca7a0150`.
Pushed to `origin/main`. Includes the preceding auth UI / Google staging work and the financial request retry safeguard; live payments remain disabled.

## Design

- Full-screen navy welcome composition, larger heading and translucent pill buttons.
- Local transparent 3dicons V1 CC0 target, trophy and star, resized to WebP (about 33 KB total).
- Phosphor envelope and password visibility icons; source licenses included.
- Local Anime.js module: short content entrance and staggered artwork entrance. Animations stop/revert when the screen changes or the tab is hidden; reduced motion is respected.
- Registration method picker remains the initial screen. Email registration, login and password recovery keep their existing form handlers.

## Verified

- `npm test`: 54 passing tests.
- `git diff --check`: clean.
- Local Chromium: desktop 1280×900, mobile 390×844 and 320×640; email registration, login and recovery screens open.
- Production Chromium: registration → email form; login → recovery form; zero console errors/warnings.
- Production reduced-motion check at 320×640: no horizontal document overflow; all three images loaded and fully visible.
- Production/staging health endpoints report the exact application commit above; both application services and Caddy active.

## Deployment and recovery

Staging deployed first, then production. Each deployment stopped its application briefly for a consistent SQLite + media backup. Backup hashes, SQLite integrity/foreign keys, media references and row counts were verified; restoration into a separate directory passed.

- Staging backup: `/srv/disbit-staging/backups/pre-b431a4a-20261105T221059Z`
- Production backup: `/srv/disbit/backups/pre-b431a4a-20261105T221114Z`
- Restored verification directories: corresponding backup path plus `-restored`.
- Previous code: `ac0f022392f1d4f908f4f6df629bd05089e20096`.
- Production code/config rollback: `sudo bash /srv/disbit/rollback-b431a4a.sh`.
- Staging rollback: `sudo bash /srv/disbit-staging/rollback-b431a4a.sh`.
- Rollback preserves the current database/media; it does not overwrite new user activity.
- Existing environment files, SMTP credentials, reset settings and sandbox payment configuration were retained.
- Disk after deployment: about 1.4 GB free / 14 GB total (90% used). No backups or user data removed. Existing monitoring timer remains scheduled.

## Limits

- Real Android/iOS hardware and a new APK were not tested/built in this UI release.
- Google and Apple remain unavailable on production; Google staging code is not equivalent to production OAuth activation.
- No new end-to-end email/password change or payment transaction was performed during this visual release.
- Mobbin page could not be opened; the user-provided reference screenshot was used.
