# Disbit — таблица версий

Одна строка на каждый выкатанный билд. Правило: перед выкаткой ставим git-тег
на коммит и добавляем строку сюда. Данные ниже взяты из отчётов в `ops/` и
`RELEASE-FOUNDATION-REPORT.md`; «—» в ячейке значит, что значение нигде не записано.

| Дата | Что | Версия / versionCode | Коммит | Тег | Источник |
|---|---|---|---|---|---|
| 2026-10-25 | Сервер production + staging | — | `d487aab` | — | RELEASE-FOUNDATION-REPORT.md |
| 2026-10-25 | Android APK/AAB | 1.0.4 / 5 | `d487aab` | — | RELEASE-FOUNDATION-REPORT.md |
| 2026-10-27 | Android APK (Galaxy A22) | 1.0.6 / 7 | `e65ec69` | — | plans/DISBIT-PERFORMANCE-AUDIT-AND-SPEC.md |
| 2026-11-07 | Сервер production + staging | — | `2c975b7` | `server-2026-11-07` | ops/INTRO-SKIP-GOOGLE-2026-11-07.md |
| 2026-11-16 | Сервер production + staging | — | `8fb575c` | — | SECURITY-PUBLICATION-2026-11-16.md |
| 2026-11-16 | Android release APK, локально | 1.0.8 / 9 | `fc813a6` | `android-1.0.8-9` | ANDROID-1.0.8-BUILD-2026-11-16.md |
| 2026-11-18 | Сервер production + staging | — | `e9bb23f` | — | ops/RELEASE-1.1.1-2026-11-18.md |
| 2026-11-18 | Android release APK, локально | 1.1.1 / 11 | — | — | ops/RELEASE-1.1.1-2026-11-18.md (APK SHA-256 `58b0cacf…1ffd5c`) |
| 2026-11-18 | Живые платежи ЮKassa включены (магазин 1527679) | — | `cf1e490` (скрипт) | — | ops/YOOKASSA-LIVE-2026-11-18.md |
| 2026-11-19…21 | Сервер production + staging | — | `ae1b402` | — | CLAUDE.md (состояние на 21.11; точная дата не записана) |
| 2026-11-22 | Сервер production + staging | — | `4ac7646` | — | `/api/ready` на production, проверено 23.11; отчёта нет |
| 2026-11-22 | Android release APK, локально | 1.1.2 / 12 | — | — | `release-artifacts/disbit-1.1.2-release.apk`, собран 22.11 02:31; отчёта и проверки подписи в записях нет |
| 2026-11-23 | Сервер production + staging | — | `2204593` | — | ops/VISUAL-QA-2026-11-23.md |
| 2026-11-23 | Сервер production + staging | — | `2071f42` | — | ops/CARD-MENU-SHEETS-2026-11-23.md |
| 2026-11-23 | Android release APK, локально | 1.1.3 / 13 | `2071f42` | — | ops/CARD-MENU-SHEETS-2026-11-23.md (APK SHA-256 `2ae8ff5d…2a80ce`) |
| 2026-11-23 | Сервер production + staging | — | `8ca21e5` | — | аватары и прогресс пары (`9a6f8e6`) + незаконченный `wip(qa)` Codex; `/api/ready` проверен |
| 2026-11-23 | Сервер production + staging | — | `954e2d7` | `server-2026-11-23` | ops/VISUAL-QA-2026-11-23.md |
| 2026-11-23 | Android release APK | 1.1.4 / 14 | `954e2d7` | `android-1.1.4-14` | SHA-256 `6e434d827f0f80dee7058af84ab50324ba7e8aeb85becf03686fe8e984259d53` |

## Как ставить тег

- Сервер: `git tag server-ГГГГ-ММ-ДД <коммит>`
- Android: `git tag android-<versionName>-<versionCode> <коммит>`
- iOS: `git tag ios-<version>-<build> <коммит>`
- После: `git push origin --tags`

## Сверка production 13 ноября 2026

`/srv/disbit/current` и `/api/ready` сообщают прежний идентификатор
`777ff1012f6b98e7897edde2c5b364d5b69124ce`. Этого объекта в текущей истории Git нет.
Содержимое `frontend/`, `backend/` (без node_modules и .env), `scripts/`,
`package.json` и `package-lock.json` на production сравнено с архивом тега
`server-2026-11-07` (`2c975b7d4651f53a9634900a7973ae8308e56270`): различий нет.
Это подтверждение совпадения перечисленных файлов, а не наличия старого коммита
в текущем репозитории. Тег не перемещался; production не переустанавливался.
