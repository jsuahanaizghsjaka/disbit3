# Intro release acceptance — November 7, 2026 (Moscow)

Published application commit: `3007ebaed567e82c60c15b7cc65c8356d7c740d2`.
Archive SHA256: `b9709c5e5521fffdfc99ad9049f3d6fb2de6ba26113c4624ac242b75c31ed17d`.
User approved publication and removal of the test-mode sentence from slide 4. Payment configuration was not changed; production health still reports `livePayments: false`.

## Verification

- All 54 automated tests passed locally; release asset checks passed.
- Full intro browser suite passed locally, on staging through SSH port forwarding, and on public HTTPS production. Six slides, wheel/tap/swipe/keyboard navigation, rejected short press, canceled hold, completed 1.4-second hold, congratulations, automatic registration, one-time completion and explicit login bypass were checked.
- Chromium touch emulation and reduced motion passed; six viewport sizes from 320×640 through desktop/landscape were checked for horizontal overflow and pledge reachability.
- Public slide 4 text verified: `Штраф за срыв / Сумму задаёшь сам.`
- No JavaScript page errors in the completed suites. Browser emitted existing informational DOM recommendations about password forms; no account credentials were entered.
- Production/staging health identify the application commit above. Both services, Caddy and the monitoring timer are active. Disk has approximately 2.7 GB available (81% used).
- Real phone, Safari, native WebView, new APK, account signup, email delivery and financial transactions were not tested in this release.

## Backups and rollback

- Staging: `/srv/disbit-staging/backups/pre-3007eba-20261106T234158Z`.
- Production: `/srv/disbit/backups/pre-3007eba-retry1-20261106T234352Z`.
- SQLite/media snapshot verification and restoration to separate `-restored` directories passed. Production backup contains 12 files.
- Production code: `/srv/disbit/releases/3007ebaed567e82c60c15b7cc65c8356d7c740d2-retry1`.
- Production rollback: `sudo bash /srv/disbit/rollback-3007eba-retry1.sh`.
- Staging rollback: `sudo bash /srv/disbit-staging/rollback-3007eba.sh`.
- Rollback restores the previous code/environment and preserves current database/media. Previous application commit: `b431a4ad1fea56bba46e5dc7654f98d5ca7a0150`.

## Deployment observations

An initial uncommitted snapshot was rejected on staging by RELEASE_SHA validation; automatic rollback restored the preceding release. The tested files were then committed and deployed with the actual commit identifier. The staging domain failed DNS resolution from this workstation, so staging browser checks used an SSH tunnel to its existing port 3102.

The first production attempt started successfully but its piped asset smoke check failed and triggered rollback. Replacing the pipe with a downloaded asset followed by a separate grep check passed. The exact exit cause of the original pipe was not captured. The retry used the identical verified archive and a new release directory and backup. Final public browser acceptance passed.

Website deployment is complete. GitHub push remains the user's next action. Existing deleted local backup archives and unrelated untracked files were not included in the application commit.
