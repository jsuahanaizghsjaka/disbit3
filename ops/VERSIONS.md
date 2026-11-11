# Disbit — таблица версий

Одна строка на каждый выкатанный билд. Правило: перед выкаткой ставим git-тег
на коммит и добавляем строку сюда. Данные ниже взяты из отчётов в `ops/` и
`RELEASE-FOUNDATION-REPORT.md`; пустая ячейка значит, что значение нигде не записано.

| Дата | Что | Версия / versionCode | Коммит | Тег | Источник |
|---|---|---|---|---|---|
| 2026-10-25 | Сервер production + staging | — | `5ae29a7` | — | RELEASE-FOUNDATION-REPORT.md |
| 2026-10-25 | Android APK/AAB | 1.0.4 / 5 | `5ae29a7` | — | RELEASE-FOUNDATION-REPORT.md |
| 2026-10-27 | Android APK (Galaxy A22) | 1.0.6 / 7 | `e9d98b5` | — | plans/DISBIT-PERFORMANCE-AUDIT-AND-SPEC.md |
| 2026-11-07 | Сервер production + staging | — | `777ff10` | `server-2026-11-07` | ops/INTRO-SKIP-GOOGLE-2026-11-07.md |
| не выпущен | Android (в `android/app/build.gradle`) | 1.0.7 / 8 | — | — | build.gradle |

## Как ставить тег

- Сервер: `git tag server-ГГГГ-ММ-ДД <коммит>`
- Android: `git tag android-<versionName>-<versionCode> <коммит>`
- iOS: `git tag ios-<version>-<build> <коммит>`
- После: `git push origin --tags`
