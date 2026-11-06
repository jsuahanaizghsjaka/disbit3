# First-run intro — approved release candidate

User approved website publication on November 7. Git push remains a separate user action; no new APK is included. See the deployment acceptance report for actual server status.

Six slides: promise, marathon, minimum, feature overview, first step, pledge.
The only interactive button is the large pledge control. Forward/back navigation uses horizontal swipe, mouse drag, keyboard arrows, wheel gestures or taps at the sides. Tall slides retain native vertical scrolling. Pagination is informational, not buttons. Escape allows keyboard dismissal.

A pledge requires a 1.4-second pointer hold or holding Space/Enter while the button is focused. Blue fill shows progress. Short clicks, early release, pointer leaving the circular button, pointer cancellation, focus loss, slide change and hiding the page cancel the hold. Completion shows congratulations and opens registration after 2.1 seconds. Duplicate activation is prevented; the celebration timer pauses while the page is hidden and restarts on return. This is a personal intention, not creation of a habit, acceptance of financial terms or a money movement.

At the user's request the penalty row now says only “Сумму задаёшь сам.” This is a copy change; payment configuration and actual payment availability are unchanged. No unsupported app blocking or production OAuth is advertised.

Preview: http://127.0.0.1:3470/intro-preview.html — uses the actual component/CSS, then navigates to local registration. No account changes or email requests occur automatically.

Verification:
- Updated tests/browser-intro.js passed on November 7: six slides, exactly one button, wheel/tap/keyboard/drag navigation; short click and short Enter rejected, early release resets visible progress, pointer exit and slide change cancel, keyboard hold completes, congratulations, automatic registration, saved completion/one-time display, explicit login bypass.
- Mobile touch cancellation and complete hold verified through Chromium CDP with reduced motion. Essential fill feedback remains; the decorative success pulse is omitted in reduced-motion mode.
- Touch swipe verified with Chromium mobile emulation and actual touch input events through CDP.
- 320×640, 360×800, 390×844, 430×932, 844×390, 1280×900 checked: no horizontal overflow; pledge reachable on short/landscape screens by scrolling.
- No JavaScript page errors in completed run.
- npm test: 54 passed again for the approved release candidate; backend unchanged.
- Real phone, Safari, native WebView and APK not tested.
- Reviewed current web-design-guidelines: labels, one native button/keyboard alternative, reduced motion, safe areas and finite motion retained. Visible navigation buttons removed at explicit user request.

Screenshots: release-artifacts/intro-v2-01.png through intro-v2-06.png; intro-v2-success.png; intro-hold-progress.png; intro-hold-mobile-success.png. The older intro-mobile-gallery-v2.png predates the latest benefit copy and hold changes.
Next: deploy the committed version to staging, verify, then publish production with backups and rollback.

## November 7 — compact fourth slide
Only the features slide markup and its dedicated CSS changed in this iteration; the other slide markup was compared against a saved pre-edit copy and is identical. Three illustrated benefits replace six paragraphs: bits/rewards, friends, five pause days. Existing staggered entry animation retained. At 320×640, 360×800, 390×844, 430×932 and 1280×900 the fourth slide fits without vertical or horizontal overflow. Keyboard forward/back and mobile-emulated touch navigation passed. No page errors. Fresh mobile screenshot: release-artifacts/intro-slide4-compact.png. Real device untested; still local, pending design approval.

## November 7 — core features revision (supersedes three-benefit copy)
Slide 4 now explicitly covers user-selected penalties (marked test mode), photo/video proofs, minimum action preserving a streak, marathon traveler progression, bits and self-selected rewards. Five concise illustrated rows. Only slide 4 markup and its dedicated CSS changed; other markup compared with the immediate pre-edit copy. Rechecked no overflow at 320×640, 360×800, 390×844, 430×932 and 1280×900; forward/back navigation and mobile-emulated touch input passed, no page errors. Compact 320×640 spacing corrected after first test. Current mobile image: release-artifacts/intro-slide4-features.png. Not published; actual device not tested.
